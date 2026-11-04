/** Replay a capture CSV through the browser tracker. Prints the same F lines as rowing_parity_host.
 * Usage: node tools/rowing_parity.mjs path/to/capture.csv
 */
import { readFileSync } from "node:fs";
import { OarAngleTracker } from "../web/ble_plotter/rowing_angle.js";

const path = process.argv[2];
if (!path) {
  console.error("usage: node tools/rowing_parity.mjs path/to/capture.csv");
  process.exit(1);
}
const text = readFileSync(path, "utf8");
const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
const header = lines[0].split(",");
const idx = (name) => header.indexOf(name);
const c = {
  ms: idx("synced_ms"),
  ax: idx("ax_g"),
  ay: idx("ay_g"),
  az: idx("az_g"),
  gx: idx("gx_dps"),
  gy: idx("gy_dps"),
  gz: idx("gz_dps"),
};
const tracker = new OarAngleTracker();
tracker.zero();
for (let i = 1; i < lines.length; i++) {
  const f = lines[i].split(",");
  const frame = {
    protocol: 2,
    eng: {
      ax: Number(f[c.ax]),
      ay: Number(f[c.ay]),
      az: Number(f[c.az]),
      gx: Number(f[c.gx]),
      gy: Number(f[c.gy]),
      gz: Number(f[c.gz]),
    },
  };
  const t = Number(f[c.ms]);
  const result = tracker.update(frame, t);
  const ev = (result.events || []).find((e) => e.type === "finish");
  if (ev && tracker.lastCatch) {
    const arc = ev.theta - tracker.lastCatch.theta;
    console.log(`F ${tracker.lastCatch.theta.toFixed(3)} ${ev.theta.toFixed(3)} ${arc.toFixed(3)} ${t.toFixed(3)}`);
  }
}
console.error(`samples ${lines.length - 1}`);
