/**
 * Oar angle for RowPod.
 *
 * High-confidence path: raw gyro (v16/v1) dotted with a low-passed gravity
 * estimate, then a stroke-midpoint lock so gyro bias cannot walk the fan off
 * Zero. Fused Mahony yaw is fallback only — it still follows the magnetometer.
 *
 * After Zero, the first complete stroke sets the arc midpoint vs perpendicular.
 * Later strokes keep that midpoint; DC leaks toward it only while ω_vert > 0
 * (the drive) so recovery does not jump.
 */
const DEFAULT_REFRACTORY_MS = 350;
const DEFAULT_OMEGA_PEAK = 25;
const GRAVITY_LP_TAU_S = 0.35;
const DC_ALPHA = 0.85;
const DC_TAU_S = 0.45;
const MIN_ARC_DEG = 20;
const FINISH_TIMEOUT_MS = 2500;

export function gravityBodyFromQuat(q) {
  const w = q.qw;
  const x = q.qx;
  const y = q.qy;
  const z = q.qz;
  return {
    x: 2 * (x * z + w * y),
    y: 2 * (y * z - w * x),
    z: 1 - 2 * (x * x + y * y),
  };
}

export function yawAboutGravityDeg(q) {
  const w = q.qw;
  const x = q.qx;
  const y = q.qy;
  const z = q.qz;
  return (
    Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) * (180 / Math.PI)
  );
}

export function wrap180(deg) {
  return deg - 360 * Math.round(deg / 360);
}

/** Body axis most aligned with a horizontal shaft (smallest |g|). */
export function pickShaftAxis(g) {
  const mag = [Math.abs(g.x), Math.abs(g.y), Math.abs(g.z)];
  let axis = 0;
  if (mag[1] < mag[axis]) axis = 1;
  if (mag[2] < mag[axis]) axis = 2;
  return axis;
}

/**
 * Blade feather (deg) from gravity about the shaft axis.
 * Squared ≈ 0 after Zero; 90 is fully feathered for a typical mount.
 */
export function featherDeg(g, shaftAxis) {
  const v = [g.x, g.y, g.z];
  const j = (shaftAxis + 1) % 3;
  const k = (shaftAxis + 2) % 3;
  return Math.atan2(v[j], v[k]) * (180 / Math.PI);
}

function hypot3(x, y, z) {
  return Math.hypot(x, y, z) || 1e-9;
}

function interpolateCrossing(t0, y0, t1, y1) {
  const denom = y1 - y0;
  const frac = Math.abs(denom) > 1e-12 ? (-y0 / denom) : 0;
  const u = Math.max(0, Math.min(1, frac));
  return t0 + u * (t1 - t0);
}

function hasRawGyro(frame) {
  return frame.protocol === 1 || frame.protocol === 2;
}

export class OarAngleTracker {
  /**
   * @param {{
   *   refractoryMs?: number,
   *   omegaPeakMin?: number,
   *   minArcDeg?: number,
   *   sign?: number,
   *   onEvent?: function,
   * }} [opts]
   */
  constructor(opts = {}) {
    this.refractoryMs = opts.refractoryMs ?? DEFAULT_REFRACTORY_MS;
    this.omegaPeakMin = opts.omegaPeakMin ?? DEFAULT_OMEGA_PEAK;
    this.minArcDeg = opts.minArcDeg ?? MIN_ARC_DEG;
    this.sign = opts.sign ?? 1;
    this.onEvent = opts.onEvent || null;
    this._resetFilters();
  }

  _resetFilters() {
    this.prevT = null;
    this.theta = 0;
    this.omegaVert = 0;
    this.zeroed = false;
    this._raw = 0;
    this._dc = 0;
    this._dcTarget = 0;
    this._midRef = null;
    this._lastWalk = 0;
    this._dcStrokes = 0;
    this._source = "none";
    this._unwrapped = 0;
    this._yawPrev = null;
    this._g = { x: 0, y: 0, z: 1 };
    this._shaftAxis = 2;
    this._featherRef = 0;
    this.feather = 0;
    this._expect = "catch";
    this.lastOmega = 0;
    this.lastT = 0;
    this.lastTheta = 0;
    this.lastFeather = 0;
    this._tOmega = null;
    this.peakAbsOmega = 0;
    this.lastEventT = -Infinity;
    this.lastCatch = null;
    this.lastFinish = null;
    this.events = [];
  }

  setSign(sign) {
    this.sign = sign < 0 ? -1 : 1;
  }

  /** Hold the oar squared and perpendicular, then call this. */
  zero() {
    this._dc = this._raw;
    this._dcTarget = this._raw;
    this._midRef = null;
    this._lastWalk = 0;
    this._dcStrokes = 0;
    this._shaftAxis = pickShaftAxis(this._g);
    this._featherRef = featherDeg(this._g, this._shaftAxis);
    this.feather = 0;
    this._expect = "catch";
    this.zeroed = true;
    this.theta = 0;
  }

  reset() {
    this._resetFilters();
  }

  /** Drop in-progress catch/finish without touching Zero or the DC lock. */
  clearStrokeState() {
    this.events = [];
    this.lastCatch = null;
    this.lastFinish = null;
    this._expect = "catch";
    this.peakAbsOmega = 0;
    this.lastEventT = -Infinity;
  }

  /**
   * @param {{protocol?:number,quat?:object,eng:object}} frame
   * @param {number} hostMs
   */
  update(frame, hostMs) {
    const t = Number(hostMs);
    if (!Number.isFinite(t)) {
      return { theta: this.theta, omegaVert: this.omegaVert, event: null };
    }

    const dtSec = this.prevT != null ? (t - this.prevT) / 1000 : 0;
    const dtOk = dtSec > 1e-4 && dtSec < 0.15;
    const eng = frame.eng || {};
    if (dtOk) {
      const k = 1 - Math.exp(-dtSec / GRAVITY_LP_TAU_S);
      const ax = Number.isFinite(eng.ax) ? eng.ax : 0;
      const ay = Number.isFinite(eng.ay) ? eng.ay : 0;
      const az = Number.isFinite(eng.az) ? eng.az : 1;
      this._g.x += k * (ax - this._g.x);
      this._g.y += k * (ay - this._g.y);
      this._g.z += k * (az - this._g.z);
    }

    let omegaVert = 0;
    if (hasRawGyro(frame)) {
      this._source = "gyro";
      const gn = hypot3(this._g.x, this._g.y, this._g.z);
      omegaVert =
        this.sign *
        (eng.gx * this._g.x + eng.gy * this._g.y + eng.gz * this._g.z) /
        gn;
      if (dtOk) this._raw += omegaVert * dtSec;
    } else if (frame.quat) {
      this._source = "yaw";
      const yaw = yawAboutGravityDeg(frame.quat);
      let dYaw = 0;
      if (this._yawPrev == null) {
        this._yawPrev = yaw;
      } else {
        dYaw = wrap180(yaw - this._yawPrev);
        this._unwrapped += dYaw;
        this._yawPrev = yaw;
      }
      this._raw = this.sign * this._unwrapped;
      if (dtOk) omegaVert = (this.sign * dYaw) / dtSec;
    } else {
      this._source = "gyro";
      const gn = hypot3(this._g.x, this._g.y, this._g.z);
      omegaVert =
        this.sign *
        ((eng.gx || 0) * this._g.x +
          (eng.gy || 0) * this._g.y +
          (eng.gz || 0) * this._g.z) /
        gn;
      if (dtOk) this._raw += omegaVert * dtSec;
    }

    if (dtOk && omegaVert > 0) {
      const a = 1 - Math.exp(-dtSec / DC_TAU_S);
      this._dc += a * (this._dcTarget - this._dc);
    }
    this.theta = this._raw - this._dc;
    this.feather = wrap180(featherDeg(this._g, this._shaftAxis) - this._featherRef);
    this.omegaVert = omegaVert;
    const tOmega = this.prevT != null ? (this.prevT + t) / 2 : t;
    const event = this._maybeEvent(t, tOmega, this.theta, omegaVert);
    this.lastOmega = omegaVert;
    this.lastT = t;
    this._tOmega = tOmega;
    this.lastTheta = this.theta;
    this.lastFeather = this.feather;
    this.prevT = t;
    return { theta: this.theta, omegaVert, event };
  }

  _lockStrokeDc(finishEvent) {
    if (!this.lastCatch) return;
    const mid = 0.5 * (this.lastCatch.theta + finishEvent.theta);
    if (this._midRef == null) {
      this._midRef = mid;
      this._lastWalk = 0;
      return;
    }
    const err = mid - this._midRef;
    this._lastWalk = err;
    /* Target only; _dc leaks during the next drive so recovery does not jump. */
    this._dcTarget += DC_ALPHA * err;
    this._dcStrokes += 1;
  }

  _maybeEvent(t, tOmega, theta, omega) {
    this.peakAbsOmega = Math.max(this.peakAbsOmega, Math.abs(omega));
    if (this._tOmega == null) return null;

    const crossedUp = this.lastOmega < 0 && omega >= 0;
    const crossedDown = this.lastOmega > 0 && omega <= 0;
    if (!crossedUp && !crossedDown) return null;
    if (t - this.lastEventT < this.refractoryMs) return null;
    if (this.peakAbsOmega < this.omegaPeakMin) return null;

    let type = crossedUp ? "catch" : "finish";
    if (this._expect === "finish" && type === "catch" &&
        t - this.lastEventT > FINISH_TIMEOUT_MS) {
      this._expect = "catch";
    }
    if (type !== this._expect) return null;

    const tCross = interpolateCrossing(this._tOmega, this.lastOmega, tOmega, omega);
    const dtSample = t - this.lastT;
    const fracT =
      Math.abs(dtSample) > 1e-9 ? (tCross - this.lastT) / dtSample : 0;
    const u = Math.max(0, Math.min(1, fracT));
    const thetaCross = this.lastTheta + u * (theta - this.lastTheta);
    const featherCross = this.lastFeather + u * (this.feather - this.lastFeather);
    if (type === "finish" && this.lastCatch) {
      if (Math.abs(thetaCross - this.lastCatch.theta) < this.minArcDeg) {
        return null;
      }
    }
    const event = {
      type,
      t: tCross,
      theta: thetaCross,
      feather: featherCross,
      omegaPeak: this.peakAbsOmega,
    };

    if (type === "catch") this.lastCatch = event;
    else {
      this.lastFinish = event;
      this._lockStrokeDc(event);
    }
    this._expect = type === "catch" ? "finish" : "catch";
    this.events.push(event);
    if (this.events.length > 48) this.events.shift();
    this.peakAbsOmega = 0;
    this.lastEventT = tCross;
    if (this.onEvent) this.onEvent(event);
    return event;
  }

  snapshot() {
    const catchDeg = this.lastCatch?.theta;
    const finishDeg = this.lastFinish?.theta;
    const arc =
      catchDeg != null && finishDeg != null ? finishDeg - catchDeg : null;
    const walk = Math.abs(this._lastWalk);
    let confidence = "zero";
    if (this.zeroed && this._source === "yaw") confidence = "yaw";
    else if (this.zeroed && this._source === "gyro" && this._dcStrokes < 3) {
      confidence = "ok";
    } else if (this.zeroed && this._source === "gyro" && walk < 8) {
      confidence = "high";
    } else if (this.zeroed) confidence = "ok";
    return {
      theta: this.theta,
      omegaVert: this.omegaVert,
      omegaBias: 0,
      zeroed: this.zeroed,
      lastCatch: this.lastCatch,
      lastFinish: this.lastFinish,
      arcDeg: arc,
      feather: this.feather,
      source: this._source,
      walkDeg: this._lastWalk,
      dcStrokes: this._dcStrokes,
      confidence,
    };
  }
}
