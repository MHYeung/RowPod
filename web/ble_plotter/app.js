import { CHANNELS, RATE_LIVE_HZ, RATE_LOG_HZ, RATE_LOG_MAX_HZ } from "./protocol.js";
import { MultiPlot } from "./plot.js";
import { OrientationCube, attitudeFromSensors } from "./orientation.js";
import { CsvLogger } from "./csv_log.js";
import { MagCalibrationStore } from "./mag_calibration.js";
import { HyroxSession, HYROX_PROFILE } from "./hyrox.js";
import { PodRegistry } from "./pod_registry.js";

const statusEl = document.getElementById("status");
const rateEl = document.getElementById("rate");
const gapsEl = document.getElementById("gaps");
const metaEl = document.getElementById("meta");
const podCountEl = document.getElementById("podCount");
const healthyCountEl = document.getElementById("healthyCount");
const fleetRateEl = document.getElementById("fleetRate");
const fleetBatteryEl = document.getElementById("fleetBattery");
const podListEl = document.getElementById("podList");
const btnAddPod = document.getElementById("btnAddPod");
const btnDisconnect = document.getElementById("btnDisconnect");
const togglesEl = document.getElementById("toggles");
const logRowsEl = document.getElementById("logRows");
const logStateEl = document.getElementById("logState");
const btnLogStart = document.getElementById("btnLogStart");
const btnLogStop = document.getElementById("btnLogStop");
const btnMagCal = document.getElementById("btnMagCal");
const btnLogDownload = document.getElementById("btnLogDownload");
const btnLogClear = document.getElementById("btnLogClear");
const hyroxStationEl = document.getElementById("hyroxStation");
const btnHyroxStart = document.getElementById("btnHyroxStart");
const btnHyroxStop = document.getElementById("btnHyroxStop");
const hyroxStateEl = document.getElementById("hyroxState");
const hyroxElapsedEl = document.getElementById("hyroxElapsed");
const hyroxRepsEl = document.getElementById("hyroxReps");
const hyroxCadenceEl = document.getElementById("hyroxCadence");
const hyroxEffortEl = document.getElementById("hyroxEffort");
const hyroxWorkEl = document.getElementById("hyroxWork");
const hyroxQualityEl = document.getElementById("hyroxQuality");

function setStatus(text, cls = "") {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.className = `status ${cls || ""}`;
}

try {
  if (!btnAddPod || !podListEl || !btnMagCal || !btnHyroxStart) {
    throw new Error("Dashboard HTML outdated — hard-refresh (Ctrl+Shift+R) and open /?v=12");
  }

  const plotAccel = new MultiPlot(document.getElementById("plotAccel"), ["ax", "ay", "az"], {
    unit: "g",
    tickCount: 5,
  });
  const plotGyro = new MultiPlot(document.getElementById("plotGyro"), ["gx", "gy", "gz"], {
    unit: "dps",
    tickCount: 5,
  });
  const plotMag = new MultiPlot(document.getElementById("plotMag"), ["mx", "my", "mz"], {
    unit: "G",
    tickCount: 5,
  });
  const plots = [plotAccel, plotGyro, plotMag];
  const cube = new OrientationCube(document.getElementById("plotCube"), { smooth: 0.12 });
  const logger = new CsvLogger();
  const magCal = new MagCalibrationStore();
  const registry = new PodRegistry();
  const hyrox = new HyroxSession();
  let magCalRunning = false;
  let stopPending = false;

  for (const ch of CHANNELS) {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.addEventListener("change", () => {
      for (const p of plots) p.setChannelEnabled(ch.key, cb.checked);
    });
    label.append(cb, document.createTextNode(ch.label));
    togglesEl.append(label);
  }

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const name = tab.dataset.tab;
      document.querySelectorAll(".tab").forEach((t) => {
        t.classList.toggle("active", t === tab);
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
      });
      document.querySelectorAll(".tab-panel").forEach((panel) => {
        const on = panel.id === `panel-${name}`;
        panel.hidden = !on;
        panel.classList.toggle("active", on);
      });
    });
  });

  function chooseLogRateHz() {
    const n = registry.list().filter((s) => s.status === "connected").length;
    return n <= 1 ? RATE_LOG_MAX_HZ : RATE_LOG_HZ;
  }

  function updateLogUi() {
    const n = registry.list().filter((s) => s.status === "connected").length;
    const drop = logger.droppedCount ? ` · dropped ${logger.droppedCount}` : "";
    logRowsEl.textContent = String(logger.rowCount);
    logStateEl.textContent = logger.recording
      ? `recording @ ${chooseLogRateHz()} Hz${drop}`
      : `idle (live ${RATE_LIVE_HZ} Hz)${drop}`;
    btnLogStart.disabled = n < 1 || logger.recording || stopPending;
    btnLogStop.disabled = n < 1 || !logger.recording || stopPending;
    btnMagCal.disabled = n < 1 || logger.recording || magCalRunning || stopPending;
    btnHyroxStart.disabled = n < 1 || hyrox.active || logger.recording;
    btnHyroxStop.disabled = !hyrox.active;
    btnLogDownload.disabled = logger.rowCount < 1;
    btnLogClear.disabled = logger.rowCount < 1 && !logger.recording;
    btnDisconnect.disabled = registry.list().length < 1;
  }

  function updateHyroxUi(now = performance.now()) {
    const stats = hyrox.snapshot(now);
    hyroxStateEl.textContent = stats.active
      ? `${stats.stationLabel} · ${stats.working ? "working" : "rest"}`
      : "Idle";
    hyroxElapsedEl.textContent = `${Math.floor(stats.elapsedMs / 60000)}:` +
      `${String(Math.floor(stats.elapsedMs / 1000) % 60).padStart(2, "0")}`;
    hyroxRepsEl.textContent = String(stats.reps);
    hyroxCadenceEl.textContent = stats.cadence
      ? `${Math.round(stats.cadence)} /min`
      : "—";
    hyroxEffortEl.textContent = stats.active
      ? `${Math.round(stats.effort * 100)}%`
      : "—";
    hyroxWorkEl.textContent = `${(stats.workMs / 1000).toFixed(1)} s`;
    hyroxQualityEl.textContent = stats.active
      ? "Use reps as candidate counts; validate each station against your own movement."
      : "Connect a pod and choose a station.";
  }

  logger.onChange = updateLogUi;

  function battLabel(b) {
    if (!b || !b.valid) return "batt —";
    return `batt ${b.percent}% (${(b.millivolts / 1000).toFixed(2)} V)`;
  }

  function podStatsText(s) {
    return `${s.status} · ${s.rate || 0} Hz · gaps ${s.gaps}` +
      ` · sync ${s.sync.ok ? Math.round(s.sync.rttMs) + " ms RTT" : "off"}` +
      ` · ${battLabel(s.battery)} · outliers ${s.outliers || 0}`;
  }

  function sensorHealth(s) {
    if (s.status !== "connected") return { text: "disconnected", cls: "bad" };
    if (performance.now() - s.lastFrameAt > 1500) {
      return { text: "stale stream", cls: "bad" };
    }
    if (s.gaps || s.outliers) return { text: "degraded", cls: "warn" };
    return { text: "stream healthy", cls: "good" };
  }

  function updateFleetSummary(sessions) {
    const connected = sessions.filter((s) => s.status === "connected");
    const healthy = connected.filter((s) => sensorHealth(s).cls === "good");
    const rates = connected.map((s) => s.rate).filter((n) => n > 0);
    const batteries = connected
      .map((s) => s.battery)
      .filter((b) => b && b.valid);
    podCountEl.textContent = String(sessions.length);
    healthyCountEl.textContent = `${healthy.length}/${connected.length}`;
    fleetRateEl.textContent = rates.length
      ? String(Math.round(rates.reduce((a, b) => a + b, 0) / rates.length))
      : "—";
    fleetBatteryEl.textContent = batteries.length
      ? `${Math.round(batteries.reduce((a, b) => a + b.percent, 0) / batteries.length)}%`
      : "—";
  }

  /** Rate/battery ticks — update text only so rename inputs keep focus. */
  function updatePodCardStats(sessions, selectedId) {
    updateFleetSummary(sessions);
    for (const card of podListEl.querySelectorAll(".pod-card")) {
      const id = card.dataset.podId;
      const s = sessions.find((x) => x.id === id);
      if (!s) continue;
      card.classList.toggle("selected", s.id === selectedId);
      const muted = card.querySelector(".muted");
      if (muted) muted.textContent = podStatsText(s);
      const titleStrong = card.querySelector(".pod-title strong");
      const input = card.querySelector("input[data-pod-id]");
      const healthEl = card.querySelector("[data-role=health]");
      const batteryEl = card.querySelector("[data-role=battery]");
      const batteryMeter = card.querySelector("[data-role=battery-meter]");
      const metricEl = card.querySelector("[data-role=metric]");
      const health = sensorHealth(s);
      if (titleStrong && !(input && document.activeElement === input)) {
        titleStrong.textContent = s.position;
      }
      if (healthEl) {
        healthEl.textContent = health.text;
        healthEl.className = `health ${health.cls}`;
      }
      if (batteryEl) batteryEl.textContent = battLabel(s.battery);
      if (batteryMeter) {
        batteryMeter.value = s.battery?.valid ? s.battery.percent : 0;
      }
      if (metricEl) {
        metricEl.textContent =
          `activity ${Math.round((s.activity || 0) * 100)}% · ` +
          `frames ${s.totalFrames || 0} · outliers ${s.outliers || 0}`;
      }
    }
    updateSelectedStats();
  }

  function renderPods(sessions, selectedId) {
    const drafts = {};
    let focusId = null;
    let selStart = 0;
    let selEnd = 0;
    for (const input of podListEl.querySelectorAll("input[data-pod-id]")) {
      drafts[input.dataset.podId] = input.value;
      if (document.activeElement === input) {
        focusId = input.dataset.podId;
        selStart = input.selectionStart ?? 0;
        selEnd = input.selectionEnd ?? 0;
      }
    }

    podCountEl.textContent = String(sessions.length);
    updateFleetSummary(sessions);
    podListEl.innerHTML = "";
    for (const s of sessions) {
      const card = document.createElement("article");
      card.className = `pod-card${s.id === selectedId ? " selected" : ""}`;
      card.dataset.podId = s.id;
      card.style.borderColor = s.color;

      const title = document.createElement("div");
      title.className = "pod-title";
      title.innerHTML = `<span class="swatch" style="background:${s.color}"></span>
        <strong>${s.position}</strong>
        <span class="muted">${podStatsText(s)}</span>`;

      const health = sensorHealth(s);
      const healthRow = document.createElement("div");
      healthRow.className = "pod-health";
      healthRow.innerHTML =
        `<span data-role="health" class="health ${health.cls}">${health.text}</span>` +
        `<span data-role="battery">${battLabel(s.battery)}</span>` +
        `<meter data-role="battery-meter" min="0" max="100" value="${s.battery?.valid ? s.battery.percent : 0}"></meter>`;

      const liveFigure = document.createElement("figure");
      liveFigure.className = "mini-plot-wrap";
      liveFigure.innerHTML = "<figcaption>Live activity · gyro norm / accel norm</figcaption>";
      const liveCanvas = document.createElement("canvas");
      liveCanvas.className = "mini-plot";
      liveCanvas.width = 360;
      liveCanvas.height = 76;
      liveCanvas.dataset.podId = s.id;
      liveFigure.append(liveCanvas);

      const metric = document.createElement("div");
      metric.className = "pod-metric";
      metric.dataset.role = "metric";
      metric.textContent =
        `activity ${Math.round((s.activity || 0) * 100)}% · outliers ${s.outliers || 0}`;

      const actions = document.createElement("div");
      actions.className = "pod-actions";

      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.maxLength = 20;
      nameInput.dataset.podId = s.id;
      nameInput.value = drafts[s.id] ?? s.position;
      nameInput.placeholder = "position name";
      nameInput.title = "Written to the pod NVS and used as BLE advertised name";

      const btnSave = document.createElement("button");
      btnSave.type = "button";
      btnSave.textContent = "Rename";
      btnSave.addEventListener("click", async () => {
        try {
          await registry.rename(s.id, nameInput.value);
          setStatus(`Renamed pod to "${nameInput.value}"`, "ok");
        } catch (e) {
          setStatus(String(e.message || e), "err");
        }
      });

      const btnSelect = document.createElement("button");
      btnSelect.type = "button";
      btnSelect.textContent = "Select";
      btnSelect.addEventListener("click", () => registry.select(s.id));

      const btnSync = document.createElement("button");
      btnSync.type = "button";
      btnSync.textContent = "Sync";
      btnSync.addEventListener("click", async () => {
        try {
          await registry.resync(s.id);
          setStatus(`Synced ${s.position}`, "ok");
        } catch (e) {
          setStatus(String(e.message || e), "err");
        }
      });

      const btnDrop = document.createElement("button");
      btnDrop.type = "button";
      btnDrop.textContent = "Remove";
      btnDrop.addEventListener("click", async () => {
        for (const p of plots) p.removeSeries(s.id);
        await registry.disconnect(s.id);
        updateSelectedStats();
        updateLogUi();
      });

      actions.append(nameInput, btnSave, btnSelect, btnSync, btnDrop);
      card.append(title, healthRow, liveFigure, metric, actions);
      podListEl.append(card);

      if (focusId === s.id) {
        nameInput.focus();
        nameInput.setSelectionRange(selStart, selEnd);
      }
    }
    updateSelectedStats();
    updateLogUi();
  }

  function updateSelectedStats() {
    const sel = registry.selected;
    if (!sel) {
      rateEl.textContent = "—";
      gapsEl.textContent = "0";
      metaEl.textContent = "—";
      setStatus(registry.list().length ? "Select a pod" : "No pods connected");
      return;
    }
    rateEl.textContent = String(sel.rate || 0);
    gapsEl.textContent = String(sel.gaps || 0);
    const m = sel.client.meta;
    const batt = battLabel(sel.battery);
    const magState = magCal.get(sel.id) ? "mag=calibrated" : "mag=RAW";
    metaEl.textContent =
      `${sel.position} · mode=${sel.mode ? "multi" : "single"} · ${batt} · ` +
      `${magState} · a=${m.accel_lsb_per_g} LSB/g  ` +
      `g=${m.gyro_lsb_per_dps} LSB/dps  m=${m.mag_lsb_per_gauss} LSB/G`;
  }

  registry.onChange = (sessions, selectedId) => {
    const ids = new Set(sessions.map((s) => s.id));
    for (const p of plots) {
      for (const id of [...p.series.keys()]) {
        if (!ids.has(id)) p.removeSeries(id);
      }
      for (const s of sessions) p.ensureSeries(s.id, s.color);
    }
    renderPods(sessions, selectedId);
  };
  registry.onStats = updatePodCardStats;

  registry.onFrame = (session, frame, syncedMs, quality) => {
    magCal.observe(session.id, frame.eng);
    const cleanFrame = { ...frame, eng: quality?.eng || frame.eng };
    hyrox.update(session, cleanFrame.eng);
    /* Keep plot density near live rate even while the pod streams at log rate. */
    const deviceHz = session.client.meta.rate_hz || RATE_LIVE_HZ;
    const keepEvery = Math.max(1, Math.round(deviceHz / RATE_LIVE_HZ));
    session._plotTick = (session._plotTick || 0) + 1;
    if (session._plotTick % keepEvery === 0) {
      plotAccel.pushSeries(session.id, cleanFrame.eng);
      plotGyro.pushSeries(session.id, cleanFrame.eng);
      plotMag.pushSeries(session.id, cleanFrame.eng);
    }

    if (registry.selectedId === session.id) {
      const { ax, ay, az } = cleanFrame.eng;
      const { mx, my, mz } = magCal.apply(session.id, cleanFrame.eng);
      const att = attitudeFromSensors(ax, ay, az, mx, my, mz);
      cube.setAttitude(att.roll, att.pitch, att.yaw);
      rateEl.textContent = String(session.rate || 0);
      gapsEl.textContent = String(session.gaps || 0);
    }

    logger.push(frame, {
      position: session.position,
      deviceId: session.id,
      podId: session.podId,
      rateHz: session.client.meta.rate_hz,
      syncedMs,
      magCalibration: magCal.get(session.id),
      quality,
      training: hyrox.snapshot(),
    });
    updateHyroxUi();
  };

  btnHyroxStart.addEventListener("click", async () => {
    const selected = registry.selected;
    if (!selected || hyrox.active) return;
    const station = hyroxStationEl.value;
    const logHz = chooseLogRateHz();
    try {
      setStatus(`Preparing HYROX ${station} at ${logHz} Hz…`);
      await registry.setWorkoutProfileAll(HYROX_PROFILE);
      await registry.setRateAll(logHz);
      hyrox.start(station, selected.id);
      logger.start({
        liveRateHz: RATE_LIVE_HZ,
        logRateHz: logHz,
        stillnessMs: 2000,
        trainingProfile: HYROX_PROFILE,
        trainingStation: station,
        pods: registry.list().map((s) => ({
          id: s.id,
          position: s.position,
          podId: s.podId,
          sync: s.sync,
          magCalibration: magCal.get(s.id),
        })),
      });
      setStatus("Hold still for 2 s, then start the station", "ok");
      updateLogUi();
    } catch (e) {
      hyrox.stop();
      setStatus(String(e.message || e), "err");
    }
  });

  btnHyroxStop.addEventListener("click", async () => {
    if (!hyrox.active) return;
    stopPending = true;
    hyroxStateEl.textContent = "End stillness";
    logger.beginEndStillness();
    setStatus("Hold still for 2 s to close the HYROX set", "ok");
    await new Promise((resolve) => setTimeout(resolve, 2000));
    hyrox.stop();
    logger.stop();
    try {
      await registry.setWorkoutProfileAll(0);
      await registry.setRateAll(RATE_LIVE_HZ);
      setStatus("HYROX set saved — live monitor restored", "ok");
    } catch (e) {
      setStatus(String(e.message || e), "err");
    }
    stopPending = false;
    updateLogUi();
  });

  btnAddPod.addEventListener("click", async () => {
    if (btnAddPod.disabled) return;
    btnAddPod.disabled = true;
    const prev = btnAddPod.textContent;
    btnAddPod.textContent = "Waiting…";
    try {
      setStatus("Opening Bluetooth picker…");
      const session = await registry.addPod();
      setStatus(`Added ${session.position}`, "ok");
    } catch (e) {
      console.error(e);
      const msg = String(e.message || e);
      if (/cancel|choos/i.test(msg)) {
        setStatus("Add pod cancelled");
      } else {
        setStatus(msg, "err");
      }
    } finally {
      btnAddPod.disabled = false;
      btnAddPod.textContent = prev;
    }
  });

  btnDisconnect.addEventListener("click", async () => {
    if (logger.recording) logger.stop();
    for (const p of plots) {
      for (const id of [...p.series.keys()]) p.removeSeries(id);
    }
    await registry.disconnectAll();
    updateLogUi();
    setStatus("Disconnected all pods");
  });

  btnLogStart.addEventListener("click", async () => {
    const logHz = chooseLogRateHz();
    try {
      setStatus(`Raising pods to ${logHz} Hz for logging…`);
      await registry.setRateAll(logHz);
      logger.start({
        liveRateHz: RATE_LIVE_HZ,
        logRateHz: logHz,
        stillnessMs: 2000,
        pods: registry.list().map((s) => ({
          id: s.id,
          position: s.position,
          podId: s.podId,
          sync: s.sync,
          magCalibration: magCal.get(s.id),
        })),
      });
      setStatus(`Hold completely still for 2 s — bias start`, "ok");
      setTimeout(() => {
        if (logger.recording && logger.phase === "motion" && !stopPending) {
          setStatus(`Move now — logging @ ${logHz} Hz`, "ok");
        }
      }, 2200);
    } catch (e) {
      setStatus(String(e.message || e), "err");
    }
  });
  btnLogStop.addEventListener("click", async () => {
    stopPending = true;
    logger.beginEndStillness();
    updateLogUi();
    setStatus("Hold completely still for 2 s — bias end", "ok");
    await new Promise((resolve) => setTimeout(resolve, 2000));
    logger.stop();
    try {
      await registry.setRateAll(RATE_LIVE_HZ);
      setStatus(`Log stopped — live monitor @ ${RATE_LIVE_HZ} Hz`);
    } catch (e) {
      setStatus(String(e.message || e), "err");
    }
    stopPending = false;
    updateLogUi();
  });
  btnMagCal.addEventListener("click", async () => {
    const sel = registry.selected;
    if (!sel || magCalRunning) return;
    magCalRunning = true;
    magCal.start(sel.id);
    updateLogUi();
    try {
      /* 30 s: full sphere / figure-8 needs more than yaw spins on a table. */
      for (let remaining = 30; remaining > 0; remaining--) {
        const p = magCal.progress();
        const cov = p
          ? `X ${p.half[0].toFixed(2)}${p.ok[0] ? "✓" : "·"} ` +
            `Y ${p.half[1].toFixed(2)}${p.ok[1] ? "✓" : "·"} ` +
            `Z ${p.half[2].toFixed(2)}${p.ok[2] ? "✓" : "·"} G · n=${p.samples}`
          : "waiting for samples";
        setStatus(
          `Figure-8 + tumble ${sel.position} (not table-spin) · ${remaining}s · ${cov}`
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      const cal = magCal.finish();
      updateSelectedStats();
      setStatus(
        `Mag calibrated from ${cal.samples} samples ` +
          `(half-range X/Y/Z=${cal.halfRangeG.map((v) => v.toFixed(2)).join("/")} G)`,
        "ok"
      );
    } catch (e) {
      setStatus(String(e.message || e), "err");
    } finally {
      magCalRunning = false;
      updateLogUi();
    }
  });
  btnLogClear.addEventListener("click", () => logger.clear());
  btnLogDownload.addEventListener("click", () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    logger.download(`c3_tracker_${stamp}.csv`);
  });

  setInterval(() => {
    if (registry.list().length) {
      registry.refreshAllBatteries().catch(() => {});
      updatePodCardStats(registry.list(), registry.selectedId);
    }
  }, 15000);
  setInterval(() => {
    if (registry.list().length) {
      updatePodCardStats(registry.list(), registry.selectedId);
    }
  }, 1000);

  function drawMiniPlot(canvas, history) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "#2c3a4f";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h - 1);
    ctx.lineTo(w, h - 1);
    ctx.stroke();
    if (history.length < 2) return;
    const draw = (key, color, scale) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      history.forEach((sample, i) => {
        const x = (i / (history.length - 1)) * w;
        const y = h - 3 - Math.min(1, sample[key] / scale) * (h - 6);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };
    draw("gyro", "#f0a030", 360);
    draw("activity", "#3d9cf0", 1);
  }

  function drawFleetMiniPlots() {
    for (const canvas of podListEl.querySelectorAll("canvas[data-pod-id]")) {
      const session = registry.get(canvas.dataset.podId);
      if (session) drawMiniPlot(canvas, session.history);
    }
  }

  function raf() {
    for (const p of plots) p.draw();
    cube.draw();
    drawFleetMiniPlots();
    updateHyroxUi();
    requestAnimationFrame(raf);
  }
  requestAnimationFrame(raf);
  updateLogUi();
  setStatus("Ready — click Add pod");
} catch (e) {
  console.error(e);
  setStatus(String(e.message || e), "err");
}
