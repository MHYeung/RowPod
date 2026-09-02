/**
 * Match catch/finish events across seats onto a shared host timeline and
 * compute crew spread plus time-in-sync.
 */

import { ROWPOD_VERSION } from "./version.js";

export const DEFAULT_CATCH_SPREAD_MS = 40;
export const STROKE_CSV_COLUMNS =
  "stroke_index,seat,side,hand,pod_id,t_catch_ms,t_finish_ms,catch_deg,finish_deg," +
  "arc_deg,feather_catch_deg,feather_finish_deg," +
  "catch_dt_vs_ref_ms,finish_dt_vs_ref_ms,crew_catch_spread_ms," +
  "crew_finish_spread_ms,in_sync,spm,timebase_rms_ms";

function nearest(events, t, windowMs) {
  let best = null;
  let bestAbs = Infinity;
  for (const ev of events) {
    const d = Math.abs(ev.t - t);
    if (d <= windowMs && d < bestAbs) {
      best = ev;
      bestAbs = d;
    }
  }
  return best;
}

function firstAfter(events, t, windowMs) {
  let best = null;
  for (const ev of events) {
    const d = ev.t - t;
    if (d >= 0 && d <= windowMs && (!best || ev.t < best.t)) best = ev;
  }
  return best;
}

function csvEscape(s) {
  const t = String(s ?? "");
  if (/[",\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

export class CrewSync {
  /**
   * @param {{catchSpreadMs?:number,onStroke?:function}} [opts]
   */
  constructor(opts = {}) {
    this.thresholdMs = opts.catchSpreadMs ?? DEFAULT_CATCH_SPREAD_MS;
    this.onStroke = opts.onStroke || null;
    this.referenceId = null;
    /** @type {Map<string,{catch:object[],finish:object[],meta:object}>} */
    this.buffers = new Map();
    this.strokes = [];
    this.inSyncCount = 0;
    this.totalMatched = 0;
    this._refCatchTimes = [];
    this.startedAt = null;
    this._pending = null;
    this._pendingRef = null;
  }

  setReference(id) {
    this.referenceId = id || null;
  }

  setThresholdMs(ms) {
    if (ms > 0) this.thresholdMs = ms;
  }

  reset() {
    this.buffers.clear();
    this.strokes = [];
    this.inSyncCount = 0;
    this.totalMatched = 0;
    this._refCatchTimes = [];
    this.startedAt = null;
    this._pending = null;
    this._pendingRef = null;
  }

  start() {
    this.reset();
    this.startedAt = performance.now();
  }

  /** Flush the in-progress stroke (call on Stop so the last catch is counted). */
  commit() {
    this._commitPending();
    this._pendingRef = null;
  }

  /**
   * @param {string} podId
   * @param {{type:string,t:number,theta:number}} event
   * @param {{seat?:string,side?:string,hand?:string,podId?:number,timebaseRmsMs?:number}} [meta]
   */
  observeEvent(podId, event, meta = {}) {
    if (!event || !podId) return null;
    let buf = this.buffers.get(podId);
    if (!buf) {
      buf = { catch: [], finish: [], meta: {} };
      this.buffers.set(podId, buf);
    }
    buf.meta = { ...buf.meta, ...meta, id: podId };
    const list = event.type === "finish" ? buf.finish : buf.catch;
    list.push(event);
    if (list.length > 32) list.shift();

    if (!this.referenceId) this.referenceId = podId;
    if (event.type !== "catch") {
      this._refreshPending();
      return this._pending;
    }
    if (podId === this.referenceId) {
      this._commitPending();
      this._pendingRef = event;
      this._refCatchTimes.push(event.t);
      if (this._refCatchTimes.length > 12) this._refCatchTimes.shift();
    }
    return this._refreshPending();
  }

  _halfPeriodMs() {
    if (this._refCatchTimes.length < 2) return 800;
    const times = this._refCatchTimes;
    const last = times[times.length - 1] - times[times.length - 2];
    return Math.max(400, Math.min(1500, last / 2));
  }

  _commitPending() {
    if (!this._pending) return;
    this.totalMatched += 1;
    this._pending.index = this.totalMatched;
    if (this._pending.inSync) this.inSyncCount += 1;
    this.strokes.push(this._pending);
    if (this.strokes.length > 400) this.strokes.shift();
    if (this.onStroke) this.onStroke(this._pending);
    this._pending = null;
  }

  _refreshPending() {
    if (!this._pendingRef) return null;
    this._pending = this._buildStroke(this._pendingRef);
    return this._pending;
  }

  _buildStroke(refCatch) {
    const windowMs = this._halfPeriodMs();
    const driveMs = windowMs * 2.4;
    const seats = [];
    for (const [id, buf] of this.buffers) {
      const catchEv = nearest(buf.catch, refCatch.t, windowMs);
      const finishEv = catchEv
        ? firstAfter(buf.finish, catchEv.t, driveMs)
        : null;
      seats.push({
        id,
        seat: buf.meta.seat || "",
        side: buf.meta.side || "",
        hand: buf.meta.hand || "",
        podId: buf.meta.podId,
        timebaseRmsMs: buf.meta.timebaseRmsMs,
        catch: catchEv,
        finish: finishEv,
      });
    }

    const withCatch = seats.filter((s) => s.catch);
    if (withCatch.length < 1) return null;

    const catchTimes = withCatch.map((s) => s.catch.t);
    const catchSpread = Math.max(...catchTimes) - Math.min(...catchTimes);
    const withFinish = seats.filter((s) => s.finish);
    const finishTimes = withFinish.map((s) => s.finish.t);
    const finishSpread = finishTimes.length
      ? Math.max(...finishTimes) - Math.min(...finishTimes)
      : null;

    const catchAngles = withCatch.map((s) => s.catch.theta);
    const finishAngles = withFinish.map((s) => s.finish.theta);
    const inSync = catchSpread <= this.thresholdMs;
    const spm = this._spm();
    return {
      index: this.totalMatched + 1,
      referenceId: this.referenceId,
      tCatch: refCatch.t,
      catchSpreadMs: catchSpread,
      finishSpreadMs: finishSpread,
      catchAngleSpread:
        catchAngles.length > 1
          ? Math.max(...catchAngles) - Math.min(...catchAngles)
          : 0,
      finishAngleSpread:
        finishAngles.length > 1
          ? Math.max(...finishAngles) - Math.min(...finishAngles)
          : 0,
      inSync,
      spm,
      seats,
    };
  }

  _spm() {
    if (this._refCatchTimes.length < 2) return 0;
    const n = Math.min(5, this._refCatchTimes.length - 1);
    const t1 = this._refCatchTimes[this._refCatchTimes.length - 1];
    const t0 = this._refCatchTimes[this._refCatchTimes.length - 1 - n];
    const mean = (t1 - t0) / n;
    return mean > 200 ? 60000 / mean : 0;
  }

  snapshot() {
    const last = this._pending || this.strokes[this.strokes.length - 1] || null;
    const liveTotal = this.totalMatched + (this._pending ? 1 : 0);
    const liveIn = this.inSyncCount + (this._pending?.inSync ? 1 : 0);
    const pct = liveTotal ? (100 * liveIn) / liveTotal : 0;
    return {
      referenceId: this.referenceId,
      thresholdMs: this.thresholdMs,
      timeInSyncPct: pct,
      inSyncCount: liveIn,
      totalMatched: liveTotal,
      spm: this._spm(),
      last,
      strokes: this.strokes,
    };
  }
}

/**
 * Long-format per-seat-per-stroke CSV for researchers.
 * @param {object[]} strokes
 * @param {number} [t0]
 * @param {{boatClass?:string,strokeSits?:string}} [meta]
 */
export function strokesToCsv(strokes, t0 = 0, meta = {}) {
  const lines = [
    "# RowPod per-stroke CSV v1.3",
    `# rowpod_version=${ROWPOD_VERSION}`,
    `# boat_class=${meta.boatClass || ""}`,
    `# stroke_sits=${meta.strokeSits || ""}`,
    `# created_iso=${new Date().toISOString()}`,
    `# columns=${STROKE_CSV_COLUMNS}`,
    STROKE_CSV_COLUMNS,
  ];
  for (const stroke of strokes) {
    for (const seat of stroke.seats) {
      const ref = stroke.seats.find((s) => s.id === stroke.referenceId) ||
        stroke.seats[0];
      const catchT = seat.catch?.t;
      const finishT = seat.finish?.t;
      const refCatch = ref?.catch?.t;
      const refFinish = ref?.finish?.t;
      lines.push(
        [
          stroke.index,
          csvEscape(seat.seat),
          csvEscape(seat.side),
          csvEscape(seat.hand),
          csvEscape(seat.podId ?? seat.id),
          catchT != null ? (catchT - t0).toFixed(1) : "",
          finishT != null ? (finishT - t0).toFixed(1) : "",
          seat.catch ? seat.catch.theta.toFixed(2) : "",
          seat.finish ? seat.finish.theta.toFixed(2) : "",
          seat.catch && seat.finish
            ? (seat.finish.theta - seat.catch.theta).toFixed(2)
            : "",
          seat.catch?.feather != null ? Number(seat.catch.feather).toFixed(2) : "",
          seat.finish?.feather != null ? Number(seat.finish.feather).toFixed(2) : "",
          catchT != null && refCatch != null ? (catchT - refCatch).toFixed(1) : "",
          finishT != null && refFinish != null
            ? (finishT - refFinish).toFixed(1)
            : "",
          stroke.catchSpreadMs.toFixed(1),
          stroke.finishSpreadMs != null ? stroke.finishSpreadMs.toFixed(1) : "",
          stroke.inSync ? 1 : 0,
          stroke.spm ? stroke.spm.toFixed(1) : "",
          seat.timebaseRmsMs != null ? Number(seat.timebaseRmsMs).toFixed(1) : "",
        ].join(",")
      );
    }
  }
  return lines.join("\n") + "\n";
}

export function downloadStrokeCsv(
  strokes,
  filename = "rowpod_strokes.csv",
  t0 = 0,
  meta = {}
) {
  if (!strokes.length) return;
  const blob = new Blob([strokesToCsv(strokes, t0, meta)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
