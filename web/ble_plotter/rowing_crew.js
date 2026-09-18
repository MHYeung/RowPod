/**
 * Match catch/finish events across seats onto a shared host timeline and
 * compute crew spread plus time-in-sync.
 *
 * 1.4 Honest Crew Clock: forward match from the reference catch. Nearest-in-
 * half-period pairing is what produced 500–700 ms “crew” spreads.
 */

import { ROWPOD_VERSION } from "./version.js";
import { bladeArcM, driveArcDeg } from "./rowing_length.js";

export const DEFAULT_CATCH_SPREAD_MS = 40;
export const MATCH_EARLY_SLACK_MS = 80;
export const MATCH_MAX_LATE_MS = 350;
export const UNTRUSTED_CLOCK_RMS_MS = 15;
export const WIDE_SPREAD_MS = 200;

export const STROKE_CSV_COLUMNS =
  "stroke_index,seat,side,hand,pod_id,t_catch_ms,t_finish_ms,t_feather_ms,catch_deg,finish_deg," +
  "arc_deg,blade_arc_m,feather_catch_deg,feather_finish_deg," +
  "catch_dt_vs_ref_ms,finish_dt_vs_ref_ms,feather_dt_vs_ref_ms,crew_catch_spread_ms," +
  "crew_finish_spread_ms,in_sync,match_quality,spm,timebase_rms_ms,clock_status";

export function matchLateCapMs(periodMs) {
  const p = Number(periodMs);
  if (!Number.isFinite(p) || p < 400) return MATCH_MAX_LATE_MS;
  return Math.min(MATCH_MAX_LATE_MS, 0.32 * p);
}

export function driveWindowMs(periodMs) {
  const p = Number.isFinite(periodMs) && periodMs > 400 ? periodMs : 2000;
  return Math.min(2200, Math.max(900, 0.7 * p));
}

export function recoveryWindowMs(periodMs) {
  const p = Number.isFinite(periodMs) && periodMs > 400 ? periodMs : 2000;
  return Math.min(1200, Math.max(400, 0.45 * p));
}

/**
 * Seat catch minus stroke catch. Positive = this seat is late to the catch.
 * Finish is not required — alignment is a catch-to-catch number.
 */
export function catchDtVsRefMs(seat, ref) {
  const t = seat?.catch?.t;
  const r = ref?.catch?.t;
  if (t == null || r == null) return null;
  return t - r;
}

/**
 * Seat feather-on minus stroke feather-on. Positive = late to the roll.
 * Empty when either seat has no trusted crossing.
 */
export function featherDtVsRefMs(seat, ref) {
  if (!seat?.feather || !ref?.feather) return null;
  if (seat.featherTrusted === false || ref.featherTrusted === false) return null;
  if (seat.clockStatus === "UNTRUSTED_TIME" || ref.clockStatus === "UNTRUSTED_TIME") {
    return null;
  }
  return seat.feather.t - ref.feather.t;
}

/**
 * Coach copy for one seat vs stroke.
 * |dt| above WIDE_SPREAD_MS is matcher garbage, not a crew miss.
 */
export function formatCatchVsStroke(dtMs, windowMs = DEFAULT_CATCH_SPREAD_MS) {
  if (dtMs == null || !Number.isFinite(dtMs)) {
    return { text: "—", kind: "none", dtMs: null };
  }
  const abs = Math.abs(dtMs);
  if (abs > WIDE_SPREAD_MS) {
    return { text: "not this stroke", kind: "untrusted", dtMs };
  }
  if (abs < 0.5) {
    return { text: "with stroke", kind: "together", dtMs: 0 };
  }
  const dir = dtMs > 0 ? "late" : "early";
  const kind = abs > windowMs ? "out" : "in";
  return { text: `${Math.round(abs)} ms ${dir}`, kind, dtMs };
}

/** One sentence: "bow 12 ms late · 7 8 ms early". */
export function coachCatchCue(stroke, windowMs = DEFAULT_CATCH_SPREAD_MS) {
  if (!stroke?.seats?.length) {
    return { text: "—", kind: "none", parts: [] };
  }
  const ref =
    stroke.seats.find((s) => s.id === stroke.referenceId) ||
    stroke.seats.find((s) => s.catch);
  const others = stroke.seats.filter(
    (s) => s.catch && ref && s.id !== ref.id
  );
  if (!ref?.catch) {
    return { text: "—", kind: "none", parts: [] };
  }
  if (!others.length) {
    return {
      text: "Waiting for another catch vs stroke",
      kind: "wait",
      parts: [],
    };
  }
  const parts = others.map((s) => {
    const fmt = formatCatchVsStroke(s.catch.t - ref.catch.t, windowMs);
    return { name: s.seat || "seat", id: s.id, ...fmt };
  });
  if (parts.every((p) => p.kind === "untrusted")) {
    return {
      text: "Catch times not a pair — check matcher",
      kind: "untrusted",
      parts,
    };
  }
  const text = parts
    .map((p) =>
      p.kind === "together" ? `${p.name} with stroke` : `${p.name} ${p.text}`
    )
    .join(" · ");
  const kind = parts.some((p) => p.kind === "out" || p.kind === "untrusted")
    ? "out"
    : parts.every((p) => p.kind === "together")
      ? "together"
      : "in";
  return { text, kind, parts };
}

/** First catch after `afterT` inside [tMin, tMax]. */
export function firstForwardCatch(events, afterT, tMin, tMax) {
  let best = null;
  for (const ev of events) {
    if (ev.t <= afterT) continue;
    if (ev.t < tMin || ev.t > tMax) continue;
    if (!best || ev.t < best.t) best = ev;
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

function clockUntrusted(rms) {
  if (rms == null || rms === "") return false;
  const n = Number(rms);
  return !Number.isFinite(n) || n > UNTRUSTED_CLOCK_RMS_MS;
}

export class CrewSync {
  /**
   * @param {{catchSpreadMs?:number,onStroke?:function}} [opts]
   */
  constructor(opts = {}) {
    this.thresholdMs = opts.catchSpreadMs ?? DEFAULT_CATCH_SPREAD_MS;
    this.onStroke = opts.onStroke || null;
    this.referenceId = null;
    /** @type {Map<string,{catch:object[],finish:object[],feather:object[],meta:object}>} */
    this.buffers = new Map();
    this.strokes = [];
    this.inSyncCount = 0;
    this.ratedCount = 0;
    this.totalMatched = 0;
    this._refCatchTimes = [];
    this.startedAt = null;
    this._pending = null;
    this._pendingRef = null;
    /** @type {string[]|null} null = all seats in the buffers */
    this.activeSeats = null;
  }

  setReference(id) {
    this.referenceId = id || null;
  }

  /** Sampled-crew UI filter. Does not drop radios; ignored seats skip matching. */
  setActiveSeats(seats) {
    this.activeSeats = seats && seats.length ? [...seats] : null;
    this._refreshPending();
  }

  setThresholdMs(ms) {
    if (ms > 0) this.thresholdMs = ms;
  }

  reset() {
    this.buffers.clear();
    this.strokes = [];
    this.inSyncCount = 0;
    this.ratedCount = 0;
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
      buf = { catch: [], finish: [], feather: [], meta: {} };
      this.buffers.set(podId, buf);
    }
    if (!buf.feather) buf.feather = [];
    buf.meta = { ...buf.meta, ...meta, id: podId };
    if (event.type === "feather") {
      buf.feather.push(event);
      if (buf.feather.length > 32) buf.feather.shift();
      if (!this.referenceId) this.referenceId = podId;
      this._refreshPending();
      return this._pending;
    }
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

  _periodMs() {
    if (this._refCatchTimes.length < 2) return 2000;
    const times = this._refCatchTimes;
    return times[times.length - 1] - times[times.length - 2];
  }

  _lastUsedCatchT() {
    /** @type {Map<string, number>} */
    const used = new Map();
    for (const stroke of this.strokes) {
      for (const seat of stroke.seats) {
        if (seat.catch) used.set(seat.id, seat.catch.t);
      }
    }
    return used;
  }

  _commitPending() {
    if (!this._pending) return;
    this.totalMatched += 1;
    this._pending.index = this.totalMatched;
    if (this._pending.inSync != null) {
      this.ratedCount += 1;
      if (this._pending.inSync) this.inSyncCount += 1;
    }
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
    const period = this._periodMs();
    const lateCap = matchLateCapMs(period);
    const driveMs = driveWindowMs(period);
    const tMin = refCatch.t - MATCH_EARLY_SLACK_MS;
    const tMax = refCatch.t + lateCap;
    const used = this._lastUsedCatchT();
    const seats = [];
    for (const [id, buf] of this.buffers) {
      if (this.activeSeats) {
        const seat = buf.meta.seat;
        if (seat && !this.activeSeats.includes(seat)) continue;
      }
      let catchEv = null;
      if (id === this.referenceId) {
        catchEv = refCatch;
      } else {
        const afterT = used.get(id) ?? -Infinity;
        catchEv = firstForwardCatch(buf.catch, afterT, tMin, tMax);
      }
      const finishEv = catchEv
        ? firstAfter(buf.finish, catchEv.t, driveMs)
        : null;
      const recoverMs = recoveryWindowMs(period);
      let featherEv = null;
      if (finishEv) {
        const nextCatch = firstAfter(buf.catch, finishEv.t + 1, recoverMs + 80);
        const endT = Math.min(
          finishEv.t + recoverMs,
          nextCatch ? nextCatch.t : Infinity
        );
        featherEv = firstAfter(buf.feather, finishEv.t, endT - finishEv.t);
      }
      const rms = buf.meta.timebaseRmsMs;
      const featherTrusted = featherEv?.trusted !== false;
      seats.push({
        id,
        seat: buf.meta.seat || "",
        side: buf.meta.side || "",
        hand: buf.meta.hand || "",
        podId: buf.meta.podId,
        timebaseRmsMs: rms,
        clockStatus: clockUntrusted(rms) ? "UNTRUSTED_TIME" : "ok",
        catch: catchEv,
        finish: finishEv,
        feather: featherTrusted ? featherEv : null,
        featherTrusted,
      });
    }

    const complete = seats.filter((s) => s.catch && s.finish);
    const withCatch = seats.filter((s) => s.catch);
    const catchTimes = withCatch.map((s) => s.catch.t);
    const catchSpread =
      catchTimes.length > 1
        ? Math.max(...catchTimes) - Math.min(...catchTimes)
        : null;
    const finishTimes = complete.map((s) => s.finish.t);
    const finishSpread =
      finishTimes.length > 1
        ? Math.max(...finishTimes) - Math.min(...finishTimes)
        : null;

    const clockBad = complete.some((s) => s.clockStatus === "UNTRUSTED_TIME");
    let inSync = null;
    let matchQuality = "ok";
    if (complete.length < 2) {
      if (withCatch.length < 2) matchQuality = "single_seat";
      else matchQuality = "missing_finish";
    } else if (clockBad) {
      matchQuality = "untrusted_time";
    } else {
      inSync = catchSpread <= this.thresholdMs;
      if (catchSpread > WIDE_SPREAD_MS) matchQuality = "wide_spread";
    }

    const catchAngles = complete.map((s) => s.catch.theta);
    const finishAngles = complete.map((s) => s.finish.theta);
    return {
      index: this.totalMatched + 1,
      referenceId: this.referenceId,
      tCatch: refCatch.t,
      catchSpreadMs: catchSpread,
      finishSpreadMs: finishSpread,
      catchSeats: withCatch.length,
      completeSeats: complete.length,
      matchQuality,
      catchAngleSpread:
        catchAngles.length > 1
          ? Math.max(...catchAngles) - Math.min(...catchAngles)
          : 0,
      finishAngleSpread:
        finishAngles.length > 1
          ? Math.max(...finishAngles) - Math.min(...finishAngles)
          : 0,
      inSync,
      spm: this._spm(),
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
    const pendingRated = this._pending && this._pending.inSync != null;
    const liveRated = this.ratedCount + (pendingRated ? 1 : 0);
    const liveIn =
      this.inSyncCount + (this._pending?.inSync === true ? 1 : 0);
    const pct = liveRated ? (100 * liveIn) / liveRated : 0;
    return {
      referenceId: this.referenceId,
      thresholdMs: this.thresholdMs,
      timeInSyncPct: pct,
      inSyncCount: liveIn,
      ratedStrokes: liveRated,
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
 * @param {{boatClass?:string,strokeSits?:string,inboardM?:number,outboardM?:number}} [meta]
 */
export function strokesToCsv(strokes, t0 = 0, meta = {}) {
  const inboardM = Number(meta.inboardM);
  const outboardM = Number(meta.outboardM);
  const lines = [
    "# RowPod per-stroke CSV v1.4",
    `# rowpod_version=${ROWPOD_VERSION}`,
    `# boat_class=${meta.boatClass || ""}`,
    `# stroke_sits=${meta.strokeSits || ""}`,
    `# inboard_m=${Number.isFinite(inboardM) ? inboardM.toFixed(3) : ""}`,
    `# outboard_m=${Number.isFinite(outboardM) ? outboardM.toFixed(3) : ""}`,
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
      const inSyncCell =
        stroke.inSync == null ? "" : stroke.inSync ? "1" : "0";
      const arc = driveArcDeg(seat.catch?.theta, seat.finish?.theta);
      const bladeM = bladeArcM(arc, outboardM);
      const featherDt = featherDtVsRefMs(seat, ref);
      const tFeather =
        seat.feather && seat.clockStatus !== "UNTRUSTED_TIME"
          ? seat.feather.t
          : null;
      lines.push(
        [
          stroke.index,
          csvEscape(seat.seat),
          csvEscape(seat.side),
          csvEscape(seat.hand),
          csvEscape(seat.podId ?? seat.id),
          catchT != null ? (catchT - t0).toFixed(1) : "",
          finishT != null ? (finishT - t0).toFixed(1) : "",
          tFeather != null ? (tFeather - t0).toFixed(1) : "",
          seat.catch ? seat.catch.theta.toFixed(2) : "",
          seat.finish ? seat.finish.theta.toFixed(2) : "",
          arc != null ? arc.toFixed(2) : "",
          bladeM != null ? bladeM.toFixed(3) : "",
          seat.catch?.feather != null ? Number(seat.catch.feather).toFixed(2) : "",
          seat.finish?.feather != null ? Number(seat.finish.feather).toFixed(2) : "",
          catchT != null && refCatch != null ? (catchT - refCatch).toFixed(1) : "",
          finishT != null && refFinish != null
            ? (finishT - refFinish).toFixed(1)
            : "",
          featherDt != null ? featherDt.toFixed(1) : "",
          stroke.catchSpreadMs != null ? stroke.catchSpreadMs.toFixed(1) : "",
          stroke.finishSpreadMs != null ? stroke.finishSpreadMs.toFixed(1) : "",
          inSyncCell,
          csvEscape(stroke.matchQuality || ""),
          stroke.spm ? stroke.spm.toFixed(1) : "",
          seat.timebaseRmsMs != null ? Number(seat.timebaseRmsMs).toFixed(1) : "",
          csvEscape(seat.clockStatus || ""),
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
