import {
  CFG_BATT,
  CFG_INFO,
  CFG_NAME,
  CFG_PROFILE,
  CFG_RATE,
  CFG_SVC,
  CFG_SYNC,
  MOTION_DATA,
  MOTION_META,
  MOTION_SVC,
  RATE_LIVE_HZ,
  decodeBatt,
  decodeCfgInfo,
  decodeFrames,
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
    this.rateChar = null;
    this.profileChar = null;
    this.meta = {
      accel_lsb_per_g: 2048,
      gyro_lsb_per_dps: 16,
      mag_lsb_per_gauss: 3750,
      rate_hz: RATE_LIVE_HZ,
      flags: 0,
    };
    this.info = { mode: 0, podId: 0, hasCustomName: false };
    this.battery = { millivolts: 0, percent: 0, valid: false };
    this.workoutProfile = 0;
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
    this._gattQueue = Promise.resolve();
    this._stage = "idle";
    this._motionNotifications = false;
  }

  get deviceId() {
    return this.device?.id || null;
  }

  _setStatus(text, cls = "") {
    if (this.onStatus) this.onStatus(text, cls);
  }

  _queueGatt(operation) {
    const run = this._gattQueue.then(operation, operation);
    this._gattQueue = run.catch(() => {});
    return run;
  }

  async _connectGattWithRetry() {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.device.gatt.connect();
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
        }
      }
    }
    throw lastError;
  }

  async connect(options = {}) {
    let stage = "requestDevice";
    const setStage = (value) => {
      stage = value;
      this._stage = value;
    };
    try {
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
      if (options.beforeGattConnect) {
        setStage("pausing existing pod streams");
        await options.beforeGattConnect();
      }
      setStage("gatt.connect");
      this.server = await this._connectGattWithRetry();

      setStage("discover motion service");
      const motion = await this.server.getPrimaryService(MOTION_SVC);
      this.dataChar = await motion.getCharacteristic(MOTION_DATA);
      const metaChar = await motion.getCharacteristic(MOTION_META);
      setStage("read motion metadata");
      const metaView = await metaChar.readValue();
      this.meta = { ...this.meta, ...decodeMeta(metaView) };

      try {
        setStage("discover config service");
        const cfg = await this.server.getPrimaryService(CFG_SVC);
        const infoChar = await cfg.getCharacteristic(CFG_INFO);
        this.nameChar = await cfg.getCharacteristic(CFG_NAME);
        this.syncChar = await cfg.getCharacteristic(CFG_SYNC);
        try {
          this.battChar = await cfg.getCharacteristic(CFG_BATT);
        } catch (_) {
          this.battChar = null;
        }
        try {
          this.rateChar = await cfg.getCharacteristic(CFG_RATE);
        } catch (_) {
          this.rateChar = null;
        }
        try {
          this.profileChar = await cfg.getCharacteristic(CFG_PROFILE);
          const profileView = await this.profileChar.readValue();
          this.workoutProfile = profileView.getUint8(0);
        } catch (_) {
          this.profileChar = null;
        }
        setStage("read pod configuration");
        const infoView = await infoChar.readValue();
        this.info = decodeCfgInfo(infoView);
        const nameView = await this.nameChar.readValue();
        this.advName = new TextDecoder().decode(nameView) || this.advName;
        setStage("subscribe sync");
        await this.syncChar.startNotifications();
        this.syncChar.addEventListener("characteristicvaluechanged", this._boundSync);
        setStage("read battery");
        await this.readBattery();
        setStage("set live rate");
        await this.setRate(RATE_LIVE_HZ);
      } catch (e) {
        console.warn(`optional config setup failed at ${stage}`, e);
      }

      this._setStatus(
        `Connected · ${this.advName || "pod"} · meta v${this.meta.ver} @ ${this.meta.rate_hz} Hz`,
        "ok"
      );

      this._lastSeq = null;
      this.gaps = 0;
      setStage("subscribe motion");
      await this.dataChar.startNotifications();
      this.dataChar.addEventListener("characteristicvaluechanged", this._boundNotify);
      this._motionNotifications = true;
      this._stage = "ready";
    } catch (error) {
      const device = this.device;
      const wasConnected = Boolean(device?.gatt?.connected);
      this._cleanup();
      if (wasConnected) device.gatt.disconnect();
      this.device = null;
      const detail = error?.message || String(error);
      const wrapped = new Error(`BLE setup failed at ${stage}: ${detail}`);
      wrapped.name = error?.name || "BLEError";
      throw wrapped;
    }
  }

  async setName(name) {
    return this._queueGatt(async () => {
      if (!this.nameChar) throw new Error("config name characteristic missing");
      const enc = new TextEncoder().encode(String(name || "").slice(0, 20));
      await this.nameChar.writeValueWithoutResponse(enc);
      this.advName = String(name || "");
      this.info.hasCustomName = this.advName.length > 0;
    });
  }

  async readBattery() {
    return this._queueGatt(async () => {
      if (!this.battChar) {
        this.battery = { millivolts: 0, percent: 0, valid: false };
        return this.battery;
      }
      const view = await this.battChar.readValue();
      this.battery = decodeBatt(view);
      return this.battery;
    });
  }

  /** @param {56|112|224} hz */
  async setRate(hz) {
    return this._queueGatt(async () => {
      if (![56, 112, 224].includes(hz)) {
        throw new Error(`unsupported rate ${hz}`);
      }
      if (this.rateChar) {
        await this.rateChar.writeValueWithoutResponse(Uint8Array.of(hz));
      }
      this.meta.rate_hz = hz;
    });
  }

  /** @param {0|1} profile */
  async setWorkoutProfile(profile) {
    return this._queueGatt(async () => {
      if (![0, 1].includes(profile)) {
        throw new Error(`unsupported workout profile ${profile}`);
      }
      if (this.profileChar) {
        await this.profileChar.writeValueWithoutResponse(Uint8Array.of(profile));
      }
      this.workoutProfile = profile;
    });
  }

  /**
   * Software sync handshake. Returns estimated device_time_ms at browser epoch.
   * offsetMs ≈ deviceWallMs - performance.now() for later alignment.
   */
  async syncClock() {
    return this._queueGatt(async () => {
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
    });
  }

  async disconnect() {
    return this._queueGatt(async () => {
      if (this.dataChar) {
        try {
          this.dataChar.removeEventListener("characteristicvaluechanged", this._boundNotify);
          await this.dataChar.stopNotifications();
        } catch (_) { /* ignore */ }
      }
      this._motionNotifications = false;
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
    });
  }

  async pauseNotifications() {
    return this._queueGatt(async () => {
      if (!this.dataChar || !this._motionNotifications) return false;
      this.dataChar.removeEventListener("characteristicvaluechanged", this._boundNotify);
      await this.dataChar.stopNotifications();
      this._motionNotifications = false;
      return true;
    });
  }

  async resumeNotifications() {
    return this._queueGatt(async () => {
      if (!this.dataChar || this._motionNotifications) return false;
      await this.dataChar.startNotifications();
      this.dataChar.addEventListener("characteristicvaluechanged", this._boundNotify);
      this._motionNotifications = true;
      return true;
    });
  }

  _onNotify(ev) {
    const view = ev.target.value;
    try {
      for (const frame of decodeFrames(view, this.meta)) {
        if (this._lastSeq !== null) {
          const expect = (this._lastSeq + 1) & 0xffff;
          if (frame.seq !== expect) {
            this.gaps += 1;
          }
        }
        this._lastSeq = frame.seq;
        if (this.onFrame) this.onFrame(frame, this.gaps);
      }
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
    this.rateChar = null;
    this.profileChar = null;
    this.server = null;
    this._motionNotifications = false;
    while (this._syncWaiters.length) {
      this._syncWaiters.shift().resolve?.({ clientMs: 0, deviceUs: 0, seq: 0 });
    }
  }
}
