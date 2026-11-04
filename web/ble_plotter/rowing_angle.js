/**
 * Oar angle for RowPod.
 *
 * High-confidence path: raw gyro (v16/v1) dotted with a low-passed gravity
 * estimate, then a stroke-midpoint lock so gyro bias cannot walk the fan off
 * Zero. Fused Mahony yaw is fallback only — it still follows the magnetometer.
 *
 * Connect-and-go: the first complete stroke centres the arc on a nominal
 * rig midpoint and takes feather from that drive. Zero is optional and
 * switches the reference to a measured perpendicular pose.
 *
 * After a reference exists, later strokes keep that midpoint. DC leaks
 * toward it only while ω_vert > 0 (the drive) so recovery does not jump.
 */
const DEFAULT_REFRACTORY_MS = 350;
const DEFAULT_OMEGA_PEAK = 25;
const DC_ALPHA = 0.2;
const DC_TAU_S = 0.45;
const GRAVITY_TRIM_TAU_S = 2;
const BIAS_CLAMP_DPS = 40;
const MIN_ARC_DEG = 20;
const FINISH_TIMEOUT_MS = 2500;
const FEATHER_ON_DEG = 45;
const FEATHER_TRACK_R = 0.7;
const FEATHER_TRACK_RANGE = 0.45;
const FEATHER_TRUST_DRIVES = 2;

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

function interpolateLevel(t0, y0, t1, y1, level) {
  const denom = y1 - y0;
  const frac = Math.abs(denom) > 1e-12 ? (level - y0) / denom : 0;
  const u = Math.max(0, Math.min(1, frac));
  return t0 + u * (t1 - t0);
}

function pearson(n, sumX, sumY, sumXX, sumYY, sumXY) {
  if (n < 8) return 0;
  const num = n * sumXY - sumX * sumY;
  const denX = n * sumXX - sumX * sumX;
  const denY = n * sumYY - sumY * sumY;
  const den = Math.sqrt(denX * denY);
  if (!Number.isFinite(den) || den < 1e-9) return 0;
  return num / den;
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
    const nominal = this._nominalCentre || 0;
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
    this._angleRef = "none";
    this._nominalCentre = nominal;
    this._featherSin = 0;
    this._featherCos = 0;
    this._featherN = 0;
    this._omegaBias = 0;
    this._stillSec = 0;
    this._stillSum = 0;
    this._stillN = 0;
    this._parked = false;
    this._recentArcs = [];
    this._prevLockedCatchT = null;
    this._driveSq = 0;
    this._drivePeak = 0;
    this._thetaAtPeak = 0;
    this._indexSum = 0;
    this._indexN = 0;
    this._prevFinishT = null;
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
    this.lastFeatherOn = null;
    this.events = [];
    this._featherTrusted = true;
    this._driveLeakCount = 0;
    this._driveDone = 0;
    this._awaitingFeather = false;
    this._resetDriveStats();
  }

  _resetDriveStats() {
    this._driveN = 0;
    this._driveSumTh = 0;
    this._driveSumFe = 0;
    this._driveSumThTh = 0;
    this._driveSumFeFe = 0;
    this._driveSumThFe = 0;
    this._driveMinTh = Infinity;
    this._driveMaxTh = -Infinity;
    this._driveMinFe = Infinity;
    this._driveMaxFe = -Infinity;
  }

  setSign(sign) {
    this.sign = sign < 0 ? -1 : 1;
  }

  /** Arc centre used when the first stroke auto-centres. Sweep −12°, scull −10°. */
  setNominalCentre(deg) {
    const n = Number(deg);
    this._nominalCentre = Number.isFinite(n) ? n : 0;
  }

  /** Optional measured pose: squared and perpendicular becomes 0°. */
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
    this._angleRef = "zero";
    this._featherSin = 0;
    this._featherCos = 0;
    this._featherN = 0;
    this._recentArcs = [];
    this._prevLockedCatchT = null;
    this._featherTrusted = true;
    this._driveLeakCount = 0;
    this._driveDone = 0;
    this._awaitingFeather = false;
    this.lastFeatherOn = null;
    this._resetDriveStats();
  }

  reset() {
    this._resetFilters();
  }

  /** Hold the previous rate across a dropped burst, then one 56 Hz step. */
  _shaftStep(dtSec, omega) {
    const nominal = 1 / 56;
    const maxHold = 0.4;
    if (dtSec <= 1e-4 || dtSec >= maxHold) return 0;
    if (dtSec <= nominal * 1.5) return omega * dtSec;
    return this.lastOmega * (dtSec - nominal) + omega * nominal;
  }

  /** Drop in-progress catch/finish without touching Zero or the DC lock. */
  clearStrokeState() {
    this.events = [];
    this.lastCatch = null;
    this.lastFinish = null;
    this.lastFeatherOn = null;
    this._expect = "catch";
    this._awaitingFeather = false;
    this.peakAbsOmega = 0;
    this.lastEventT = -Infinity;
    this._indexSum = 0;
    this._indexN = 0;
    this._prevFinishT = null;
    this._driveSq = 0;
    this._drivePeak = 0;
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
    const dtOk = dtSec > 1e-4 && dtSec < 0.05;
    const eng = frame.eng || {};
    this._updateGravity(eng, dtSec, dtOk);

    let omegaVert = 0;
    if (hasRawGyro(frame)) {
      this._source = "gyro";
      const omegaVertRaw = this._verticalRate(eng);
      this._noteStillBias(eng, dtSec, dtOk, omegaVertRaw);
      omegaVert = omegaVertRaw - this._omegaBias;
      if (!this._parked) this._raw += this._shaftStep(dtSec, omegaVert);
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
      const omegaVertRaw = this._verticalRate(eng);
      this._noteStillBias(eng, dtSec, dtOk, omegaVertRaw);
      omegaVert = omegaVertRaw - this._omegaBias;
      if (!this._parked) this._raw += this._shaftStep(dtSec, omegaVert);
    }

    if (dtOk && omegaVert > 0) {
      const a = 1 - Math.exp(-dtSec / DC_TAU_S);
      this._dc += a * (this._dcTarget - this._dc);
    }
    this.theta = this._raw - this._dc;
    this.feather = wrap180(featherDeg(this._g, this._shaftAxis) - this._featherRef);
    this.omegaVert = omegaVert;
    if (dtOk && this._expect === "finish") {
      this._accumDrive(this.theta, this.feather);
      this._accumDrivePower(omegaVert, dtSec);
      if (this._angleRef === "none") {
        this._accumRawFeather(featherDeg(this._g, this._shaftAxis));
      }
    }
    const tOmega = this.prevT != null ? (this.prevT + t) / 2 : t;
    const events = [];
    const event = this._maybeEvent(t, tOmega, this.theta, omegaVert);
    if (event) events.push(event);
    const featherEv = this._maybeFeatherOn(t, this.feather);
    if (featherEv) events.push(featherEv);
    this.lastOmega = omegaVert;
    this.lastT = t;
    this._tOmega = tOmega;
    this.lastTheta = this.theta;
    this.lastFeather = this.feather;
    this.prevT = t;
    return {
      theta: this.theta,
      omegaVert,
      event: events[events.length - 1] || null,
      events,
    };
  }

  _accumDrive(theta, feather) {
    this._driveN += 1;
    this._driveSumTh += theta;
    this._driveSumFe += feather;
    this._driveSumThTh += theta * theta;
    this._driveSumFeFe += feather * feather;
    this._driveSumThFe += theta * feather;
    this._driveMinTh = Math.min(this._driveMinTh, theta);
    this._driveMaxTh = Math.max(this._driveMaxTh, theta);
    this._driveMinFe = Math.min(this._driveMinFe, feather);
    this._driveMaxFe = Math.max(this._driveMaxFe, feather);
  }

  _scoreDriveLeak() {
    const n = this._driveN;
    const r = pearson(
      n,
      this._driveSumTh,
      this._driveSumFe,
      this._driveSumThTh,
      this._driveSumFeFe,
      this._driveSumThFe
    );
    const thRange = this._driveMaxTh - this._driveMinTh;
    const feRange = this._driveMaxFe - this._driveMinFe;
    const leaked =
      Math.abs(r) > FEATHER_TRACK_R ||
      (thRange > 15 && feRange > FEATHER_TRACK_RANGE * thRange);
    this._driveDone += 1;
    if (leaked) this._driveLeakCount += 1;
    if (this._driveDone >= FEATHER_TRUST_DRIVES) {
      this._featherTrusted = this._driveLeakCount < FEATHER_TRUST_DRIVES;
    }
    this._resetDriveStats();
    return leaked;
  }

  _clampBias(v) {
    return Math.max(-BIAS_CLAMP_DPS, Math.min(BIAS_CLAMP_DPS, v));
  }

  /** ġ = −ω × g, then a slow nudge toward accel when the specific force is 1 g. */
  _updateGravity(eng, dtSec, dtOk) {
    if (!dtOk) return;
    const ax = Number.isFinite(eng.ax) ? eng.ax : 0;
    const ay = Number.isFinite(eng.ay) ? eng.ay : 0;
    const az = Number.isFinite(eng.az) ? eng.az : 1;
    const wx = ((Number.isFinite(eng.gx) ? eng.gx : 0) * Math.PI) / 180;
    const wy = ((Number.isFinite(eng.gy) ? eng.gy : 0) * Math.PI) / 180;
    const wz = ((Number.isFinite(eng.gz) ? eng.gz : 0) * Math.PI) / 180;
    const cx = wy * this._g.z - wz * this._g.y;
    const cy = wz * this._g.x - wx * this._g.z;
    const cz = wx * this._g.y - wy * this._g.x;
    this._g.x -= cx * dtSec;
    this._g.y -= cy * dtSec;
    this._g.z -= cz * dtSec;
    const an = hypot3(ax, ay, az);
    if (Math.abs(an - 1) < 0.1) {
      const k = 1 - Math.exp(-dtSec / GRAVITY_TRIM_TAU_S);
      this._g.x += k * (ax / an - this._g.x);
      this._g.y += k * (ay / an - this._g.y);
      this._g.z += k * (az / an - this._g.z);
    }
    const gn = hypot3(this._g.x, this._g.y, this._g.z);
    this._g.x /= gn;
    this._g.y /= gn;
    this._g.z /= gn;
  }

  _verticalRate(eng) {
    const gn = hypot3(this._g.x, this._g.y, this._g.z);
    return (
      (this.sign *
        ((eng.gx || 0) * this._g.x +
          (eng.gy || 0) * this._g.y +
          (eng.gz || 0) * this._g.z)) /
      gn
    );
  }

  _noteStillBias(eng, dtSec, dtOk, omegaVertRaw) {
    if (!dtOk) return;
    const an = hypot3(
      Number.isFinite(eng.ax) ? eng.ax : 0,
      Number.isFinite(eng.ay) ? eng.ay : 0,
      Number.isFinite(eng.az) ? eng.az : 1
    );
    const accelStill = Math.abs(an - 1) < 0.12;
    const mean = this._stillN > 0 ? this._stillSum / this._stillN : omegaVertRaw;
    const steady =
      Math.abs(omegaVertRaw) < 50 &&
      (this._stillN === 0 || Math.abs(omegaVertRaw - mean) < 6);
    if (accelStill && steady) {
      this._stillSec += dtSec;
      this._stillSum += omegaVertRaw;
      this._stillN += 1;
      if (this._stillSec >= 0.5 && this._stillN > 0) {
        this._omegaBias = this._clampBias(this._stillSum / this._stillN);
        this._parked = true;
      }
    } else {
      this._stillSec = 0;
      this._stillSum = 0;
      this._stillN = 0;
      this._parked = false;
    }
  }

  _absorbWalk(errDeg, catchT) {
    if (this._prevLockedCatchT != null) {
      const periodSec = (catchT - this._prevLockedCatchT) / 1000;
      if (periodSec > 0.4 && periodSec < 8) {
        const implied = errDeg / periodSec;
        this._omegaBias = this._clampBias(
          this._omegaBias + 0.5 * (implied - this._omegaBias)
        );
      }
    }
    this._prevLockedCatchT = catchT;
  }

  _arcFloor() {
    if (!this._recentArcs.length) return this.minArcDeg;
    const sorted = [...this._recentArcs].sort((a, b) => a - b);
    const mid = sorted[Math.floor((sorted.length - 1) / 2)];
    return Math.max(this.minArcDeg, 0.5 * mid);
  }

  _rememberArc(arc) {
    if (!(arc > 0)) return;
    this._recentArcs.push(arc);
    if (this._recentArcs.length > 5) this._recentArcs.shift();
  }

  _accumDrivePower(omega, dtSec) {
    this._driveSq += omega * omega * dtSec;
    if (Math.abs(omega) >= Math.abs(this._drivePeak)) {
      this._drivePeak = omega;
      this._thetaAtPeak = this.theta;
    }
  }

  /** Unitless index: 100 means "like the first strokes of this piece". Not watts. */
  _stampDrive(event) {
    const driveMs = this.lastCatch ? event.t - this.lastCatch.t : null;
    const recoveryMs =
      this._prevFinishT != null && this.lastCatch
        ? this.lastCatch.t - this._prevFinishT
        : null;
    event.driveMs = driveMs;
    event.recoveryMs = recoveryMs;
    event.driveRatio =
      driveMs != null && recoveryMs != null && driveMs + recoveryMs > 0
        ? driveMs / (driveMs + recoveryMs)
        : null;
    event.peakOmegaDps = this._drivePeak;
    event.thetaAtPeakDeg = this._thetaAtPeak;
    event.driveRaw = this._driveSq;
    if (this._indexN < 10) {
      this._indexSum += this._driveSq;
      this._indexN += 1;
    }
    const mean = this._indexN > 0 ? this._indexSum / this._indexN : 0;
    event.driveIndex = mean > 0 ? (100 * this._driveSq) / mean : 0;
    this._prevFinishT = event.t;
  }

  _accumRawFeather(deg) {
    const rad = (deg * Math.PI) / 180;
    this._featherSin += Math.sin(rad);
    this._featherCos += Math.cos(rad);
    this._featherN += 1;
  }

  /**
   * First stroke with no Zero: shift the angle frame so the arc centre is the
   * nominal rig midpoint, and set feather 0 to the squared drive.
   * CrewSync keeps these event objects, so the shift has to land on them.
   */
  _autoCentre(finishEvent) {
    const mid = 0.5 * (this.lastCatch.theta + finishEvent.theta);
    const shift = mid - this._nominalCentre;
    this._dc += shift;
    this._dcTarget += shift;
    this.theta -= shift;
    this.lastCatch.theta -= shift;
    finishEvent.theta -= shift;
    if (this._featherN > 0) {
      this._featherRef =
        Math.atan2(this._featherSin, this._featherCos) * (180 / Math.PI);
    }
    this.lastCatch.feather = wrap180(this.lastCatch.feather - this._featherRef);
    finishEvent.feather = wrap180(finishEvent.feather - this._featherRef);
    this.feather = wrap180(featherDeg(this._g, this._shaftAxis) - this._featherRef);
    this._thetaAtPeak -= shift;
    this._midRef = this._nominalCentre;
    this._lastWalk = 0;
    this._angleRef = "auto";
    this.lastCatch.ref = "auto";
    finishEvent.ref = "auto";
    this._prevLockedCatchT = this.lastCatch.t;
    this._rememberArc(Math.abs(finishEvent.theta - this.lastCatch.theta));
  }

  _lockStrokeDc(finishEvent) {
    if (!this.lastCatch) return;
    if (this._angleRef === "none") {
      this._autoCentre(finishEvent);
      return;
    }
    const mid = 0.5 * (this.lastCatch.theta + finishEvent.theta);
    if (this._midRef == null) {
      this._midRef = mid;
      this._lastWalk = 0;
      this._prevLockedCatchT = this.lastCatch.t;
      this._rememberArc(Math.abs(finishEvent.theta - this.lastCatch.theta));
      return;
    }
    const err = mid - this._midRef;
    this._lastWalk = err;
    this._absorbWalk(err, this.lastCatch.t);
    /* Target only; _dc leaks during the next drive so recovery does not jump. */
    this._dcTarget += DC_ALPHA * err;
    this._dcStrokes += 1;
    this._rememberArc(Math.abs(finishEvent.theta - this.lastCatch.theta));
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
    if (type === "catch" && this._midRef != null && !(thetaCross < this._midRef)) {
      return null;
    }
    if (type === "finish" && this.lastCatch) {
      const arc = Math.abs(thetaCross - this.lastCatch.theta);
      if (arc < this._arcFloor()) return null;
    }
    const event = {
      type,
      t: tCross,
      theta: thetaCross,
      feather: featherCross,
      omegaPeak: this.peakAbsOmega,
      ref: this._angleRef,
    };

    if (type === "catch") {
      if (this._angleRef === "none") {
        this._shaftAxis = pickShaftAxis(this._g);
        this._featherSin = 0;
        this._featherCos = 0;
        this._featherN = 0;
      }
      this.lastCatch = event;
      this._awaitingFeather = false;
      this._resetDriveStats();
      this._driveSq = 0;
      this._drivePeak = 0;
      this._thetaAtPeak = thetaCross;
    } else {
      this.lastFinish = event;
      this._lockStrokeDc(event);
      this._stampDrive(event);
      const leaked = this._scoreDriveLeak();
      this._awaitingFeather = this._featherTrusted && !leaked;
    }
    this._expect = type === "catch" ? "finish" : "catch";
    this.events.push(event);
    if (this.events.length > 48) this.events.shift();
    this.peakAbsOmega = 0;
    this.lastEventT = tCross;
    if (this.onEvent) this.onEvent(event);
    return event;
  }

  /**
   * First |feather| up-cross through 45° after finish, before the next catch.
   * Squared-only pieces never fire. Fan-tracking drives suppress this.
   */
  _maybeFeatherOn(t, feather) {
    if (!this._awaitingFeather || !this.lastFinish) return null;
    if (this.prevT == null) return null;
    const lastAbs = Math.abs(this.lastFeather);
    const absNow = Math.abs(feather);
    if (!(lastAbs < FEATHER_ON_DEG && absNow >= FEATHER_ON_DEG)) return null;
    const tCross = interpolateLevel(
      this.lastT,
      lastAbs,
      t,
      absNow,
      FEATHER_ON_DEG
    );
    const event = {
      type: "feather",
      t: tCross,
      theta: this.theta,
      feather: absNow >= FEATHER_ON_DEG ? feather : this.lastFeather,
      trusted: this._featherTrusted,
      ref: this._angleRef,
    };
    this._awaitingFeather = false;
    this.lastFeatherOn = event;
    this.events.push(event);
    if (this.events.length > 48) this.events.shift();
    if (this.onEvent) this.onEvent(event);
    return event;
  }

  snapshot() {
    const catchDeg = this.lastCatch?.theta;
    const finishDeg = this.lastFinish?.theta;
    const arc =
      catchDeg != null && finishDeg != null ? finishDeg - catchDeg : null;
    const walk = Math.abs(this._lastWalk);
    let confidence = "centring";
    if (this._angleRef === "auto") confidence = "auto";
    else if (this.zeroed && this._source === "yaw") confidence = "yaw";
    else if (this.zeroed && this._source === "gyro" && this._dcStrokes < 3) {
      confidence = "ok";
    } else if (this.zeroed && this._source === "gyro" && walk < 8) {
      confidence = "high";
    } else if (this.zeroed) confidence = "ok";
    return {
      theta: this.theta,
      omegaVert: this.omegaVert,
      omegaBias: this._omegaBias,
      zeroed: this.zeroed,
      angleRef: this._angleRef,
      lastCatch: this.lastCatch,
      lastFinish: this.lastFinish,
      lastFeatherOn: this.lastFeatherOn,
      arcDeg: arc,
      feather: this.feather,
      featherTrusted: this._featherTrusted,
      source: this._source,
      walkDeg: this._lastWalk,
      dcStrokes: this._dcStrokes,
      confidence,
    };
  }
}
