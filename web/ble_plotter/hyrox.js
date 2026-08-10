export const HYROX_PROFILE_GENERAL = 0;
export const HYROX_PROFILE = 1;

export const HYROX_STATIONS = {
  run: { label: "Run", rep: false, threshold: 0.55, refractoryMs: 0 },
  ski: { label: "SkiErg", rep: true, threshold: 0.75, refractoryMs: 450 },
  sled_push: { label: "Sled push", rep: false, threshold: 0.65, refractoryMs: 0 },
  sled_pull: { label: "Sled pull", rep: true, threshold: 0.75, refractoryMs: 500 },
  burpee: { label: "Burpee broad jump", rep: true, threshold: 0.80, refractoryMs: 900 },
  row: { label: "Row", rep: true, threshold: 0.65, refractoryMs: 650 },
  carry: { label: "Farmers carry", rep: false, threshold: 0.45, refractoryMs: 0 },
  lunge: { label: "Sandbag lunges", rep: true, threshold: 0.60, refractoryMs: 650 },
  wall_ball: { label: "Wall balls", rep: true, threshold: 0.65, refractoryMs: 550 },
};

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

export class HyroxSession {
  constructor() {
    this.active = false;
    this.station = "run";
    this.podId = null;
    this.startedAt = 0;
    this.lastAt = 0;
    this.lastSignal = 0;
    this.lastRepAt = -Infinity;
    this.reps = 0;
    this.workMs = 0;
    this.effort = 0;
    this.intervals = [];
  }

  start(station, podId) {
    this.active = true;
    this.station = HYROX_STATIONS[station] ? station : "run";
    this.podId = podId;
    this.startedAt = performance.now();
    this.lastAt = this.startedAt;
    this.lastSignal = 0;
    this.lastRepAt = -Infinity;
    this.reps = 0;
    this.workMs = 0;
    this.effort = 0;
    this.intervals = [];
  }

  stop() {
    this.active = false;
  }

  update(session, eng, now = performance.now()) {
    if (!this.active || session.id !== this.podId) return this.snapshot(now);
    const profile = HYROX_STATIONS[this.station];
    const gyro = Math.hypot(eng.gx, eng.gy, eng.gz);
    const accel = Math.abs(Math.hypot(eng.ax, eng.ay, eng.az) - 1);
    const signal = clamp((gyro / 180 + accel / 0.6) / 2, 0, 1.5);
    const dt = Math.max(0, Math.min(now - this.lastAt, 250));
    const working = signal >= profile.threshold;
    if (working) this.workMs += dt;
    this.effort = 0.85 * this.effort + 0.15 * clamp(signal, 0, 1);

    if (profile.rep && signal >= profile.threshold &&
        this.lastSignal < profile.threshold &&
        now - this.lastRepAt >= profile.refractoryMs) {
      this.reps += 1;
      if (this.lastRepAt > 0) {
        this.intervals.push(now - this.lastRepAt);
        if (this.intervals.length > 8) this.intervals.shift();
      }
      this.lastRepAt = now;
    }
    this.lastSignal = signal;
    this.lastAt = now;
    return this.snapshot(now, working);
  }

  snapshot(now = performance.now(), working = this.lastSignal >=
    HYROX_STATIONS[this.station].threshold) {
    const elapsedMs = this.active
      ? Math.max(0, now - this.startedAt)
      : Math.max(0, this.lastAt - this.startedAt);
    const cadence = this.intervals.length
      ? 60000 / (this.intervals.reduce((a, b) => a + b, 0) /
          this.intervals.length)
      : 0;
    return {
      active: this.active,
      profile: HYROX_PROFILE,
      station: this.station,
      stationLabel: HYROX_STATIONS[this.station].label,
      elapsedMs,
      reps: this.reps,
      cadence,
      effort: this.effort,
      workMs: this.workMs,
      working,
    };
  }
}
