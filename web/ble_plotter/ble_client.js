import {
  CFG_BATT,
  CFG_INFO,
  CFG_NAME,
  CFG_SVC,
  CFG_SYNC,
  MOTION_DATA,
  MOTION_META,
  MOTION_SVC,
  decodeBatt,
  decodeCfgInfo,
  decodeFrame,
  decodeMeta,
  decodeSyncRsp,
} from "./protocol.js";

export class BleClient {
  constructor() {
    this.device = null;
    this.server = null;
    this.dataChar = null;
    this.nameChar = null;
    this.syncChar = null;
    this.battChar = null;
    this.meta = {
      accel_lsb_per_g: 4096,
      gyro_lsb_per_dps: 64,
      mag_lsb_per_gauss: 1000,
      rate_hz: 100,
      flags: 0,
    };
    this.info = { mode: 0, podId: 0, hasCustomName: false };
    this.battery = { millivolts: 0, percent: 0, valid: false };
    this.advName = "";
    this.onFrame = null;
    this.onStatus = null;
    this.onDisconnect = null;
    this._lastSeq = null;
    this.gaps = 0;
    this._boundNotify = this._onNotify.bind(this);
    this._boundSync = this._onSyncNotify.bind(this);
    this._boundDisconnect = this._onDisconnect.bind(this);
    this._syncWaiters = [];
  }

  get deviceId() {
    return this.device?.id || null;
  }

  _setStatus(text, cls = "") {
    if (this.onStatus) this.onStatus(text, cls);
  }

  async connect() {
    if (!navigator.bluetooth) {
      throw new Error("Web Bluetooth unavailable — use Chrome/Edge on localhost or HTTPS");
    }
    /* OR filters: service UUID and/or name prefix (name is in scan response). */
    this.device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: [MOTION_SVC] },
        { namePrefix: "C3-Tracker" },
        { namePrefix: "C3-T-" },
      ],
      optionalServices: [MOTION_SVC, CFG_SVC],
    });
    this.advName = this.device.name || "";
    this.device.addEventListener("gattserverdisconnected", this._boundDisconnect);
    this.server = await this.device.gatt.connect();

    const motion = await this.server.getPrimaryService(MOTION_SVC);
    this.dataChar = await motion.getCharacteristic(MOTION_DATA);
    const metaChar = await motion.getCharacteristic(MOTION_META);
    const metaView = await metaChar.readValue();
    this.meta = { ...this.meta, ...decodeMeta(metaView) };

    try {
      const cfg = await this.server.getPrimaryService(CFG_SVC);
      const infoChar = await cfg.getCharacteristic(CFG_INFO);
      this.nameChar = await cfg.getCharacteristic(CFG_NAME);
      this.syncChar = await cfg.getCharacteristic(CFG_SYNC);
      try {
        this.battChar = await cfg.getCharacteristic(CFG_BATT);
      } catch (_) {
        this.battChar = null;
      }
      const infoView = await infoChar.readValue();
      this.info = decodeCfgInfo(infoView);
      const nameView = await this.nameChar.readValue();
      this.advName = new TextDecoder().decode(nameView) || this.advName;
      await this.syncChar.startNotifications();
      this.syncChar.addEventListener("characteristicvaluechanged", this._boundSync);
      await this.readBattery();
    } catch (e) {
      console.warn("config service unavailable", e);
    }

    this._setStatus(
      `Connected · ${this.advName || "pod"} · meta v${this.meta.ver} @ ${this.meta.rate_hz} Hz`,
      "ok"
    );

    this._lastSeq = null;
    this.gaps = 0;
    await this.dataChar.startNotifications();
    this.dataChar.addEventListener("characteristicvaluechanged", this._boundNotify);
  }

  async setName(name) {
    if (!this.nameChar) throw new Error("config name characteristic missing");
    const enc = new TextEncoder().encode(String(name || "").slice(0, 20));
    await this.nameChar.writeValueWithoutResponse(enc);
    this.advName = String(name || "");
    this.info.hasCustomName = this.advName.length > 0;
  }

  async readBattery() {
    if (!this.battChar) {
      this.battery = { millivolts: 0, percent: 0, valid: false };
      return this.battery;
    }
    const view = await this.battChar.readValue();
    this.battery = decodeBatt(view);
    return this.battery;
  }

  /**
   * Software sync handshake. Returns estimated device_time_ms at browser epoch.
   * offsetMs ≈ deviceWallMs - performance.now() for later alignment.
   */
  async syncClock() {
    if (!this.syncChar) {
      return { offsetMs: 0, rttMs: 0, seq: 0 };
    }
    const t0 = performance.now();
    const req = new ArrayBuffer(8);
    new DataView(req).setBigUint64(0, BigInt(Math.round(t0)), true);

    const rspPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("sync timeout")), 1500);
      this._syncWaiters.push({
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
      });
    });

    await this.syncChar.writeValueWithoutResponse(new Uint8Array(req));
    const rsp = await rspPromise;
    const t1 = performance.now();
    const rttMs = t1 - t0;
    const deviceMs = rsp.deviceUs / 1000;
    const clientMid = t0 + rttMs / 2;
    const offsetMs = deviceMs - clientMid;
    return { offsetMs, rttMs, seq: rsp.seq, deviceMs, clientMid };
  }

  async disconnect() {
    if (this.dataChar) {
      try {
        this.dataChar.removeEventListener("characteristicvaluechanged", this._boundNotify);
        await this.dataChar.stopNotifications();
      } catch (_) { /* ignore */ }
    }
    if (this.syncChar) {
      try {
        this.syncChar.removeEventListener("characteristicvaluechanged", this._boundSync);
        await this.syncChar.stopNotifications();
      } catch (_) { /* ignore */ }
    }
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this._cleanup();
    this._setStatus("Disconnected");
  }

  _onNotify(ev) {
    const view = ev.target.value;
    try {
      const frame = decodeFrame(view, this.meta);
      if (this._lastSeq !== null) {
        const expect = (this._lastSeq + 1) & 0xffff;
        if (frame.seq !== expect) {
          this.gaps += 1;
        }
      }
      this._lastSeq = frame.seq;
      if (this.onFrame) this.onFrame(frame, this.gaps);
    } catch (e) {
      console.warn(e);
    }
  }

  _onSyncNotify(ev) {
    try {
      const rsp = decodeSyncRsp(ev.target.value);
      const waiter = this._syncWaiters.shift();
      if (waiter) waiter.resolve(rsp);
    } catch (e) {
      console.warn(e);
    }
  }

  _onDisconnect() {
    this._cleanup();
    this._setStatus("Disconnected (link lost)", "err");
    if (this.onDisconnect) this.onDisconnect();
  }

  _cleanup() {
    if (this.device) {
      this.device.removeEventListener("gattserverdisconnected", this._boundDisconnect);
    }
    this.dataChar = null;
    this.nameChar = null;
    this.syncChar = null;
    this.battChar = null;
    this.server = null;
    while (this._syncWaiters.length) {
      this._syncWaiters.shift().resolve?.({ clientMs: 0, deviceUs: 0, seq: 0 });
    }
  }
}
