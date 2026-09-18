/**
 * RowPod angle, event, timebase, and crew-sync tests.
 *
 * Run: node web/ble_plotter/rowing_angle.test.js
 */
import { OarAngleTracker, gravityBodyFromQuat, wrap180, yawAboutGravityDeg, pickShaftAxis, featherDeg } from "./rowing_angle.js";
import { CrewSync, strokesToCsv, coachCatchCue, formatCatchVsStroke, featherDtVsRefMs, STROKE_CSV_COLUMNS } from "./rowing_crew.js";
import { PodTimeBase, extendSampleIndex, weightedLinearFit } from "./timebase.js";
import {
  defaultHandForSeat,
  portStarboardFromHand,
  getBoatClass,
  rigWithBoatClass,
} from "./boat_rig.js";
import { bladeArcM, driveArcDeg, defaultSpansForKind, spanCmToM } from "./rowing_length.js";
import {
  FAN_ARC_CCW,
  FAN_MAX_DEG,
  clampFanDeg,
  oarToCanvasRad,
  oarToXY,
  seatLaneRadius,
} from "./rowing_fan.js";

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
  assert(csv.includes("match_quality"), "csv has match_quality");
}

/* --- 1.4 match_forward_no_half_period_alias --- */
{
  const crew = new CrewSync({ catchSpreadMs: 40 });
  crew.setReference("stroke");
  const rms = { timebaseRmsMs: 5 };
  crew.observeEvent("stroke", { type: "catch", t: 2000, theta: -50 }, { seat: "stroke", ...rms });
  crew.observeEvent("stroke", { type: "finish", t: 2800, theta: 30 }, { seat: "stroke", ...rms });
  crew.observeEvent("bow", { type: "catch", t: 1400, theta: -48 }, { seat: "bow", ...rms });
  crew.observeEvent("bow", { type: "finish", t: 2790, theta: 31 }, { seat: "bow", ...rms });
  const last = crew.snapshot().last;
  assertEq(last.completeSeats, 1, "do not pair a catch 600 ms before reference");
  assert(last.inSync !== true, "aliased pair is not in-sync");
  assertEq(last.matchQuality, "single_seat", "quality is single_seat");
}

/* --- 1.4 in_sync_undefined_when_single_seat --- */
{
  const crew = new CrewSync({ catchSpreadMs: 40 });
  crew.setReference("stroke");
  for (let i = 0; i < 4; i++) {
    const t = 1000 + i * 2000;
    crew.observeEvent("stroke", { type: "catch", t, theta: -50 }, { seat: "stroke", timebaseRmsMs: 5 });
    crew.observeEvent("stroke", { type: "finish", t: t + 800, theta: 35 }, { seat: "stroke", timebaseRmsMs: 5 });
  }
  crew.commit();
  const snap = crew.snapshot();
  assert(snap.ratedStrokes === 0, "single seat is not rated for in-sync");
  assert(snap.timeInSyncPct === 0, "single seat cannot score 100% in-sync");
  const csv = strokesToCsv(snap.strokes);
  assert(
    snap.strokes.every((s) => s.inSync !== true),
    "no stroke marked in-sync"
  );
  assert(csv.includes("single_seat"), "csv records single_seat");
  assert(
    !csv.split("\n").filter((l) => l && !l.startsWith("#") && l.includes("single_seat")).some((l) => l.includes(",1,single_seat")),
    "csv does not write in_sync=1 for single seat"
  );
}

/* --- 1.4 in_sync_undefined_when_finish_missing --- */
{
  const crew = new CrewSync({ catchSpreadMs: 40 });
  crew.setReference("stroke");
  crew.observeEvent("stroke", { type: "catch", t: 1000, theta: -50 }, { seat: "stroke", timebaseRmsMs: 5 });
  crew.observeEvent("bow", { type: "catch", t: 1012, theta: -48 }, { seat: "bow", timebaseRmsMs: 5 });
  crew.observeEvent("stroke", { type: "finish", t: 1800, theta: 30 }, { seat: "stroke", timebaseRmsMs: 5 });
  const last = crew.snapshot().last;
  assertEq(last.matchQuality, "missing_finish", "missing finish quality");
  assert(last.inSync == null, "in-sync undefined when a finish is missing");
  assertNear(last.catchSpreadMs, 12, 0.1, "catch spread still scored without a finish");
  const cue = coachCatchCue(last, 40);
  assert(cue.text.includes("12 ms late"), `cue names the catch miss (got ${cue.text})`);
  crew.commit();
  const csv = strokesToCsv(crew.strokes);
  const data = csv.split("\n").filter((l) => l && !l.startsWith("#") && !l.startsWith("stroke_index"));
  assert(
    data.every((l) => /,missing_finish,/.test(l)),
    "csv does not write in_sync=1 without finishes"
  );
  const bow = data.find((l) => l.split(",")[1] === "bow");
  const cols = bow.split(",");
  const names = STROKE_CSV_COLUMNS.split(",");
  assertEq(cols[names.indexOf("arc_deg")], "", "missing finish has empty arc");
  assertEq(cols[names.indexOf("blade_arc_m")], "", "missing finish has empty length");
}

/* --- 1.4 in_sync_undefined_when_clock_untrusted --- */
{
  const crew = new CrewSync({ catchSpreadMs: 40 });
  crew.setReference("stroke");
  crew.observeEvent("stroke", { type: "catch", t: 1000, theta: -50 }, { seat: "stroke", timebaseRmsMs: 40 });
  crew.observeEvent("bow", { type: "catch", t: 1010, theta: -48 }, { seat: "bow", timebaseRmsMs: 40 });
  crew.observeEvent("stroke", { type: "finish", t: 1800, theta: 30 }, { seat: "stroke", timebaseRmsMs: 40 });
  crew.observeEvent("bow", { type: "finish", t: 1815, theta: 32 }, { seat: "bow", timebaseRmsMs: 40 });
  const last = crew.snapshot().last;
  assertEq(last.matchQuality, "untrusted_time", "clock rms 40 ms is untrusted");
  assert(last.inSync == null, "in-sync undefined when clock is untrusted");
  crew.commit();
  const csv = strokesToCsv(crew.strokes);
  assert(csv.includes("UNTRUSTED_TIME"), "csv persists UNTRUSTED_TIME");
}

/* --- 1.4 alias guard at 20 and 40 spm --- */
{
  for (const spm of [20, 40]) {
    const period = 60000 / spm;
    const crew = new CrewSync({ catchSpreadMs: 40 });
    crew.setReference("stroke");
    const rms = { timebaseRmsMs: 5 };
    const t0 = 1000;
    crew.observeEvent("stroke", { type: "catch", t: t0, theta: -50 }, { seat: "stroke", ...rms });
    crew.observeEvent("bow", { type: "catch", t: t0 + 8, theta: -48 }, { seat: "bow", ...rms });
    crew.observeEvent("stroke", { type: "finish", t: t0 + period * 0.4, theta: 30 }, { seat: "stroke", ...rms });
    crew.observeEvent("bow", { type: "finish", t: t0 + period * 0.4 + 10, theta: 31 }, { seat: "bow", ...rms });
    const t = t0 + period;
    crew.observeEvent("stroke", { type: "catch", t, theta: -50 }, { seat: "stroke", ...rms });
    crew.observeEvent("stroke", { type: "finish", t: t + period * 0.4, theta: 30 }, { seat: "stroke", ...rms });
    crew.observeEvent("bow", { type: "catch", t: t - 0.45 * period, theta: -48 }, { seat: "bow", ...rms });
    crew.observeEvent("bow", { type: "finish", t: t + period * 0.4, theta: 31 }, { seat: "bow", ...rms });
    const last = crew.snapshot().last;
    assert(last.inSync !== true, `no half-period alias at ${spm} spm`);
    assertEq(last.completeSeats, 1, `${spm} spm must not consume the previous catch`);
  }
}

/* --- 1.4 do not pair stroke N with seat B stroke N+1 --- */
{
  const crew = new CrewSync({ catchSpreadMs: 40 });
  crew.setReference("stroke");
  const rms = { timebaseRmsMs: 5 };
  crew.observeEvent("stroke", { type: "catch", t: 1000, theta: -50 }, { seat: "stroke", ...rms });
  crew.observeEvent("stroke", { type: "finish", t: 1800, theta: 30 }, { seat: "stroke", ...rms });
  crew.observeEvent("stroke", { type: "catch", t: 3000, theta: -50 }, { seat: "stroke", ...rms });
  crew.observeEvent("bow", { type: "catch", t: 3010, theta: -48 }, { seat: "bow", ...rms });
  crew.observeEvent("stroke", { type: "finish", t: 3800, theta: 30 }, { seat: "stroke", ...rms });
  crew.observeEvent("bow", { type: "finish", t: 3820, theta: 31 }, { seat: "bow", ...rms });
  crew.commit();
  assertEq(crew.strokes[0].completeSeats, 1, "stroke 1 stays unmatched if bow is late");
  assert(crew.strokes[0].inSync == null, "stroke 1 is not rated");
  assertEq(crew.strokes[1].completeSeats, 2, "bow catch 3010 belongs to stroke 2");
  assertNear(crew.strokes[1].catchSpreadMs, 10, 0.1, "stroke 2 spread is 10 ms");
  assertEq(crew.strokes[1].inSync, true, "stroke 2 is in-sync");
}

/* --- 1.4 missing timebase rms is not untrusted --- */
{
  const crew = new CrewSync({ catchSpreadMs: 40 });
  crew.setReference("stroke");
  crew.observeEvent("stroke", { type: "catch", t: 1000, theta: -50 }, { seat: "stroke" });
  crew.observeEvent("bow", { type: "catch", t: 1010, theta: -48 }, { seat: "bow" });
  crew.observeEvent("stroke", { type: "finish", t: 1800, theta: 30 }, { seat: "stroke" });
  crew.observeEvent("bow", { type: "finish", t: 1815, theta: 32 }, { seat: "bow" });
  const last = crew.snapshot().last;
  assertEq(last.matchQuality, "ok", "omitted rms is trusted");
  assertEq(last.inSync, true, "omitted rms can still rate in-sync");
}

/* --- 1.4 sample filter ignores extra seats --- */
{
  const crew = new CrewSync({ catchSpreadMs: 40 });
  crew.setReference("stroke");
  crew.setActiveSeats(["stroke", "bow"]);
  const rms = { timebaseRmsMs: 5 };
  crew.observeEvent("stroke", { type: "catch", t: 1000, theta: -50 }, { seat: "stroke", ...rms });
  crew.observeEvent("bow", { type: "catch", t: 1008, theta: -48 }, { seat: "bow", ...rms });
  crew.observeEvent("three", { type: "catch", t: 1700, theta: -40 }, { seat: "3", ...rms });
  crew.observeEvent("stroke", { type: "finish", t: 1800, theta: 30 }, { seat: "stroke", ...rms });
  crew.observeEvent("bow", { type: "finish", t: 1810, theta: 31 }, { seat: "bow", ...rms });
  crew.observeEvent("three", { type: "finish", t: 2500, theta: 20 }, { seat: "3", ...rms });
  const last = crew.snapshot().last;
  assertEq(last.completeSeats, 2, "sampled pair ignores seat 3");
  assertNear(last.catchSpreadMs, 8, 0.1, "spread is stroke vs bow only");
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

/* --- 1.4.1 180° fan geometry --- */
{
  assertEq(FAN_ARC_CCW, false, "upper semicircle is canvas clockwise");
  assertEq(FAN_MAX_DEG, 90, "fan is ±90°");
  assertEq(clampFanDeg(-122), -90, "walked catch clamps to -90");
  assertEq(clampFanDeg(78), 78, "finish +78 stays on scale");
  const o = oarToXY(0, 100, 0, 0);
  assert(Math.abs(o.x) < 1e-9 && Math.abs(o.y + 100) < 1e-9, "0° is straight up");
  const c = oarToXY(-90, 100, 0, 0);
  assert(Math.abs(c.x + 100) < 1e-9 && Math.abs(c.y) < 1e-9, "-90° is left");
  const f = oarToXY(90, 100, 0, 0);
  assert(Math.abs(f.x - 100) < 1e-9 && Math.abs(f.y) < 1e-9, "+90° is right");
  const mid = oarToXY((-60 + 30) / 2, 100, 0, 0);
  assert(mid.y < -50, "catch→finish midpoint stays in the upper half");
  assertNear(oarToCanvasRad(-90), -Math.PI, 1e-9, "catch rim is canvas -π");
  assertNear(oarToCanvasRad(90), 0, 1e-9, "finish rim is canvas 0");
  assertNear(seatLaneRadius(0, 2, 100), 80, 0.1, "outer seat lane");
  assertNear(seatLaneRadius(1, 2, 100), 44, 0.1, "inner seat lane");
}

/* --- 1.4.2 catch late/early vs stroke --- */
{
  assertEq(formatCatchVsStroke(12, 40).text, "12 ms late", "late copy");
  assertEq(formatCatchVsStroke(-8, 40).text, "8 ms early", "early copy");
  assertEq(formatCatchVsStroke(12, 40).kind, "in", "12 ms is inside 40 ms");
  assertEq(formatCatchVsStroke(48, 40).kind, "out", "48 ms is outside 40 ms");
  assertEq(formatCatchVsStroke(313, 40).kind, "untrusted", "300 ms is not a crew miss");
  const crew = new CrewSync({ catchSpreadMs: 40 });
  crew.setReference("stroke");
  crew.observeEvent("stroke", { type: "catch", t: 1000, theta: -50 }, { seat: "stroke", timebaseRmsMs: 5 });
  crew.observeEvent("bow", { type: "catch", t: 1012, theta: -48 }, { seat: "bow", timebaseRmsMs: 5 });
  const cue = coachCatchCue(crew.snapshot().last, 40);
  assertEq(cue.text, "bow 12 ms late", "live cue before finishes");
}

/* --- 1.4.3 drive arc, blade metres, spans --- */
{
  assertNear(bladeArcM(90, 2), Math.PI, 1e-9, "90° × 2.00 m = π m");
  assertNear(driveArcDeg(-50, 29), 79, 1e-9, "79° drive");
  assertEq(driveArcDeg(-50, undefined), null, "missing finish has no arc");
  assertEq(bladeArcM(null, 2), null, "no metres without arc");
  assertNear(defaultSpansForKind("scull").outboardM, 2, 1e-9, "scull outboard");
  assertNear(defaultSpansForKind("sweep").outboardM, 2.61, 1e-9, "sweep outboard");
  assertNear(spanCmToM(261, 2), 2.61, 1e-9, "cm to m");
  const filled = rigWithBoatClass(
    { boatClass: "8+", strokeSits: "starboard", inboardM: 1.15, outboardM: 2.61, spansCustom: false },
    "2x"
  );
  assertNear(filled.outboardM, 2, 1e-9, "scull defaults replace sweep when not custom");
  const kept = rigWithBoatClass(
    { boatClass: "8+", strokeSits: "starboard", inboardM: 1.2, outboardM: 2.7, spansCustom: true },
    "2x"
  );
  assertNear(kept.outboardM, 2.7, 1e-9, "typed spans survive boat-class change");
}

/* --- 1.4.3 squared-only drive never emits feather-on --- */
{
  const tracker = new OarAngleTracker({ omegaPeakMin: 20, refractoryMs: 300 });
  const events = [];
  tracker.onEvent = (ev) => events.push(ev);
  const hz = 56;
  const dt = 1000 / hz;
  tracker.update(
    { protocol: 2, eng: { ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0 } },
    0
  );
  tracker.zero();
  const amp = 45;
  const spm = 30;
  const f = spm / 60;
  const n = Math.round(8 * hz);
  for (let i = 1; i < n; i++) {
    const t = i * dt;
    const sec = t / 1000;
    const gz = amp * 2 * Math.PI * f * Math.cos(2 * Math.PI * f * sec);
    tracker.update(
      { protocol: 2, eng: { ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz } },
      t
    );
  }
  assert(events.some((e) => e.type === "finish"), "squared piece still finishes");
  assertEq(
    events.filter((e) => e.type === "feather").length,
    0,
    "squared-only has no feather-on"
  );
}

/* --- 1.4.3 roll after finish → one interpolated feather-on --- */
{
  const tracker = new OarAngleTracker({ omegaPeakMin: 20, refractoryMs: 250 });
  const events = [];
  tracker.onEvent = (ev) => events.push(ev);
  const dt = 1000 / 56;
  let t = 0;
  const step = (gz, ms, g = { ax: 0, ay: 0, az: 1 }) => {
    const n = Math.round(ms / dt);
    for (let i = 0; i < n; i++) {
      t += dt;
      tracker.update(
        { protocol: 2, eng: { ax: g.ax, ay: g.ay, az: g.az, gx: 0, gy: 0, gz } },
        t
      );
    }
  };
  tracker.update(
    { protocol: 2, eng: { ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0 } },
    0
  );
  tracker.zero();
  step(-90, 350);
  step(110, 90);
  step(90, 500);
  step(-110, 90);
  const afterFinish = t;
  step(-12, 450, { ax: 0, ay: 1, az: 0 });
  const feathers = events.filter((e) => e.type === "feather");
  assertEq(feathers.length, 1, "one feather-on after finish");
  assert(feathers[0].t > afterFinish, "feather-on is after finish");
  assert(feathers[0].t < afterFinish + 450, "feather-on during the roll");
}

/* --- 1.4.3 synced feather Δt 20 ms; CSV columns --- */
{
  const crew = new CrewSync({ catchSpreadMs: 40 });
  crew.setReference("stroke");
  const rms = { timebaseRmsMs: 5 };
  crew.observeEvent("stroke", { type: "catch", t: 1000, theta: -50 }, { seat: "stroke", ...rms });
  crew.observeEvent("bow", { type: "catch", t: 1010, theta: -48 }, { seat: "bow", ...rms });
  crew.observeEvent("stroke", { type: "finish", t: 1800, theta: 30 }, { seat: "stroke", ...rms });
  crew.observeEvent("bow", { type: "finish", t: 1810, theta: 31 }, { seat: "bow", ...rms });
  crew.observeEvent("stroke", { type: "feather", t: 1900, feather: 50, trusted: true }, { seat: "stroke", ...rms });
  crew.observeEvent("bow", { type: "feather", t: 1920, feather: 50, trusted: true }, { seat: "bow", ...rms });
  const last = crew.snapshot().last;
  const stroke = last.seats.find((s) => s.id === "stroke");
  const bow = last.seats.find((s) => s.id === "bow");
  assertNear(featherDtVsRefMs(bow, stroke), 20, 0.1, "bow 20 ms late to feather");
  crew.commit();
  const csv = strokesToCsv(crew.strokes, 0, {
    boatClass: "2-",
    strokeSits: "starboard",
    inboardM: 1.15,
    outboardM: 2,
  });
  assert(csv.includes("t_feather_ms"), "csv has t_feather_ms");
  assert(csv.includes("feather_dt_vs_ref_ms"), "csv has feather dt");
  assert(csv.includes("blade_arc_m"), "csv has blade_arc_m");
  assert(csv.includes("outboard_m=2.000"), "csv stamps outboard");
  assert(csv.includes("inboard_m=1.150"), "csv stamps inboard");
  assert(csv.includes("20.0"), "csv writes 20 ms feather dt");
  const piish = bladeArcM(80, 2).toFixed(3);
  assert(csv.includes(piish) || csv.includes("2.793"), "csv writes blade metres");
}

/* --- 1.4.3 fan-tracking feather is untrusted, empty Δt --- */
{
  const tracker = new OarAngleTracker({ omegaPeakMin: 20, refractoryMs: 300 });
  const events = [];
  tracker.onEvent = (ev) => events.push(ev);
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
  const n = Math.round(10 * hz);
  for (let i = 1; i < n; i++) {
    const t = i * dt;
    const sec = t / 1000;
    const theta = amp * Math.sin(2 * Math.PI * f * sec);
    const gz = amp * 2 * Math.PI * f * Math.cos(2 * Math.PI * f * sec);
    const rad = (theta * Math.PI) / 180;
    tracker.update(
      {
        protocol: 2,
        eng: { ax: 0, ay: Math.sin(rad), az: Math.cos(rad), gx: 0, gy: 0, gz },
      },
      t
    );
  }
  assertEq(tracker.snapshot().featherTrusted, false, "fan-tracking untrusted");
  const crew = new CrewSync({ catchSpreadMs: 40 });
  crew.setReference("stroke");
  const rms = { timebaseRmsMs: 5 };
  crew.observeEvent("stroke", { type: "catch", t: 1000, theta: -50 }, { seat: "stroke", ...rms });
  crew.observeEvent("bow", { type: "catch", t: 1010, theta: -48 }, { seat: "bow", ...rms });
  crew.observeEvent("stroke", { type: "finish", t: 1800, theta: 30 }, { seat: "stroke", ...rms });
  crew.observeEvent("bow", { type: "finish", t: 1810, theta: 31 }, { seat: "bow", ...rms });
  crew.observeEvent(
    "stroke",
    { type: "feather", t: 1900, feather: 50, trusted: false },
    { seat: "stroke", ...rms }
  );
  crew.observeEvent(
    "bow",
    { type: "feather", t: 1920, feather: 50, trusted: false },
    { seat: "bow", ...rms }
  );
  const last = crew.snapshot().last;
  const stroke = last.seats.find((s) => s.id === "stroke");
  const bow = last.seats.find((s) => s.id === "bow");
  assertEq(featherDtVsRefMs(bow, stroke), null, "untrusted feather has empty Δt");
  crew.commit();
  const csv = strokesToCsv(crew.strokes, 0, { outboardM: 2 });
  const names = STROKE_CSV_COLUMNS.split(",");
  const data = csv.split("\n").filter((l) => l && !l.startsWith("#") && !l.startsWith("stroke_index"));
  for (const line of data) {
    const cols = line.split(",");
    assertEq(cols[names.indexOf("t_feather_ms")], "", "untrusted t_feather empty");
    assertEq(cols[names.indexOf("feather_dt_vs_ref_ms")], "", "untrusted dt empty");
  }
}

console.log(`rowing tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
