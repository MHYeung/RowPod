import {
  LBS_LED,
  LBS_SVC,
  MOTION_DATA,
  MOTION_META,
  MOTION_SVC,
  decodeFrame,
  decodeMeta,
} from "./protocol.js";

export class BleClient {
  constructor() {
    this.device = null;
    this.server = null;
    this.dataChar = null;
    this.ledChar = null;
    this.meta = {
      accel_lsb_per_g: 4096,
      gyro_lsb_per_dps: 64,
      mag_lsb_per_gauss: 1000,
      rate_hz: 100,
    };
    this.onFrame = null;
    this.onStatus = null;
    this._lastSeq = null;
    this.gaps = 0;
    this._boundNotify = this._onNotify.bind(this);
    this._boundDisconnect = this._onDisconnect.bind(this);
  }

  _setStatus(text, cls = "") {
    if (this.onStatus) this.onStatus(text, cls);
  }

  async connect() {
    if (!navigator.bluetooth) {
      throw new Error("Web Bluetooth unavailable — use Chrome/Edge on localhost or HTTPS");
    }
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ name: "C3-Tracker" }, { services: [LBS_SVC] }],
      optionalServices: [MOTION_SVC, LBS_SVC],
    });
    this.device.addEventListener("gattserverdisconnected", this._boundDisconnect);
    this.server = await this.device.gatt.connect();

    const motion = await this.server.getPrimaryService(MOTION_SVC);
    this.dataChar = await motion.getCharacteristic(MOTION_DATA);
    const metaChar = await motion.getCharacteristic(MOTION_META);
    const metaView = await metaChar.readValue();
    this.meta = { ...this.meta, ...decodeMeta(metaView) };
    this._setStatus(
      `Connected · meta v${this.meta.ver} @ ${this.meta.rate_hz} Hz`,
      "ok"
    );

    const lbs = await this.server.getPrimaryService(LBS_SVC);
    this.ledChar = await lbs.getCharacteristic(LBS_LED);

    this._lastSeq = null;
    this.gaps = 0;
    await this.dataChar.startNotifications();
    this.dataChar.addEventListener("characteristicvaluechanged", this._boundNotify);
  }

  async disconnect() {
    if (this.dataChar) {
      try {
        this.dataChar.removeEventListener("characteristicvaluechanged", this._boundNotify);
        await this.dataChar.stopNotifications();
      } catch (_) { /* ignore */ }
    }
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this._cleanup();
    this._setStatus("Disconnected");
  }

  async writeLed(mode) {
    if (!this.ledChar) throw new Error("not connected");
    await this.ledChar.writeValueWithoutResponse(Uint8Array.of(mode & 0xff));
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

  _onDisconnect() {
    this._cleanup();
    this._setStatus("Disconnected (link lost)", "err");
  }

  _cleanup() {
    if (this.device) {
      this.device.removeEventListener("gattserverdisconnected", this._boundDisconnect);
    }
    this.dataChar = null;
    this.ledChar = null;
    this.server = null;
  }
}
