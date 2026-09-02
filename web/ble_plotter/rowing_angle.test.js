/**
 * RowPod angle, event, timebase, and crew-sync tests.
 *
 * Run: node web/ble_plotter/rowing_angle.test.js
 */
import { OarAngleTracker, gravityBodyFromQuat, wrap180, yawAboutGravityDeg, pickShaftAxis, featherDeg } from "./rowing_angle.js";
import { CrewSync, strokesToCsv } from "./rowing_crew.js";
import { PodTimeBase, extendSampleIndex, weightedLinearFit } from "./timebase.js";
import {
  defaultHandForSeat,
  portStarboardFromHand,
  getBoatClass,
} from "./boat_rig.js";

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL: ${msg}`);
    return;
  }
  passed += 1;
}

function assertEq(a, b, msg) {
  assert(a === b, `${msg} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`);
}

function assertNear(a, b, tol, msg) {
  const ok = Math.abs(a - b) <= tol;
  assert(ok, `${msg} (got ${a}, expected ${b} ± ${tol})`);
}

function yawQuat(thetaDeg) {
  const h = (thetaDeg * Math.PI) / 180 / 2;
  return { qw: Math.cos(h), qx: 0, qy: 0, qz: Math.sin(h) };
}

/**
 * Symmetric stroke: theta = A sin(2π f t), f = spm/60.
 * Catch at 3π/2 of the sine: t = (0.75 + n) / f
 */
function feedSine(tracker, { ampDeg, spm, hz, seconds, t0 = 0, biasDps = 0 }) {
  const f = spm / 60;
  const dt = 1000 / hz;
  const n = Math.round(seconds * hz);
  const events = [];
  tracker.onEvent = (ev) => events.push(ev);
  for (let i = 0; i < n; i++) {
    const t = t0 + i * dt;
    const sec = t / 1000;
    const theta = ampDeg * Math.sin(2 * Math.PI * f * sec);
    const q = yawQuat(theta);
    /* World-Z rotation: accel reads +1 g on body Z. */
    const frame = {
      quat: q,
      eng: { ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: biasDps },
    };
    tracker.update(frame, t);
  }
  return events;
}

function catchTimes(ampUnused, spm, seconds) {
  const f = spm / 60;
  const period = 1 / f;
  const first = 0.75 * period;
  const out = [];
  for (let t = first; t < seconds; t += period) out.push(t * 1000);
  return out;
}

/* --- timebase: 16-bit seq extend --- */
{
  assertEq(extendSampleIndex(100, 50), 100, "no wrap needed");
  assertEq(extendSampleIndex(200, 70000), 65736, "extend into 32-bit high");
  /* 70000 = 0x11170, low = 0x1170 = 4464. Wire 4464 should reconstruct 70000. */
  assertEq(extendSampleIndex(4464, 70000), 70000, "reconstruct wrapped seq");
}

/* --- timebase: weighted fit recovers slope --- */
{
  const fit = weightedLinearFit([
    { x: 0, y: 1000, w: 1 },
    { x: 56, y: 2000, w: 1 },
  ]);
  assertNear(fit.a, 1000 / 56, 1e-9, "fit slope is ms/sample at 56 Hz");
  assertNear(fit.b, 1000, 1e-6, "fit intercept");
}

{
  const tb = new PodTimeBase({ nominalHz: 56 });
  tb.observe({ sampleIndex: 1000, hostMs: 5000, rttMs: 8 });
  tb.observe({ sampleIndex: 1560, hostMs: 5000 + 10000, rttMs: 8 });
  assert(tb.ok, "timebase ok after two points");
  assertNear(tb.fittedHz, 56, 0.05, "fitted Hz near 56");
  const t = tb.hostMsFromSample(1280);
  assertNear(t, 5000 + 5000, 2, "midpoint interpolates");
}

{
  const tb = new PodTimeBase({ nominalHz: 56, maxRttMs: 80 });
  tb.observe({ sampleIndex: 0, hostMs: 0, rttMs: 200 });
  assertEq(tb.points.length, 0, "high-RTT point rejected");
}

/* --- identity quat gravity is +Z --- */
{
  const g = gravityBodyFromQuat({ qw: 1, qx: 0, qy: 0, qz: 0 });
  assertNear(g.x, 0, 1e-9, "g.x identity");
  assertNear(g.y, 0, 1e-9, "g.y identity");
  assertNear(g.z, 1, 1e-9, "g.z identity");
}

/* --- sine strokes: catch timing and angle --- */
{
  const tracker = new OarAngleTracker({ omegaPeakMin: 20, refractoryMs: 300 });
  const spm = 30;
  const amp = 45;
  const seconds = 12;
  const events = feedSine(tracker, { ampDeg: amp, spm, hz: 56, seconds });
  const catches = events.filter((e) => e.type === "catch");
  const finishes = events.filter((e) => e.type === "finish");
  const expected = catchTimes(amp, spm, seconds);
  assert(catches.length >= expected.length - 1, `enough catches (got ${catches.length})`);
  assert(finishes.length >= catches.length - 1, "finish count tracks catches");
  const n = Math.min(catches.length, expected.length);
  let errAcc = 0;
  for (let i = 1; i < n - 1; i++) {
    errAcc += Math.abs(catches[i].t - expected[i]);
    assertNear(catches[i].theta, -amp, 3, `catch angle stroke ${i}`);
  }
  const meanErr = errAcc / Math.max(1, n - 2);
  assert(meanErr < 5, `mean catch timing error ${meanErr.toFixed(2)} ms < 5 ms`);
}

/* --- zeroing maps perpendicular to 0 --- */
{
  const tracker = new OarAngleTracker();
  const q = yawQuat(20);
  tracker.update(
    { quat: q, eng: { ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0 } },
    0
  );
  /* Rotate 20 deg over 0.5 s → thetaRaw ~ 20. */
  const q2 = yawQuat(40);
  tracker.update(
    { quat: q2, eng: { ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0 } },
    500
  );
  tracker.zero();
  assertNear(tracker.theta, 0, 0.2, "zero sets current angle to 0");
}

/* --- crew matching + time in sync --- */
{
  const crew = new CrewSync({ catchSpreadMs: 40 });
  crew.setReference("stroke");
  const t0 = 1000;
  for (let i = 0; i < 6; i++) {
    const t = t0 + i * 2000;
    crew.observeEvent("stroke", { type: "catch", t, theta: -50, feather: 4 }, { seat: "stroke" });
    crew.observeEvent("bow", { type: "catch", t: t + 12, theta: -48, feather: 6 }, { seat: "bow" });
    crew.observeEvent("stroke", { type: "finish", t: t + 800, theta: 35, feather: 8 }, { seat: "stroke" });
    crew.observeEvent("bow", { type: "finish", t: t + 820, theta: 33, feather: 7 }, { seat: "bow" });
  }
  const snap = crew.snapshot();
  assert(snap.totalMatched >= 5, "matched strokes");
  assertNear(snap.last.catchSpreadMs, 12, 0.1, "catch spread 12 ms");
  assert(snap.timeInSyncPct === 100, "all strokes in sync at 12 ms");
  assert(snap.spm > 28 && snap.spm < 32, `spm ~30 got ${snap.spm}`);
  const csv = strokesToCsv(snap.strokes, 0, { boatClass: "8+", strokeSits: "starboard" });
  assert(csv.includes("stroke_index"), "csv has header");
  assert(csv.includes("feather_catch_deg"), "csv has feather columns");
  assert(csv.includes("rowpod_version="), "csv stamps rowpod version");
  assert(csv.includes("4.00"), "csv writes catch feather");
  assert(csv.includes("hand,pod_id"), "csv has hand column");
  assert(csv.includes("boat_class=8+"), "csv stamps boat class");
  assert(csv.split("\n").length > 10, "csv has seat rows");
}

/* --- rigid-bar bench: identical motion, independent clocks --- */
{
  const hz = 56;
  const spm = 30;
  const amp = 45;
  const seconds = 10;
  const f = spm / 60;
  const dt = 1000 / hz;

  function makePod(clockOffsetMs, rttJitter) {
    const tracker = new OarAngleTracker({ omegaPeakMin: 20 });
    const tb = new PodTimeBase({ nominalHz: hz });
    /* Three sync points with the pod's clock offset baked into hostMs. */
    for (let k = 0; k < 4; k++) {
      const idx = k * 200;
      tb.observe({
        sampleIndex: idx,
        hostMs: (idx * 1000) / hz + clockOffsetMs + (k % 2 === 0 ? rttJitter : -rttJitter),
        rttMs: 6 + k,
      });
    }
    const catches = [];
    tracker.onEvent = (ev) => {
      if (ev.type === "catch") catches.push(ev);
    };
    const n = Math.round(seconds * hz);
    for (let i = 0; i < n; i++) {
      const trueMs = (i * 1000) / hz;
      const sec = trueMs / 1000;
      const theta = amp * Math.sin(2 * Math.PI * f * sec);
      const frame = {
        quat: yawQuat(theta),
        eng: { ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0 },
      };
      const hostMs = tb.hostMsFromSample(i);
      tracker.update(frame, hostMs);
    }
    return catches;
  }

  const a = makePod(0, 0);
  const b = makePod(3, 1.5);
  const n = Math.min(a.length, b.length);
  assert(n >= 3, "both pods saw catches");
  let maxSpread = 0;
  for (let i = 1; i < n - 1; i++) {
    maxSpread = Math.max(maxSpread, Math.abs(a[i].t - b[i].t));
  }
  assert(
    maxSpread < 15,
    `rigid-bar catch spread ${maxSpread.toFixed(2)} ms < 15 ms (timebase isolation)`
  );
}

/* --- closed yaw path returns to 0 (no integrator walk) --- */
{
  const tracker = new OarAngleTracker();
  const hz = 56;
  const dt = 1000 / hz;
  let i = 0;
  const push = (deg) => {
    tracker.update(
      { quat: yawQuat(deg), eng: { ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0 } },
      i * dt
    );
    i += 1;
  };
  push(0);
  tracker.zero();
  for (let d = 0; d <= 90; d += 2) push(d);
  for (let d = 90; d >= 0; d -= 2) push(d);
  assertNear(tracker.theta, 0, 0.5, "round-trip yaw returns to Zero");
}

{
  assertNear(wrap180(190), -170, 1e-9, "wrap 190");
  assertNear(yawAboutGravityDeg(yawQuat(45)), 45, 0.05, "yawQuat 45");
}

/* --- raw gyro + 1.5 dps bias: stroke midpoint lock holds catch --- */
{
  const tracker = new OarAngleTracker({ omegaPeakMin: 20, refractoryMs: 300 });
  const amp = 45;
  const spm = 30;
  const f = spm / 60;
  const hz = 56;
  const dt = 1000 / hz;
  const bias = 1.5;
  tracker.update(
    { protocol: 2, eng: { ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0 } },
    0
  );
  tracker.zero();
  const catches = [];
  tracker.onEvent = (ev) => {
    if (ev.type === "catch") catches.push(ev);
  };
  const seconds = 14;
  const n = Math.round(seconds * hz);
  for (let i = 1; i < n; i++) {
    const t = i * dt;
    const sec = t / 1000;
    const gz = amp * 2 * Math.PI * f * Math.cos(2 * Math.PI * f * sec) + bias;
    tracker.update(
      { protocol: 2, eng: { ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz } },
      t
    );
  }
  assert(catches.length >= 4, `gyro+bias caught strokes (${catches.length})`);
  const tail = catches.slice(-3);
  for (const ev of tail) {
    assertNear(ev.theta, -amp, 8, "locked catch after bias walk");
  }
  assert(tracker.snapshot().source === "gyro", "source is raw gyro");
}

/* --- finish lock must not snap theta in one sample --- */
{
  const tracker = new OarAngleTracker({ omegaPeakMin: 20, refractoryMs: 300 });
  const amp = 45;
  const spm = 30;
  const f = spm / 60;
  const hz = 56;
  const dt = 1000 / hz;
  tracker.update(
    { protocol: 2, eng: { ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0 } },
    0
  );
  tracker.zero();
  let prev = null;
  let maxQuietStep = 0;
  const n = Math.round(14 * hz);
  for (let i = 1; i < n; i++) {
    const t = i * dt;
    const sec = t / 1000;
    const gz = amp * 2 * Math.PI * f * Math.cos(2 * Math.PI * f * sec) + 1.5;
    const out = tracker.update(
      { protocol: 2, eng: { ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz } },
      t
    );
    if (prev != null && Math.abs(out.omegaVert) < 12) {
      maxQuietStep = Math.max(maxQuietStep, Math.abs(out.theta - prev));
    }
    prev = out.theta;
  }
  assert(
    maxQuietStep < 2.5,
    `no finish DC snap (max |Δθ| at ω≈0 is ${maxQuietStep.toFixed(2)}°)`
  );
}

/* --- catch/finish phase lock drops a mid-drive extra catch --- */
{
  const tracker = new OarAngleTracker({ omegaPeakMin: 20, refractoryMs: 200 });
  const hz = 56;
  const dt = 1000 / hz;
  let t = 0;
  const step = (gz, ms) => {
    const n = Math.round(ms / dt);
    for (let i = 0; i < n; i++) {
      t += dt;
      tracker.update(
        { protocol: 2, eng: { ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz } },
        t
      );
    }
  };
  tracker.update(
    { protocol: 2, eng: { ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0 } },
    0
  );
  tracker.zero();
  step(-80, 200);
  step(90, 120);
  step(-40, 80);
  step(90, 500);
  step(-90, 500);
  const catches = tracker.events.filter((e) => e.type === "catch");
  const finishes = tracker.events.filter((e) => e.type === "finish");
  assertEq(catches.length, 1, "phase lock keeps one catch");
  assertEq(finishes.length, 1, "real finish still fires");
}

/* --- blade feather from gravity about the frozen shaft --- */
{
  assertEq(pickShaftAxis({ x: 0.05, y: 0.02, z: 0.99 }), 1, "shaft is smallest |g|");
  assertNear(featherDeg({ x: 0, y: 0, z: 1 }, 0), 0, 1e-9, "squared feather 0");
  assertNear(featherDeg({ x: 0, y: 1, z: 0 }, 0), 90, 1e-9, "90° about X");
  const tracker = new OarAngleTracker();
  const hz = 56;
  const dt = 1000 / hz;
  tracker.update(
    { protocol: 2, eng: { ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0 } },
    0
  );
  tracker.zero();
  assertNear(tracker.feather, 0, 1, "Zero squares feather");
  for (let i = 1; i <= hz * 2; i++) {
    tracker.update(
      { protocol: 2, eng: { ax: 0, ay: 1, az: 0, gx: 0, gy: 0, gz: 0 } },
      i * dt
    );
  }
  assertNear(tracker.feather, 90, 8, "LP gravity reports ~90° feather");
}

/* --- boat class: stroke-side / bow-side → port/starboard --- */
{
  assertEq(getBoatClass("8+").kind, "sweep", "8+ is sweep");
  assertEq(getBoatClass("2x").kind, "scull", "2x is scull");
  assertEq(defaultHandForSeat("8+", "stroke"), "stroke", "stroke is stroke-side");
  assertEq(defaultHandForSeat("8+", "7"), "bow", "7 is bow-side");
  assertEq(defaultHandForSeat("8+", "6"), "stroke", "6 is stroke-side");
  assertEq(defaultHandForSeat("8+", "5"), "bow", "5 is bow-side");
  assertEq(defaultHandForSeat("8+", "bow"), "bow", "bow seat is bow-side");
  assertEq(defaultHandForSeat("4+", "3"), "bow", "4+ three-seat is bow-side");
  assertEq(defaultHandForSeat("2x", "bow"), "stroke", "scull defaults same gunwale");
  assertEq(
    portStarboardFromHand("stroke", "starboard"),
    "starboard",
    "stroke sits starboard"
  );
  assertEq(portStarboardFromHand("bow", "starboard"), "port", "bow-side is port");
  assertEq(portStarboardFromHand("bow", "port"), "starboard", "opposite rig");
}

console.log(`rowing tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
