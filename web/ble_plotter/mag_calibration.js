const STORE_KEY = "c3_mag_calibration_v1";

/** Half-range (Gauss) required per axis. Earth field is ~0.3–0.5 G locally. */
const MIN_HALF_RANGE_G = 0.12;
const MIN_SAMPLES = 400;

export class MagCalibrationStore {
  constructor() {
    try {
      this.saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    } catch {
      this.saved = {};
    }
    this.active = null;
  }

  start(deviceId) {
    this.active = {
      deviceId,
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
      samples: 0,
    };
  }

  observe(deviceId, eng) {
    if (!this.active || this.active.deviceId !== deviceId) return;
    const v = [eng.mx, eng.my, eng.mz];
    for (let i = 0; i < 3; i++) {
      this.active.min[i] = Math.min(this.active.min[i], v[i]);
      this.active.max[i] = Math.max(this.active.max[i], v[i]);
    }
    this.active.samples += 1;
  }

  /** @returns {{samples:number, half:[number,number,number], ok:[boolean,boolean,boolean], weakest:string}|null} */
  progress() {
    const a = this.active;
    if (!a || a.samples < 1) return null;
    const half = a.max.map((v, i) => (v - a.min[i]) / 2);
    const ok = half.map((h) => h >= MIN_HALF_RANGE_G);
    const axes = ["X", "Y", "Z"];
    let weakest = axes[0];
    let weakestHalf = half[0];
    for (let i = 1; i < 3; i++) {
      if (half[i] < weakestHalf) {
        weakestHalf = half[i];
        weakest = axes[i];
      }
    }
    return { samples: a.samples, half, ok, weakest };
  }

  finish() {
    const a = this.active;
    this.active = null;
    if (!a || a.samples < MIN_SAMPLES) {
      throw new Error(
        `Mag calibration captured too few samples (${a?.samples ?? 0}/${MIN_SAMPLES}). ` +
          "Keep the pod connected and streaming while calibrating."
      );
    }
    const half = a.max.map((v, i) => (v - a.min[i]) / 2);
    const axes = ["X", "Y", "Z"];
    const weak = [];
    for (let i = 0; i < 3; i++) {
      if (half[i] < MIN_HALF_RANGE_G) {
        weak.push(`${axes[i]}=${half[i].toFixed(3)}G`);
      }
    }
    if (weak.length) {
      throw new Error(
        `Axis coverage too small (${weak.join(", ")}; need ≥${MIN_HALF_RANGE_G}G half-range). ` +
          "Do a slow figure-8 and tumble the pod through nose/tail/side-down — " +
          "not just spinning flat on a table."
      );
    }
    const meanHalf = half.reduce((sum, v) => sum + v, 0) / 3;
    const cal = {
      offset: a.max.map((v, i) => (v + a.min[i]) / 2),
      scale: half.map((v) => meanHalf / v),
      samples: a.samples,
      halfRangeG: half,
      createdIso: new Date().toISOString(),
    };
    this.saved[a.deviceId] = cal;
    localStorage.setItem(STORE_KEY, JSON.stringify(this.saved));
    return cal;
  }

  get(deviceId) {
    return this.saved[deviceId] || null;
  }

  apply(deviceId, eng) {
    const cal = this.get(deviceId);
    if (!cal) return { mx: eng.mx, my: eng.my, mz: eng.mz };
    return {
      mx: (eng.mx - cal.offset[0]) * cal.scale[0],
      my: (eng.my - cal.offset[1]) * cal.scale[1],
      mz: (eng.mz - cal.offset[2]) * cal.scale[2],
    };
  }
}
