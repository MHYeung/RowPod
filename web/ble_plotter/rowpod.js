import { RATE_LIVE_HZ, PROFILE_ROWING, POD_COLORS } from "./protocol.js";
import { PodRegistry } from "./pod_registry.js";
import { OarAngleTracker } from "./rowing_angle.js";
import { CrewSync, downloadStrokeCsv, coachCatchCue, formatCatchVsStroke, catchDtVsRefMs, featherDtVsRefMs } from "./rowing_crew.js";
import {
  FAN_ARC_CCW,
  FAN_MAX_DEG,
  FAN_MIN_DEG,
  clampFanDeg,
  oarToCanvasRad,
  oarToXY,
  seatLaneRadius,
} from "./rowing_fan.js";
import { ROWPOD_VERSION } from "./version.js";
import {
  BOAT_CLASS_ORDER,
  CREW_PRESETS,
  getBoatClass,
  defaultHandForSeat,
  portStarboardFromHand,
  nominalArcCentreDeg,
  seatInBoat,
  loadRig,
  saveRig,
  rigWithBoatClass,
} from "./boat_rig.js";
import { bladeArcM, driveArcDeg, spanCmToM } from "./rowing_length.js";

const statusEl = document.getElementById("status");
const btnAddPod = document.getElementById("btnAddPod");
const btnDisconnect = document.getElementById("btnDisconnect");
const btnZero = document.getElementById("btnZero");
const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const btnCsv = document.getElementById("btnCsv");
const syncPctEl = document.getElementById("syncPct");
const spmEl = document.getElementById("spm");
const catchSpreadEl = document.getElementById("catchSpread");
const finishSpreadEl = document.getElementById("finishSpread");
const strokeCountEl = document.getElementById("strokeCount");
const featherLiveEl = document.getElementById("featherLive");
const arcLiveEl = document.getElementById("arcLive");
const bladeLiveEl = document.getElementById("bladeLive");
const inboardCmEl = document.getElementById("inboardCm");
const outboardCmEl = document.getElementById("outboardCm");
const fanCanvas = document.getElementById("fan");
const seatRowsEl = document.getElementById("seatRows");
const podListEl = document.getElementById("podList");
const thresholdEl = document.getElementById("thresholdMs");
const thresholdLabel = document.getElementById("thresholdLabel");
const boatClassEl = document.getElementById("boatClass");
const strokeSitsEl = document.getElementById("strokeSits");
const boatKindEl = document.getElementById("boatKind");
const crewPresetEl = document.getElementById("crewPreset");
const matchNoteEl = document.getElementById("matchNote");
const catchCueEl = document.getElementById("catchCue");
const alignRailEl = document.getElementById("alignRail");
const alignTrackEl = document.getElementById("alignTrack");
const podCountEl = document.getElementById("podCount");
const podCountLabel = document.getElementById("podCountLabel");
const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const cueKinds = ["together", "in", "out", "untrusted", "wait", "none"];

function reducedMotion() {
  return motionQuery.matches;
}

function setStatus(text, cls = "") {
  statusEl.textContent = text;
  statusEl.className = `status ${cls}`;
}

function fmtDeg(v) {
  return v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(0)}°`;
}

function fmtEstDeg(v, estimate) {
  const text = fmtDeg(v);
  return estimate && text !== "—" ? `~${text}` : text;
}

function fmtMs(v) {
  return v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(0)} ms`;
}

function fmtM(v) {
  return v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(2)} m`;
}

try {
  document.title = `RowPod ${ROWPOD_VERSION}`;
  document.querySelectorAll("[data-rowpod-version]").forEach((el) => {
    el.textContent = ROWPOD_VERSION;
  });
  if (!navigator.bluetooth) {
    throw new Error("Web Bluetooth missing — use Android Chrome or desktop Chrome/Edge over HTTPS.");
  }

  const registry = new PodRegistry();
  const crew = new CrewSync({ catchSpreadMs: Number(thresholdEl.value) });
  /** @type {Map<string, OarAngleTracker>} */
  const trackers = new Map();
  let pieceActive = false;
  let pieceT0 = 0;
  let rig = loadRig();
  /** @type {Map<string, {theta:number, arcKey:string, revealT0:number}>} */
  const fanMotion = new Map();
  /** @type {Map<string, HTMLTableRowElement>} */
  const rowCache = new Map();
  /** @type {Map<string, HTMLElement>} */
  const markCache = new Map();
  const knownPods = new Set();
  let syncTarget;
  let syncShown = 0;
  let syncRaf = 0;
  let seenMatched = null;

  function syncRigControls() {
    const boat = getBoatClass(rig.boatClass);
    if (boatKindEl) boatKindEl.textContent = boat.kind;
    if (boatClassEl) boatClassEl.value = boat.id;
    if (strokeSitsEl) strokeSitsEl.value = rig.strokeSits;
    if (inboardCmEl) inboardCmEl.value = String(Math.round(rig.inboardM * 100));
    if (outboardCmEl) outboardCmEl.value = String(Math.round(rig.outboardM * 100));
  }

  function persistRig() {
    saveRig(rig);
    syncRigControls();
  }

  function assignPod(session, opts = {}) {
    const boat = getBoatClass(rig.boatClass);
    let seat = opts.seat !== undefined ? opts.seat : session.seat;
    if (seat && !seatInBoat(rig.boatClass, seat)) seat = "";
    let hand = opts.hand;
    if (hand !== "stroke" && hand !== "bow") {
      if (boat.kind === "sweep" && seat && opts.fromSeat) {
        hand = defaultHandForSeat(rig.boatClass, seat);
      } else {
        hand = session.hand === "bow" ? "bow" : "stroke";
      }
    }
    const side = portStarboardFromHand(hand, rig.strokeSits);
    registry.assignSeat(session.id, { seat, hand, side });
  }

  function presetSeatList() {
    const id = crewPresetEl?.value || "all";
    const p = CREW_PRESETS.find((x) => x.id === id);
    return p?.seats || null;
  }

  function sessionInSample(session) {
    const seats = presetSeatList();
    if (!seats) return true;
    if (!session.seat) return true;
    return seats.includes(session.seat);
  }

  function applyRigToAllPods({ fromSeat }) {
    for (const session of registry.list()) {
      assignPod(session, { fromSeat });
    }
  }

  if (boatClassEl) {
    boatClassEl.replaceChildren();
    for (const id of BOAT_CLASS_ORDER) {
      const boat = getBoatClass(id);
      const opt = document.createElement("option");
      opt.value = boat.id;
      opt.textContent = boat.label;
      boatClassEl.appendChild(opt);
    }
    syncRigControls();
    boatClassEl.addEventListener("change", () => {
      rig = rigWithBoatClass(rig, boatClassEl.value);
      persistRig();
      applyRigToAllPods({ fromSeat: true });
    });
  }
  if (strokeSitsEl) {
    strokeSitsEl.addEventListener("change", () => {
      rig = { ...rig, strokeSits: strokeSitsEl.value === "port" ? "port" : "starboard" };
      persistRig();
      applyRigToAllPods({ fromSeat: false });
    });
  }
  function readSpanInputs() {
    rig = {
      ...rig,
      inboardM: spanCmToM(inboardCmEl?.value, rig.inboardM),
      outboardM: spanCmToM(outboardCmEl?.value, rig.outboardM),
      spansCustom: true,
    };
    persistRig();
  }
  if (inboardCmEl) inboardCmEl.addEventListener("change", readSpanInputs);
  if (outboardCmEl) outboardCmEl.addEventListener("change", readSpanInputs);
  if (crewPresetEl) {
    crewPresetEl.replaceChildren();
    for (const p of CREW_PRESETS) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.label;
      crewPresetEl.appendChild(opt);
    }
    crewPresetEl.value = "all";
    crewPresetEl.addEventListener("change", () => {
      crew.setActiveSeats(presetSeatList());
      renderTable();
      setButtons();
    });
  }

  function trackerFor(session) {
    let tr = trackers.get(session.id);
    if (!tr) {
      tr = new OarAngleTracker();
      trackers.set(session.id, tr);
    }
    tr.setSign(session.side === "port" ? -1 : 1);
    tr.setNominalCentre(nominalArcCentreDeg(getBoatClass(rig.boatClass).kind));
    return tr;
  }

  function liveSeats() {
    return registry.list().filter(sessionInSample).map((session) => {
      const tr = trackers.get(session.id);
      const snap = tr?.snapshot() || {};
      return {
        id: session.id,
        seat: session.seat || session.position,
        side: session.side,
        color: session.color,
        theta: snap.theta,
        feather: snap.feather,
        catch: snap.lastCatch,
        finish: snap.lastFinish,
        arcDeg: snap.arcDeg,
        rms: session.timebase?.rmsMs,
        zeroed: snap.zeroed,
      };
    });
  }

  function paintHaloText(ctx, text, x, y, fill) {
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#392d37";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function fanState(seat) {
    let state = fanMotion.get(seat.id);
    if (!state) {
      state = {
        theta: Number.isFinite(seat.theta) ? seat.theta : 0,
        arcKey: "",
        revealT0: 0,
      };
      fanMotion.set(seat.id, state);
    }
    return state;
  }

  function smoothTheta(state, target) {
    if (!Number.isFinite(target)) return state.theta;
    if (reducedMotion() || !Number.isFinite(state.theta)) {
      state.theta = target;
      return target;
    }
    const next = state.theta + (target - state.theta) * 0.28;
    state.theta = Math.abs(target - next) < 0.04 ? target : next;
    return state.theta;
  }

  function arcReveal(state, key, now) {
    if (!key) return 1;
    if (state.arcKey !== key) {
      state.arcKey = key;
      state.revealT0 = now;
    }
    if (reducedMotion()) return 1;
    const u = Math.min(1, (now - state.revealT0) / 250);
    return 1 - (1 - u) ** 3;
  }

  function drawFan() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssW = fanCanvas.clientWidth || 360;
    const cssH = fanCanvas.clientHeight || Math.round(cssW * 0.6);
    const bw = Math.max(1, Math.round(cssW * dpr));
    const bh = Math.max(1, Math.round(cssH * dpr));
    if (fanCanvas.width !== bw || fanCanvas.height !== bh) {
      fanCanvas.width = bw;
      fanCanvas.height = bh;
    }
    const ctx = fanCanvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const wash = ctx.createRadialGradient(cssW * 0.5, cssH * 0.2, cssW * 0.08, cssW * 0.5, cssH * 0.72, cssW * 0.72);
    wash.addColorStop(0, "rgba(81, 65, 77, 0.28)");
    wash.addColorStop(1, "rgba(16, 10, 14, 0.55)");
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, cssW, cssH);

    const padX = Math.max(48, cssW * 0.1);
    const cx = cssW / 2;
    const cy = cssH - 28;
    const r = Math.max(48, Math.min(cx - padX, cy - 34));
    const toXY = (deg, radius) => oarToXY(deg, radius, cx, cy);

    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.arc(cx, cy, r, oarToCanvasRad(FAN_MIN_DEG), oarToCanvasRad(FAN_MAX_DEG), FAN_ARC_CCW);
    ctx.closePath();
    ctx.fillStyle = "rgba(224, 228, 213, 0.07)";
    ctx.fill();

    ctx.strokeStyle = "#8a8388";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, oarToCanvasRad(FAN_MIN_DEG), oarToCanvasRad(FAN_MAX_DEG), FAN_ARC_CCW);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(toXY(FAN_MIN_DEG, r).x, cy);
    ctx.lineTo(toXY(FAN_MAX_DEG, r).x, cy);
    ctx.stroke();

    ctx.strokeStyle = "#6f6870";
    ctx.fillStyle = "#e0e4d5";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "600 16px Segoe UI, system-ui, sans-serif";
    for (const tick of [-90, -60, -30, 0, 30, 60, 90]) {
      const a = toXY(tick, r);
      const b = toXY(tick, r + 12);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      const lab = toXY(tick, tick === 0 ? r + 26 : r + 30);
      ctx.fillText(`${tick}°`, lab.x, lab.y);
    }

    ctx.font = "700 13px Segoe UI, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("CATCH", toXY(-90, r).x, cy + 16);
    ctx.textAlign = "right";
    ctx.fillText("FINISH", toXY(90, r).x, cy + 16);

    const seats = liveSeats();
    const now = performance.now();
    const liveIds = new Set(seats.map((s) => s.id));
    for (const id of fanMotion.keys()) {
      if (!liveIds.has(id)) fanMotion.delete(id);
    }
    const withArc = seats.filter((s) => s.catch && s.finish);
    const laneN = Math.max(withArc.length, 1);
    const barFloor = laneN > 4 ? 7 : 12;
    const barW = Math.max(barFloor, Math.min(20, (r * 0.36) / laneN));

    withArc.forEach((seat, i) => {
      const inner = seatLaneRadius(i, laneN, r);
      const cDeg = clampFanDeg(seat.catch.theta);
      const fDeg = clampFanDeg(seat.finish.theta);
      const motion = fanState(seat);
      const reveal = arcReveal(motion, `${seat.catch.t}|${seat.finish.t}`, now);
      const shownFinish = cDeg + (fDeg - cDeg) * reveal;
      const color = seat.color || POD_COLORS[i];
      ctx.strokeStyle = color;
      ctx.lineWidth = barW;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(cx, cy, inner, oarToCanvasRad(cDeg), oarToCanvasRad(shownFinish), FAN_ARC_CCW);
      ctx.stroke();
      const start = toXY(cDeg, inner);
      const end = toXY(shownFinish, inner);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(start.x, start.y, barW * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(end.x, end.y, barW * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "700 17px Segoe UI, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const span = Math.abs(fDeg - cDeg);
      if (span < 18) {
        const mid = toXY((cDeg + fDeg) / 2, inner + barW * 0.9);
        paintHaloText(
          ctx,
          `${Math.round(seat.catch.theta)}→${Math.round(seat.finish.theta)}°`,
          mid.x,
          mid.y,
          color
        );
      } else {
        const catchLab = toXY(cDeg, inner + barW * 0.9);
        const finishLab = toXY(fDeg, inner + barW * 0.9);
        paintHaloText(ctx, `${Math.round(seat.catch.theta)}°`, catchLab.x, catchLab.y, color);
        paintHaloText(ctx, `${Math.round(seat.finish.theta)}°`, finishLab.x, finishLab.y, color);
        if (span > 28) {
          ctx.font = "600 13px Segoe UI, system-ui, sans-serif";
          const mid = toXY((cDeg + fDeg) / 2, inner);
          paintHaloText(ctx, String(seat.seat || "seat"), mid.x, mid.y, "#e0e4d5");
        }
      }
    });

    for (const seat of seats) {
      if (seat.theta == null || !Number.isFinite(seat.theta)) continue;
      const shown = clampFanDeg(smoothTheta(fanState(seat), seat.theta));
      const tip = toXY(shown, r * 0.96);
      ctx.strokeStyle = seat.color;
      ctx.lineWidth = 3.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      const fRad = ((seat.feather || 0) * Math.PI) / 180;
      const blade = 18 * Math.cos(fRad);
      const rad = (shown * Math.PI) / 180;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(tip.x - Math.cos(rad) * blade, tip.y - Math.sin(rad) * blade);
      ctx.lineTo(tip.x + Math.cos(rad) * blade, tip.y + Math.sin(rad) * blade);
      ctx.stroke();
    }

    ctx.fillStyle = "#e0e4d5";
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  function renderAlignRail(stroke, thresholdMs) {
    if (!alignRailEl || !alignTrackEl) return;
    const ref = stroke?.seats.find((s) => s.id === stroke.referenceId);
    const caught = stroke?.seats.filter((s) => s.catch) || [];
    if (!ref?.catch || caught.length < 2) {
      alignRailEl.hidden = true;
      if (markCache.size) {
        for (const mark of markCache.values()) mark.remove();
        markCache.clear();
      }
      return;
    }
    alignRailEl.hidden = false;
    const span = Math.max(thresholdMs * 1.6, 64);
    const sessions = registry.list();
    const colorOf = (id) => sessions.find((s) => s.id === id)?.color || "#392d37";
    let windowEl = alignTrackEl.querySelector(".align-window");
    if (!windowEl) {
      windowEl = document.createElement("div");
      windowEl.className = "align-window";
      alignTrackEl.prepend(windowEl);
    }
    const winPct = (thresholdMs / span) * 50;
    windowEl.style.left = `${Math.max(0, 50 - winPct)}%`;
    windowEl.style.width = `${Math.min(100, winPct * 2)}%`;
    const seen = new Set();
    for (const seat of caught) {
      const dt = seat.id === ref.id ? 0 : seat.catch.t - ref.catch.t;
      const fmt = formatCatchVsStroke(dt, thresholdMs);
      if (fmt.kind === "untrusted") continue;
      seen.add(seat.id);
      let mark = markCache.get(seat.id);
      if (!mark) {
        mark = document.createElement("span");
        markCache.set(seat.id, mark);
        alignTrackEl.appendChild(mark);
      }
      const pct = 50 + (50 * Math.max(-span, Math.min(span, dt))) / span;
      const cls = `mark${seat.id === ref.id ? " ref" : ""}${fmt.kind === "out" ? " out" : ""}`;
      if (mark.className !== cls) mark.className = cls;
      mark.style.left = `${pct}%`;
      const bg = seat.id === ref.id ? "" : colorOf(seat.id);
      if (mark.dataset.bg !== bg) {
        mark.dataset.bg = bg;
        mark.style.background = bg;
      }
      const title = `${seat.seat || "seat"} ${fmt.text}`;
      if (mark.title !== title) mark.title = title;
    }
    for (const [id, mark] of markCache) {
      if (!seen.has(id)) {
        mark.remove();
        markCache.delete(id);
      }
    }
  }

  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  function cellClass(kind, isRef) {
    if (isRef || kind === "none") return "";
    if (kind === "out" || kind === "untrusted") return "late-out";
    if (kind === "together") return "late-in";
    return "";
  }

  function renderTable() {
    const sessions = registry.list().filter(sessionInSample);
    const snap = crew.snapshot();
    const last = snap.last;
    const seen = new Set();
    sessions.forEach((session, index) => {
      seen.add(session.id);
      const tr = trackers.get(session.id);
      const angle = tr?.snapshot() || {};
      const matched = last?.seats.find((s) => s.id === session.id);
      const ref = last?.seats.find((s) => s.id === last.referenceId);
      const catchEv = matched?.catch || angle.lastCatch;
      const finishEv = matched?.finish || angle.lastFinish;
      const matchedArc = driveArcDeg(matched?.catch?.theta, matched?.finish?.theta);
      const lengthM = bladeArcM(matchedArc, rig.outboardM);
      const arc =
        matchedArc != null
          ? matchedArc
          : driveArcDeg(catchEv?.theta, finishEv?.theta) ?? angle.arcDeg;
      const dFeather = featherDtVsRefMs(matched, ref);
      let row = rowCache.get(session.id);
      if (!row) {
        row = document.createElement("tr");
        for (let i = 0; i < 11; i++) row.appendChild(document.createElement("td"));
        rowCache.set(session.id, row);
      }
      const dCatch = catchDtVsRefMs(matched, ref);
      const dFinish =
        matched?.finish && ref?.finish
          ? matched.finish.t - ref.finish.t
          : null;
      const vs = formatCatchVsStroke(dCatch, snap.thresholdMs);
      const vsFeather = formatCatchVsStroke(dFeather, snap.thresholdMs);
      const isRef = Boolean(matched && ref && matched.id === ref.id);
      const rms = session.timebase?.ok ? session.timebase.rmsMs : null;
      row.classList.toggle(
        "warn-spread",
        last?.matchQuality === "wide_spread" || vs.kind === "untrusted"
      );
      const vsCell = isRef ? "stroke" : vs.text;
      const featherCell = isRef ? (matched?.feather ? "stroke" : "—") : vsFeather.text;
      const cells = row.children;
      const estimated = angle.angleRef === "auto" || catchEv?.ref === "auto";
      const values = [
        session.seat || session.position,
        session.hand === "bow" ? "bow" : session.hand === "stroke" ? "stroke" : "—",
        fmtEstDeg(catchEv?.theta, estimated),
        fmtEstDeg(finishEv?.theta, estimated),
        fmtDeg(arc),
        fmtM(lengthM),
        featherCell,
        vsCell,
        fmtMs(dFinish),
        rms != null && Number.isFinite(rms) ? `±${rms.toFixed(0)}` : "—",
        finishEv?.driveIndex != null && Number.isFinite(finishEv.driveIndex)
          ? `${Math.round(finishEv.driveIndex)}`
          : "—",
      ];
      const classes = [
        "",
        "",
        "",
        "",
        "",
        "",
        cellClass(vsFeather.kind, isRef),
        cellClass(vs.kind, isRef),
        "",
        "",
        "",
      ];
      for (let i = 0; i < values.length; i++) {
        setText(cells[i], values[i]);
        if (cells[i].className !== classes[i]) cells[i].className = classes[i];
      }
      const at = seatRowsEl.children[index];
      if (at !== row) seatRowsEl.insertBefore(row, at || null);
    });
    for (const [id, row] of rowCache) {
      if (!seen.has(id)) {
        row.remove();
        rowCache.delete(id);
      }
    }
  }

  function podMetaHtml(session) {
    const tb = session.timebase;
    const clockHealth =
      session.status !== "connected" ? "bad" : tb?.ok ? "good" : "warn";
    const age = performance.now() - (session.lastFrameAt || 0);
    const flow =
      session.sensorStatus === "paused"
        ? "paused"
        : session.status === "connected" && age > 1500
          ? "stale"
          : session.sensorStatus;
    const angle = trackers.get(session.id)?.snapshot() || {};
    const motion = session.client.usesV16Motion
      ? "raw gyro"
      : session.client.usesFusedMotion
        ? "mag yaw"
        : "raw gyro v1";
    const confLabel = {
      centring: "row one stroke to centre",
      auto: "auto centre · est. degrees",
      zero: "Zero first",
      yaw: "low — mag heading",
      ok: "gyro settling",
      high: "gyro lock",
    }[angle.confidence || "centring"];
    const featherChip =
      angle.angleRef && angle.angleRef !== "none" && angle.featherTrusted === false
        ? " · feather?"
        : "";
    const walk =
      angle.walkDeg != null && angle.dcStrokes > 0
        ? ` · walk ${angle.walkDeg.toFixed(0)}°`
        : "";
    const feather =
      angle.angleRef && angle.angleRef !== "none" && Number.isFinite(angle.feather)
        ? ` · feather ${angle.feather.toFixed(0)}°`
        : "";
    return `${session.rate || "—"} Hz · ${motion}
            <span class="health ${clockHealth}">${flow}</span>
            ${tb?.ok ? ` · clock ±${tb.rmsMs.toFixed(0)} ms` : " · clock fitting"}
            · ${confLabel}${walk}${featherChip}${feather}`;
  }

  function refreshPodMeta() {
    for (const card of podListEl.querySelectorAll("article[data-pod]")) {
      const session = registry.get(card.dataset.pod);
      const meta = card.querySelector(".meta");
      if (!session || !meta) continue;
      const html = podMetaHtml(session);
      if (meta.dataset.sig !== html) {
        meta.dataset.sig = html;
        meta.innerHTML = html;
      }
    }
  }

  function renderPods() {
    const sessions = registry.list();
    const live = new Set(sessions.map((s) => s.id));
    for (const id of knownPods) {
      if (!live.has(id)) knownPods.delete(id);
    }
    podListEl.replaceChildren();
    for (const session of sessions) {
      const card = document.createElement("article");
      card.className = knownPods.has(session.id) ? "pod-row" : "pod-row enter";
      card.dataset.pod = session.id;
      knownPods.add(session.id);
      card.style.borderLeftColor = session.color;
      card.innerHTML = `
        <header>
          <span class="name">${session.position}</span>
          <span class="meta">${podMetaHtml(session)}</span>
        </header>
        <div class="fields">
          <label>Seat
            <select data-seat="${session.id}">
              <option value="">—</option>
              ${getBoatClass(rig.boatClass).seats.map(
                (s) =>
                  `<option value="${s}" ${session.seat === s ? "selected" : ""}>${s}</option>`
              ).join("")}
            </select>
          </label>
          <label>Hand
            <select data-hand="${session.id}">
              <option value="stroke" ${session.hand !== "bow" ? "selected" : ""}>Stroke side</option>
              <option value="bow" ${session.hand === "bow" ? "selected" : ""}>Bow side</option>
            </select>
          </label>
          <span class="meta">${session.side === "port" ? "port" : "starboard"}</span>
        </div>`;
      podListEl.appendChild(card);
    }
    podListEl.querySelectorAll("select[data-seat]").forEach((el) => {
      el.addEventListener("change", () => {
        const session = registry.list().find((s) => s.id === el.getAttribute("data-seat"));
        if (session) assignPod(session, { seat: el.value, fromSeat: true });
        const stroke = registry.list().find((s) => s.seat === "stroke");
        if (stroke) crew.setReference(stroke.id);
      });
    });
    podListEl.querySelectorAll("select[data-hand]").forEach((el) => {
      el.addEventListener("change", () => {
        const session = registry.list().find((s) => s.id === el.getAttribute("data-hand"));
        if (session) assignPod(session, { hand: el.value, fromSeat: false });
      });
    });
  }

  function renderSyncPct(value) {
    const key = value == null ? null : Math.round(value);
    if (Object.is(key, syncTarget)) return;
    syncTarget = key;
    if (syncRaf) {
      cancelAnimationFrame(syncRaf);
      syncRaf = 0;
    }
    if (key == null) {
      syncPctEl.textContent = "—";
      return;
    }
    if (reducedMotion() || syncPctEl.textContent === "—") {
      syncShown = key;
      syncPctEl.textContent = `${key}%`;
      return;
    }
    const from = syncShown;
    const t0 = performance.now();
    const step = (now) => {
      const u = Math.min(1, (now - t0) / 400);
      const eased = 1 - (1 - u) ** 3;
      syncShown = from + (key - from) * eased;
      syncPctEl.textContent = `${Math.round(syncShown)}%`;
      if (u < 1) syncRaf = requestAnimationFrame(step);
      else {
        syncShown = key;
        syncRaf = 0;
      }
    };
    syncRaf = requestAnimationFrame(step);
  }

  function setCue(cue) {
    if (!catchCueEl) return;
    setText(catchCueEl, cue.text);
    if (catchCueEl.dataset.kind !== cue.kind) {
      for (const kind of cueKinds) catchCueEl.classList.remove(kind);
      catchCueEl.classList.add(cue.kind);
      catchCueEl.dataset.kind = cue.kind;
    }
  }

  function flashNewStroke(total) {
    if (seenMatched == null) {
      seenMatched = total;
      return;
    }
    if (total > seenMatched) {
      for (const row of seatRowsEl.rows) {
        row.classList.remove("stroke-flash");
        void row.offsetWidth;
        row.classList.add("stroke-flash");
      }
      if (catchCueEl) {
        catchCueEl.classList.remove("pop");
        void catchCueEl.offsetWidth;
        catchCueEl.classList.add("pop");
      }
    }
    seenMatched = total;
  }

  function updateHeadline() {
    const snap = crew.snapshot();
    renderSyncPct(snap.ratedStrokes ? snap.timeInSyncPct : null);
    flashNewStroke(snap.totalMatched);
    setText(spmEl, snap.spm ? snap.spm.toFixed(0) : "—");
    setText(
      catchSpreadEl,
      snap.last?.catchSpreadMs != null ? fmtMs(snap.last.catchSpreadMs) : "—"
    );
    setText(
      finishSpreadEl,
      snap.last?.finishSpreadMs != null ? fmtMs(snap.last.finishSpreadMs) : "—"
    );
    setText(strokeCountEl, String(snap.totalMatched));
    const refSeat =
      snap.last?.seats.find((s) => s.id === snap.last.referenceId) || null;
    const liveArc = driveArcDeg(refSeat?.catch?.theta, refSeat?.finish?.theta);
    if (arcLiveEl) setText(arcLiveEl, fmtDeg(liveArc));
    if (bladeLiveEl) setText(bladeLiveEl, fmtM(bladeArcM(liveArc, rig.outboardM)));
    setCue(coachCatchCue(snap.last, snap.thresholdMs));
    renderAlignRail(snap.last, snap.thresholdMs);
    if (matchNoteEl) {
      const q = snap.last?.matchQuality;
      const notes = {
        single_seat: "Need two complete catch+finish seats to score in-sync.",
        missing_finish: "Finish missing — catch late/early vs stroke is still shown.",
        untrusted_time: "Clock untrusted — in-sync hidden.",
        wide_spread: "Catch spread is hundreds of ms — check matcher / missing finish, not the crew.",
      };
      setText(matchNoteEl, notes[q] || "");
    }
    const live = liveSeats();
    const feat = live.find((s) => Number.isFinite(s.feather))?.feather;
    if (featherLiveEl) setText(featherLiveEl, feat != null ? fmtDeg(feat) : "—");
    const n = registry.list().filter((s) => s.status === "connected").length;
    if (podCountEl && podCountLabel) {
      setText(podCountLabel, n === 1 ? "1 pod" : `${n} pods`);
      const liveAttr = n > 0 ? "1" : "0";
      if (podCountEl.dataset.live !== liveAttr) podCountEl.dataset.live = liveAttr;
    }
    btnDisconnect.disabled = n < 1;
    btnZero.disabled = n < 1;
    btnStart.disabled = n < 1 || pieceActive;
    btnStop.disabled = !pieceActive;
    btnCsv.disabled = snap.totalMatched < 1;
  }

  function setButtons() {
    updateHeadline();
  }

  registry.onChange = () => {
    renderPods();
    renderTable();
    setButtons();
  };
  registry.onStats = () => {
    updateHeadline();
  };
  registry.onFrame = (session, frame, syncedMs) => {
    const tr = trackerFor(session);
    const { event, events } = tr.update(frame, syncedMs);
    const list = events?.length ? events : event ? [event] : [];
    if (pieceActive && list.length) {
      const strokeSeat = registry.list().find((s) => s.seat === "stroke");
      if (strokeSeat) crew.setReference(strokeSeat.id);
      for (const ev of list) {
        crew.observeEvent(session.id, ev, {
          seat: session.seat || session.position,
          side: session.side,
          hand: session.hand,
          podId: session.podId,
          timebaseRmsMs: session.timebase?.ok ? session.timebase.rmsMs : 99,
        });
      }
    }
  };

  btnAddPod.addEventListener("click", async () => {
    try {
      setStatus("Pick a pod…");
      const session = await registry.addPod({ preferRawGyro: true });
      try {
        await session.client.setWorkoutProfile(PROFILE_ROWING);
      } catch (_) {
        /* Pre-v17 firmware rejects profile 2; live rate is enough. */
      }
      await session.client.setRate(RATE_LIVE_HZ);
      session.timebase.setNominalHz(RATE_LIVE_HZ);
      assignPod(session, {
        fromSeat:
          getBoatClass(rig.boatClass).kind === "sweep" &&
          session.hand !== "bow" &&
          session.hand !== "stroke",
      });
      const stroke = registry.list().find((s) => s.seat === "stroke");
      if (stroke) crew.setReference(stroke.id);
      const motion = session.client.usesV16Motion
        ? "raw gyro v16"
        : session.client.usesFusedMotion
          ? "fused yaw (walks near iron)"
          : "v1 gyro";
      setStatus(
        `${session.position} connected · ${motion}. Assign a seat, then row. Zero only for measured degrees.`,
        session.client.usesFusedMotion ? "err" : "ok"
      );
    } catch (e) {
      setStatus(String(e.message || e), "err");
    }
  });

  btnDisconnect.addEventListener("click", async () => {
    await registry.disconnectAll();
    trackers.clear();
    crew.reset();
    pieceActive = false;
    setStatus("Disconnected");
    renderTable();
    setButtons();
  });

  btnZero.addEventListener("click", () => {
    for (const tr of trackers.values()) tr.zero();
    setStatus("Measured zero at this pose. Degrees are from here, not the auto centre.", "ok");
  });

  btnStart.addEventListener("click", () => {
    crew.start();
    for (const tr of trackers.values()) {
      tr.clearStrokeState();
    }
    pieceActive = true;
    pieceT0 = performance.now();
    setStatus("Piece running — catch spread vs the stroke seat.", "ok");
    setButtons();
  });

  btnStop.addEventListener("click", () => {
    crew.commit();
    pieceActive = false;
    const stopped = crew.snapshot();
    const syncTxt = stopped.ratedStrokes
      ? `${Math.round(stopped.timeInSyncPct)}% in sync`
      : "in-sync not rated";
    setStatus(`Stopped. ${stopped.totalMatched} strokes, ${syncTxt}.`, "ok");
    setButtons();
  });

  btnCsv.addEventListener("click", () => {
    crew.commit();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadStrokeCsv(
      crew.strokes,
      `rowpod_${ROWPOD_VERSION}_strokes_${stamp}.csv`,
      pieceT0,
      { boatClass: rig.boatClass, strokeSits: rig.strokeSits, inboardM: rig.inboardM, outboardM: rig.outboardM }
    );
    setButtons();
  });

  thresholdEl.addEventListener("input", () => {
    const ms = Number(thresholdEl.value);
    thresholdLabel.textContent = `${ms} ms`;
    crew.setThresholdMs(ms);
    updateHeadline();
  });

  function raf() {
    drawFan();
    renderTable();
    refreshPodMeta();
    updateHeadline();
    requestAnimationFrame(raf);
  }
  requestAnimationFrame(raf);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js?v=1.5.3").catch(() => {});
  }
  setStatus("Ready — add a pod per oar (Android Chrome / desktop Chrome).");
} catch (e) {
  setStatus(String(e.message || e), "err");
}
