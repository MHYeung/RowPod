/**
 * Per-pod mapping from IMU sample_index to host time (performance.now).
 *
 * Each software-sync exchange latches (sample_index, device_us) on the pod and
 * is timed at the browser as clientMid = t0 + rtt/2. Fitting
 *   hostMs = a * sampleIndex + b
 * gives the actual IMU period (a) and the intercept. Frame timestamps then
 * come from sample_index, not from BLE notify arrival (which is batched).
 *
 * Weight each sync point by 1/rtt and drop high-RTT outliers. One point plus
 * the nominal ODR is enough to start; two or more refine the slope.
 */

const DEFAULT_MAX_POINTS = 16;
const DEFAULT_MAX_RTT_MS = 80;
const SLOPE_TOLERANCE = 2;

/**
 * Recover a 32-bit sample index when the sync characteristic still carries
 * a 16-bit seq (old firmware writes zeros in the pad at offset 18).
 * @param {number} wireSeq
 * @param {number} latestIndex
 */
export function extendSampleIndex(wireSeq, latestIndex) {
  const wire = wireSeq >>> 0;
  const latest = latestIndex >>> 0;
  if (wire > 0xffff) return wire;
  if (latest <= 0xffff) return wire;
  let full = ((latest & 0xffff0000) | (wire & 0xffff)) >>> 0;
  const delta = (full - latest) | 0;
  if (delta > 0x8000) full = (full - 0x10000) >>> 0;
  else if (delta < -0x8000) full = (full + 0x10000) >>> 0;
  return full;
}

/**
 * Weighted least-squares line y = a x + b. x is centered for stability
 * when sampleIndex is in the millions.
 * @param {{x:number,y:number,w:number}[]} points
 * @returns {{a:number,b:number}|null}
 */
export function weightedLinearFit(points) {
  if (!points.length) return null;
  let sw = 0;
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sw += p.w;
    sx += p.w * p.x;
    sy += p.w * p.y;
  }
  if (!(sw > 0)) return null;
  const mx = sx / sw;
  const my = sy / sw;
  if (points.length < 2) {
    return { a: 0, b: my - 0 * mx };
  }
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.x - mx;
    sxx += p.w * dx * dx;
    sxy += p.w * dx * (p.y - my);
  }
  if (!(sxx > 1e-9)) return { a: 0, b: my };
  const a = sxy / sxx;
  return { a, b: my - a * mx };
}

export class PodTimeBase {
  /**
   * @param {{nominalHz?:number,maxPoints?:number,maxRttMs?:number}} [opts]
   */
  constructor(opts = {}) {
    this.nominalHz = opts.nominalHz || 56;
    this.maxPoints = opts.maxPoints || DEFAULT_MAX_POINTS;
    this.maxRttMs = opts.maxRttMs || DEFAULT_MAX_RTT_MS;
    /** @type {{sampleIndex:number,hostMs:number,rttMs:number,w:number}[]} */
    this.points = [];
    this.a = 1000 / this.nominalHz;
    this.b = 0;
    this.ok = false;
    this.rmsMs = Infinity;
    this.lastRttMs = 0;
    this.fitCount = 0;
  }

  /** @param {number} hz */
  setNominalHz(hz) {
    if (hz > 0) this.nominalHz = hz;
    if (!this.ok) this.a = 1000 / this.nominalHz;
  }

  /**
   * @param {{sampleIndex:number,hostMs:number,rttMs:number}} sample
   */
  observe(sample) {
    const rttMs = Math.max(0, Number(sample.rttMs) || 0);
    this.lastRttMs = rttMs;
    if (rttMs > this.maxRttMs) return this.snapshot();
    const sampleIndex = sample.sampleIndex >>> 0;
    const hostMs = Number(sample.hostMs);
    if (!Number.isFinite(hostMs)) return this.snapshot();
    const w = 1 / Math.max(rttMs, 1);
    this.points.push({ sampleIndex, hostMs, rttMs, w });
    if (this.points.length > this.maxPoints) this.points.shift();
    this._fit();
    return this.snapshot();
  }

  _fit() {
    const n = this.points.length;
    if (n < 1) {
      this.ok = false;
      return;
    }
    const nominalA = 1000 / this.nominalHz;
    if (n === 1) {
      this.a = nominalA;
      this.b = this.points[0].hostMs - this.a * this.points[0].sampleIndex;
      this.ok = true;
      this.rmsMs = this.points[0].rttMs / 2;
      this.fitCount += 1;
      return;
    }
    const fit = weightedLinearFit(
      this.points.map((p) => ({ x: p.sampleIndex, y: p.hostMs, w: p.w }))
    );
    if (!fit || !Number.isFinite(fit.a) || fit.a <= 0) {
      this.ok = n >= 1;
      return;
    }
    const lo = nominalA / SLOPE_TOLERANCE;
    const hi = nominalA * SLOPE_TOLERANCE;
    if (fit.a < lo || fit.a > hi) {
      /* Keep intercept from the newest point with nominal slope. */
      const last = this.points[this.points.length - 1];
      this.a = nominalA;
      this.b = last.hostMs - this.a * last.sampleIndex;
    } else {
      this.a = fit.a;
      this.b = fit.b;
    }
    let acc = 0;
    let sw = 0;
    for (const p of this.points) {
      const err = p.hostMs - (this.a * p.sampleIndex + this.b);
      acc += p.w * err * err;
      sw += p.w;
    }
    this.rmsMs = Math.sqrt(acc / Math.max(sw, 1e-9));
    this.ok = true;
    this.fitCount += 1;
  }

  /**
   * Host time for a motion sample. null until the first accepted sync.
   * @param {number} sampleIndex
   * @returns {number|null}
   */
  hostMsFromSample(sampleIndex) {
    if (!this.ok) return null;
    return this.a * (sampleIndex >>> 0) + this.b;
  }

  /** Fitted IMU rate in Hz, or the nominal when unfitted. */
  get fittedHz() {
    return this.a > 0 ? 1000 / this.a : this.nominalHz;
  }

  snapshot() {
    return {
      ok: this.ok,
      a: this.a,
      b: this.b,
      rmsMs: this.rmsMs,
      lastRttMs: this.lastRttMs,
      points: this.points.length,
      fittedHz: this.fittedHz,
    };
  }
}
