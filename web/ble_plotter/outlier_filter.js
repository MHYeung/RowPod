const RAIL = 32760;

/**
 * Online guard for display and CSV provenance.
 * It only replaces impossible int16 rails; offline processing can use both
 * neighbors and therefore applies the stricter innovation filter.
 */
export class MotionOutlierFilter {
  constructor() {
    this.lastValid = null;
  }

  reset() {
    this.lastValid = null;
  }

  observe(frame) {
    const r = frame.raw;
    let mask = 0;
    const reasons = [];
    if (["ax", "ay", "az"].some((key) => Math.abs(r[key]) >= RAIL)) {
      mask |= 1;
      reasons.push("accel_rail");
    }
    if (["gx", "gy", "gz"].some((key) => Math.abs(r[key]) >= RAIL)) {
      mask |= 2;
      reasons.push("gyro_rail");
    }
    if (["mx", "my", "mz"].some((key) => Math.abs(r[key]) >= RAIL)) {
      mask |= 4;
      reasons.push("mag_rail");
    }

    const clean = mask && this.lastValid
      ? { ...this.lastValid }
      : { ...frame.eng };
    if (!mask) {
      this.lastValid = { ...frame.eng };
    }
    return { eng: clean, mask, reason: reasons.join(";") };
  }
}
