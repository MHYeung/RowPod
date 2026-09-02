import { RATE_LIVE_HZ, PROFILE_ROWING, POD_COLORS } from "./protocol.js";
import { PodRegistry } from "./pod_registry.js";
import { OarAngleTracker } from "./rowing_angle.js";
import { CrewSync, downloadStrokeCsv } from "./rowing_crew.js";
import { ROWPOD_VERSION } from "./version.js";
import {
  BOAT_CLASS_ORDER,
  getBoatClass,
  defaultHandForSeat,
  portStarboardFromHand,
  seatInBoat,
  loadRig,
  saveRig,
} from "./boat_rig.js";

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
const fanCanvas = document.getElementById("fan");
const seatRowsEl = document.getElementById("seatRows");
const podListEl = document.getElementById("podList");
const thresholdEl = document.getElementById("thresholdMs");
const thresholdLabel = document.getElementById("thresholdLabel");
const boatClassEl = document.getElementById("boatClass");
const strokeSitsEl = document.getElementById("strokeSits");
const boatKindEl = document.getElementById("boatKind");

function setStatus(text, cls = "") {
  statusEl.textContent = text;
  statusEl.className = `status ${cls}`;
}

function fmtDeg(v) {
  return v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(0)}°`;
}

function fmtMs(v) {
  return v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(0)} ms`;
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

  function syncRigControls() {
    const boat = getBoatClass(rig.boatClass);
    if (boatKindEl) boatKindEl.textContent = boat.kind;
    if (boatClassEl) boatClassEl.value = boat.id;
    if (strokeSitsEl) strokeSitsEl.value = rig.strokeSits;
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
      rig = { ...rig, boatClass: boatClassEl.value };
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

  function trackerFor(session) {
    let tr = trackers.get(session.id);
    if (!tr) {
      tr = new OarAngleTracker();
      trackers.set(session.id, tr);
    }
    tr.setSign(session.side === "port" ? -1 : 1);
    return tr;
  }

  function liveSeats() {
    return registry.list().map((session) => {
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

  function drawFan() {
    const ctx = fanCanvas.getContext("2d");
    const w = fanCanvas.width;
    const h = fanCanvas.height;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h * 0.78;
    const r = Math.min(w, h) * 0.62;
    const minDeg = -80;
    const maxDeg = 50;
    const toXY = (deg, radius) => {
      /* 0° = perpendicular = straight up on the canvas. Catch (neg) to the left. */
      const rad = (deg * Math.PI) / 180;
      return { x: cx + radius * Math.sin(rad), y: cy - radius * Math.cos(rad) };
    };

    ctx.strokeStyle = "#6f6870";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(
      cx,
      cy,
      r,
      (minDeg * Math.PI) / 180 - Math.PI / 2,
      (maxDeg * Math.PI) / 180 - Math.PI / 2,
      true
    );
    ctx.stroke();

    for (const tick of [-60, -30, 0, 30]) {
      const a = toXY(tick, r);
      const b = toXY(tick, r + 16);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.fillStyle = "#e0e4d5";
      ctx.font = "18px Segoe UI, sans-serif";
      ctx.textAlign = "center";
      const lab = toXY(tick, r + 34);
      ctx.fillText(`${tick}°`, lab.x, lab.y);
    }

    const cLab = toXY(-72, r * 0.7);
    const fLab = toXY(42, r * 0.7);
    ctx.fillStyle = "#e0e4d5";
    ctx.font = "15px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("CATCH", cLab.x, cLab.y);
    ctx.fillText("FINISH", fLab.x, fLab.y);

    const seats = liveSeats();
    seats.forEach((seat, i) => {
      if (seat.catch == null || seat.finish == null) return;
      const inner = r * (0.42 + (i / Math.max(seats.length, 1)) * 0.4);
      const start = toXY(seat.catch.theta, inner);
      const end = toXY(seat.finish.theta, inner);
      ctx.strokeStyle = seat.color || POD_COLORS[i];
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(
        cx,
        cy,
        inner,
        (seat.catch.theta * Math.PI) / 180 - Math.PI / 2,
        (seat.finish.theta * Math.PI) / 180 - Math.PI / 2,
        true
      );
      ctx.stroke();
      ctx.fillStyle = seat.color || POD_COLORS[i];
      ctx.beginPath();
      ctx.arc(start.x, start.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(end.x, end.y, 6, 0, Math.PI * 2);
      ctx.fill();
    });

    for (const seat of seats) {
      if (seat.theta == null || !Number.isFinite(seat.theta)) continue;
      const tip = toXY(seat.theta, r * 0.95);
      ctx.strokeStyle = seat.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      /* Top-down blade: full tick when squared, edge-on (vanishes) at 90° feather. */
      const fRad = ((seat.feather || 0) * Math.PI) / 180;
      const blade = 20 * Math.cos(fRad);
      const rad = (seat.theta * Math.PI) / 180;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(tip.x - Math.cos(rad) * blade, tip.y - Math.sin(rad) * blade);
      ctx.lineTo(tip.x + Math.cos(rad) * blade, tip.y + Math.sin(rad) * blade);
      ctx.stroke();
    }
  }

  function renderTable() {
    const snap = crew.snapshot();
    const last = snap.last;
    seatRowsEl.replaceChildren();
    const sessions = registry.list();
    for (const session of sessions) {
      const tr = trackers.get(session.id);
      const angle = tr?.snapshot() || {};
      const matched = last?.seats.find((s) => s.id === session.id);
      const catchEv = matched?.catch || angle.lastCatch;
      const finishEv = matched?.finish || angle.lastFinish;
      const ref = last?.seats.find((s) => s.id === last.referenceId);
      const row = document.createElement("tr");
      const dCatch =
        catchEv && ref?.catch ? catchEv.t - ref.catch.t : null;
      const dFinish =
        finishEv && ref?.finish ? finishEv.t - ref.finish.t : null;
      const rms = session.timebase?.ok ? session.timebase.rmsMs : null;
      row.innerHTML = `
        <td>${session.seat || session.position}</td>
        <td>${session.hand === "bow" ? "bow" : session.hand === "stroke" ? "stroke" : "—"}</td>
        <td>${fmtDeg(catchEv?.theta)}</td>
        <td>${fmtDeg(finishEv?.theta)}</td>
        <td>${fmtDeg(
          catchEv && finishEv ? finishEv.theta - catchEv.theta : angle.arcDeg
        )}</td>
        <td>${fmtDeg(angle.feather)}</td>
        <td>${fmtMs(dCatch)}</td>
        <td>${fmtMs(dFinish)}</td>
        <td>${rms != null && Number.isFinite(rms) ? `±${rms.toFixed(0)}` : "—"}</td>`;
      seatRowsEl.appendChild(row);
    }
  }

  function renderPods() {
    const sessions = registry.list();
    podListEl.replaceChildren();
    for (const session of sessions) {
      const card = document.createElement("article");
      card.className = "pod-row";
      card.style.borderLeftColor = session.color;
      const tb = session.timebase;
      const health =
        session.status !== "connected"
          ? "bad"
          : tb?.ok
            ? "good"
            : "warn";
      const angle = trackers.get(session.id)?.snapshot() || {};
      const motion = session.client.usesV16Motion
        ? "raw gyro"
        : session.client.usesFusedMotion
          ? "mag yaw"
          : "raw gyro v1";
      const confLabel = {
        zero: "Zero first",
        yaw: "low — mag heading",
        ok: "gyro settling",
        high: "gyro lock",
      }[angle.confidence || "zero"];
      const walk =
        angle.walkDeg != null && angle.dcStrokes > 0
          ? ` · walk ${angle.walkDeg.toFixed(0)}°`
          : "";
      card.innerHTML = `
        <header>
          <span class="name">${session.position}</span>
          <span class="meta">${session.rate || "—"} Hz · ${motion}
            <span class="health ${health}">${session.sensorStatus}</span>
            ${tb?.ok ? ` · clock ±${tb.rmsMs.toFixed(0)} ms` : " · clock fitting"}
            · ${confLabel}${walk}
            ${angle.zeroed && Number.isFinite(angle.feather) ? ` · feather ${angle.feather.toFixed(0)}°` : ""}
          </span>
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

  function updateHeadline() {
    const snap = crew.snapshot();
    syncPctEl.textContent = snap.totalMatched
      ? `${Math.round(snap.timeInSyncPct)}%`
      : "—";
    spmEl.textContent = snap.spm ? snap.spm.toFixed(0) : "—";
    catchSpreadEl.textContent = snap.last ? fmtMs(snap.last.catchSpreadMs) : "—";
    finishSpreadEl.textContent = snap.last ? fmtMs(snap.last.finishSpreadMs) : "—";
    strokeCountEl.textContent = String(snap.totalMatched);
    const live = liveSeats();
    const feat = live.find((s) => Number.isFinite(s.feather))?.feather;
    if (featherLiveEl) {
      featherLiveEl.textContent = feat != null ? fmtDeg(feat) : "—";
    }
    const n = registry.list().filter((s) => s.status === "connected").length;
    btnDisconnect.disabled = n < 1;
    btnZero.disabled = n < 1;
    btnStart.disabled = n < 1 || pieceActive;
    btnStop.disabled = !pieceActive;
    btnCsv.disabled = crew.snapshot().totalMatched < 1;
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
    const { event } = tr.update(frame, syncedMs);
    if (event && pieceActive) {
      const strokeSeat = registry.list().find((s) => s.seat === "stroke");
      if (strokeSeat) crew.setReference(strokeSeat.id);
      crew.observeEvent(session.id, event, {
        seat: session.seat || session.position,
        side: session.side,
        hand: session.hand,
        podId: session.podId,
        timebaseRmsMs: session.timebase?.rmsMs,
      });
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
        `${session.position} connected · ${motion}. Assign a seat, hold perpendicular, Zero.`,
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
    setStatus("Zeroed at perpendicular. Start the piece when ready.", "ok");
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
    setStatus(
      `Stopped. ${crew.totalMatched} strokes, ${Math.round(crew.snapshot().timeInSyncPct)}% in sync.`,
      "ok"
    );
    setButtons();
  });

  btnCsv.addEventListener("click", () => {
    crew.commit();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadStrokeCsv(
      crew.strokes,
      `rowpod_${ROWPOD_VERSION}_strokes_${stamp}.csv`,
      pieceT0,
      { boatClass: rig.boatClass, strokeSits: rig.strokeSits }
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
    updateHeadline();
    requestAnimationFrame(raf);
  }
  requestAnimationFrame(raf);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js?v=1.3.0").catch(() => {});
  }
  setStatus("Ready — add a pod per oar (Android Chrome / desktop Chrome).");
} catch (e) {
  setStatus(String(e.message || e), "err");
}
