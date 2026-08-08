import { CHANNELS } from "./protocol.js";
import { MultiPlot } from "./plot.js";
import { OrientationCube, attitudeFromSensors } from "./orientation.js";
import { CsvLogger } from "./csv_log.js";
import { PodRegistry } from "./pod_registry.js";

const statusEl = document.getElementById("status");
const rateEl = document.getElementById("rate");
const gapsEl = document.getElementById("gaps");
const metaEl = document.getElementById("meta");
const podCountEl = document.getElementById("podCount");
const podListEl = document.getElementById("podList");
const btnAddPod = document.getElementById("btnAddPod");
const btnDisconnect = document.getElementById("btnDisconnect");
const togglesEl = document.getElementById("toggles");
const logRowsEl = document.getElementById("logRows");
const logStateEl = document.getElementById("logState");
const btnLogStart = document.getElementById("btnLogStart");
const btnLogStop = document.getElementById("btnLogStop");
const btnLogDownload = document.getElementById("btnLogDownload");
const btnLogClear = document.getElementById("btnLogClear");

function setStatus(text, cls = "") {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.className = `status ${cls || ""}`;
}

try {
  if (!btnAddPod || !podListEl) {
    throw new Error("Dashboard HTML outdated — hard-refresh (Ctrl+Shift+R) and open /?v=5");
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
  const registry = new PodRegistry();

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

  function updateLogUi() {
    const n = registry.list().filter((s) => s.status === "connected").length;
    logRowsEl.textContent = String(logger.rowCount);
    logStateEl.textContent = logger.recording ? "recording" : "idle";
    btnLogStart.disabled = n < 1 || logger.recording;
    btnLogStop.disabled = n < 1 || !logger.recording;
    btnLogDownload.disabled = logger.rowCount < 1;
    btnLogClear.disabled = logger.rowCount < 1 && !logger.recording;
    btnDisconnect.disabled = registry.list().length < 1;
  }

  logger.onChange = updateLogUi;

  function battLabel(b) {
    if (!b || !b.valid) return "batt —";
    return `batt ${b.percent}% (${(b.millivolts / 1000).toFixed(2)} V)`;
  }

  function podStatsText(s) {
    return `${s.status} · ${s.rate || 0} Hz · gaps ${s.gaps}` +
      ` · sync ${s.sync.ok ? Math.round(s.sync.rttMs) + " ms RTT" : "off"}` +
      ` · ${battLabel(s.battery)}`;
  }

  /** Rate/battery ticks — update text only so rename inputs keep focus. */
  function updatePodCardStats(sessions, selectedId) {
    for (const card of podListEl.querySelectorAll(".pod-card")) {
      const id = card.dataset.podId;
      const s = sessions.find((x) => x.id === id);
      if (!s) continue;
      card.classList.toggle("selected", s.id === selectedId);
      const muted = card.querySelector(".muted");
      if (muted) muted.textContent = podStatsText(s);
      const titleStrong = card.querySelector(".pod-title strong");
      const input = card.querySelector("input[data-pod-id]");
      if (titleStrong && !(input && document.activeElement === input)) {
        titleStrong.textContent = s.position;
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
      card.append(title, actions);
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
    metaEl.textContent =
      `${sel.position} · mode=${sel.mode ? "multi" : "single"} · ${batt} · ` +
      `a=${m.accel_lsb_per_g} LSB/g  g=${m.gyro_lsb_per_dps} LSB/dps  m=${m.mag_lsb_per_gauss} LSB/G`;
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

  registry.onFrame = (session, frame, syncedMs) => {
    plotAccel.pushSeries(session.id, frame.eng);
    plotGyro.pushSeries(session.id, frame.eng);
    plotMag.pushSeries(session.id, frame.eng);

    if (registry.selectedId === session.id) {
      const { ax, ay, az, mx, my, mz } = frame.eng;
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
    });
  };

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

  btnLogStart.addEventListener("click", () => logger.start());
  btnLogStop.addEventListener("click", () => logger.stop());
  btnLogClear.addEventListener("click", () => logger.clear());
  btnLogDownload.addEventListener("click", () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    logger.download(`c3_tracker_${stamp}.csv`);
  });

  setInterval(() => {
    if (registry.list().length) {
      registry.refreshAllBatteries().catch(() => {});
    }
  }, 15000);

  function raf() {
    for (const p of plots) p.draw();
    cube.draw();
    requestAnimationFrame(raf);
  }
  requestAnimationFrame(raf);
  updateLogUi();
  setStatus("Ready — click Add pod");
} catch (e) {
  console.error(e);
  setStatus(String(e.message || e), "err");
}
