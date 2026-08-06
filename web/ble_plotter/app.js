import { BleClient } from "./ble_client.js";
import { CHANNELS } from "./protocol.js";
import { MultiPlot } from "./plot.js";
import { OrientationCube, attitudeFromSensors } from "./orientation.js";
import { CsvLogger } from "./csv_log.js";

const statusEl = document.getElementById("status");
const rateEl = document.getElementById("rate");
const gapsEl = document.getElementById("gaps");
const metaEl = document.getElementById("meta");
const btnConnect = document.getElementById("btnConnect");
const btnDisconnect = document.getElementById("btnDisconnect");
const togglesEl = document.getElementById("toggles");
const logRowsEl = document.getElementById("logRows");
const logStateEl = document.getElementById("logState");
const btnLogStart = document.getElementById("btnLogStart");
const btnLogStop = document.getElementById("btnLogStop");
const btnLogDownload = document.getElementById("btnLogDownload");
const btnLogClear = document.getElementById("btnLogClear");

const colors = Object.fromEntries(CHANNELS.map((c) => [c.key, c.color]));
const plotAccel = new MultiPlot(
  document.getElementById("plotAccel"),
  ["ax", "ay", "az"],
  colors,
  { fixedMin: -2, fixedMax: 2, unit: "g", tickCount: 5 }
);
const plotGyro = new MultiPlot(
  document.getElementById("plotGyro"),
  ["gx", "gy", "gz"],
  colors,
  { fixedMin: -250, fixedMax: 250, unit: "dps", tickCount: 5 }
);
const plotMag = new MultiPlot(
  document.getElementById("plotMag"),
  ["mx", "my", "mz"],
  colors,
  { unit: "G", tickCount: 5 }
);
const plots = [plotAccel, plotGyro, plotMag];
const cube = new OrientationCube(document.getElementById("plotCube"), { smooth: 0.12 });
const logger = new CsvLogger();

for (const ch of CHANNELS) {
  const label = document.createElement("label");
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = true;
  cb.addEventListener("change", () => {
    for (const p of plots) p.setEnabled(ch.key, cb.checked);
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

const client = new BleClient();
let frames = 0;
let windowStart = performance.now();
let connected = false;

client.onStatus = (text, cls) => {
  statusEl.textContent = text;
  statusEl.className = `status ${cls || ""}`;
};

client.onFrame = (frame, gaps) => {
  plotAccel.push(frame.eng);
  plotGyro.push(frame.eng);
  plotMag.push(frame.eng);

  const { ax, ay, az, mx, my, mz } = frame.eng;
  const att = attitudeFromSensors(ax, ay, az, mx, my, mz);
  cube.setAttitude(att.roll, att.pitch, att.yaw);

  logger.push(frame, client.meta.rate_hz);

  gapsEl.textContent = String(gaps);
  frames += 1;
  const now = performance.now();
  if (now - windowStart >= 1000) {
    rateEl.textContent = String(frames);
    frames = 0;
    windowStart = now;
  }
};

function updateLogUi() {
  logRowsEl.textContent = String(logger.rowCount);
  logStateEl.textContent = logger.recording ? "recording" : "idle";
  btnLogStart.disabled = !connected || logger.recording;
  btnLogStop.disabled = !connected || !logger.recording;
  btnLogDownload.disabled = logger.rowCount < 1;
  btnLogClear.disabled = logger.rowCount < 1 && !logger.recording;
}

logger.onChange = updateLogUi;

function setConnected(on) {
  connected = on;
  btnConnect.disabled = on;
  btnDisconnect.disabled = !on;
  document.querySelectorAll("[data-led]").forEach((b) => {
    b.disabled = !on;
  });
  updateLogUi();
}

btnConnect.addEventListener("click", async () => {
  try {
    await client.connect();
    metaEl.textContent =
      `a=${client.meta.accel_lsb_per_g} LSB/g  g=${client.meta.gyro_lsb_per_dps} LSB/dps  m=${client.meta.mag_lsb_per_gauss} LSB/G`;
    setConnected(true);
  } catch (e) {
    console.error(e);
    client.onStatus(String(e.message || e), "err");
    setConnected(false);
  }
});

btnDisconnect.addEventListener("click", async () => {
  if (logger.recording) logger.stop();
  await client.disconnect();
  setConnected(false);
});

document.querySelectorAll("[data-led]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    try {
      await client.writeLed(Number(btn.dataset.led));
    } catch (e) {
      client.onStatus(String(e.message || e), "err");
    }
  });
});

btnLogStart.addEventListener("click", () => logger.start());
btnLogStop.addEventListener("click", () => logger.stop());
btnLogClear.addEventListener("click", () => logger.clear());
btnLogDownload.addEventListener("click", () => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  logger.download(`c3_tracker_${stamp}.csv`);
});

function raf() {
  for (const p of plots) p.draw();
  cube.draw();
  requestAnimationFrame(raf);
}
requestAnimationFrame(raf);
updateLogUi();
