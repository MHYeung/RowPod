/**
 * Dependency-free protocol golden-vector tests for C3-Tracker v1/v16 wire formats.
 *
 * Run: node web/ble_plotter/protocol.test.js
 */
import {
  FRAME_V1_LEN,
  FRAME_V16_LEN,
  FRAME_FUSED_LEN,
  SESSION_COMMAND_STATE,
  SESSION_DRAIN,
  SESSION_STOP,
  SequenceTracker,
  captureBatchFrames,
  capturePreflight,
  negotiatedAttMtu,
  decodeCaps,
  decodeFrame,
  decodeFrameFused,
  decodeFrameV16,
  decodeFrames,
  decodeFramesFused,
  decodeFramesV16,
  decodeSessionStatus,
  decodeSessionStatusV16,
  decodeSyncRsp,
  encodeSessionCommand,
  encodeSessionCommandV16,
  rateFromWire,
  rateToWire,
} from "./protocol.js";

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

function bytes(arr) {
  return new DataView(Uint8Array.from(arr).buffer);
}

const meta = {
  accel_lsb_per_g: 2048,
  gyro_lsb_per_dps: 16,
  mag_lsb_per_gauss: 3750,
};

/* --- v1 frame --- */
{
  const view = bytes([
    0x34, 0x12, // seq 0x1234
    0x00, 0x08, // ax = 2048 → 1 g
    0x00, 0x00,
    0x00, 0x00,
    0x10, 0x00, // gx = 16 → 1 dps
    0x00, 0x00,
    0x00, 0x00,
    0xA6, 0x0E, // mx = 3750 → 1 G
    0x00, 0x00,
    0x00, 0x00,
  ]);
  assertEq(view.byteLength, FRAME_V1_LEN, "v1 frame length");
  const frame = decodeFrame(view, meta);
  assertEq(frame.protocol, 1, "v1 protocol marker");
  assertEq(frame.seq, 0x1234, "v1 seq");
  assertEq(frame.eng.ax, 1, "v1 ax scale");
  assertEq(frame.eng.gx, 1, "v1 gx scale");
  assertEq(frame.eng.mx, 1, "v1 mx scale");
}

/* --- v16 frame --- */
{
  const view = bytes([
    0x78, 0x56, 0x34, 0x12, // sample_index 0x12345678
    0x00, 0x08,
    0x00, 0x00,
    0x00, 0x00,
    0x10, 0x00,
    0x00, 0x00,
    0x00, 0x00,
    0xA6, 0x0E,
    0x00, 0x00,
    0x00, 0x00,
  ]);
  assertEq(view.byteLength, FRAME_V16_LEN, "v16 frame length");
  const frame = decodeFrameV16(view, meta);
  assertEq(frame.protocol, 2, "v16 protocol marker");
  assertEq(frame.sampleIndex, 0x12345678, "v16 sample index");
}

/* --- fused frame --- */
{
  const fused = [
    0x78, 0x56, 0x34, 0x12,
    0xff, 0x7f, // qw = 32767 → 1
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x08, // ax = 2048 → 1 g
    0x00, 0x00, 0x00, 0x00,
    0xA6, 0x0E, // mx = 3750 → 1 G
    0x00, 0x00, 0x00, 0x00,
  ];
  const view = bytes(fused);
  assertEq(view.byteLength, FRAME_FUSED_LEN, "fused frame length");
  const frame = decodeFrameFused(view, meta);
  assertEq(frame.protocol, 3, "fused protocol marker");
  assertEq(frame.quat.qw, 1, "fused qw Q15");
  assertEq(frame.eng.ax, 1, "fused ax scale");
  assertEq(frame.eng.mx, 1, "fused mx scale");
}

/* --- batched payloads --- */
{
  const one = new Uint8Array(FRAME_V1_LEN);
  one[0] = 1;
  const two = new Uint8Array(FRAME_V1_LEN * 2);
  two.set(one, 0);
  two[FRAME_V1_LEN] = 2;
  assertEq(decodeFrames(new DataView(two.buffer), meta).length, 2, "v1 batch count");

  let threw = false;
  try {
    decodeFrames(new DataView(new Uint8Array(21).buffer), meta);
  } catch (_) {
    threw = true;
  }
  assert(threw, "malformed v1 payload rejected");

  threw = false;
  try {
    decodeFramesV16(new DataView(new Uint8Array(23).buffer), meta);
  } catch (_) {
    threw = true;
  }
  assert(threw, "malformed v16 payload rejected");

  threw = false;
  try {
    decodeFramesFused(new DataView(new Uint8Array(25).buffer), meta);
  } catch (_) {
    threw = true;
  }
  assert(threw, "malformed fused payload rejected");
}

/* --- sequence wrap / missing frames --- */
{
  const t16 = new SequenceTracker({ bits: 16 });
  t16.observe(65534);
  const wrap = t16.observe(1);
  assertEq(wrap.missing, 2, "16-bit wrap missing frames");
  assertEq(t16.gapEvents, 1, "16-bit wrap gap event");
  assertEq(t16.missingFrames, 2, "16-bit cumulative missing");

  const t32 = new SequenceTracker({ bits: 32 });
  t32.observe(100);
  const gap = t32.observe(104);
  assertEq(gap.missing, 3, "32-bit gap missing");
  assertEq(t32.logical, 104, "32-bit logical index");

  t32.rebase(200);
  assertEq(t32.gapEvents, 0, "rebase clears gap events");
  assertEq(t32.missingFrames, 0, "rebase clears missing");
  const after = t32.observe(201);
  assertEq(after.missing, 0, "rebase baseline has no gap");
}

/* --- session command encode --- */
{
  const v1 = encodeSessionCommand(2, 0xabcdef01, 224, 0);
  assertEq(v1.length, 8, "v1 session cmd length");
  assertEq(v1[0], 1, "v1 session ver");
  assertEq(v1[1], 2, "v1 session command");
  assertEq(v1[2], 224, "v1 session rate");
  const v1view = new DataView(v1.buffer);
  assertEq(v1view.getUint32(4, true), 0xabcdef01, "v1 capture id");

  const v16 = encodeSessionCommandV16(4, 0x11, 112, 0, 7);
  assertEq(v16.length, 12, "v16 session cmd length");
  assertEq(v16[0], 2, "v16 session ver");
  assertEq(v16[1], 4, "v16 drain command");
  const v16view = new DataView(v16.buffer);
  assertEq(SESSION_COMMAND_STATE[SESSION_STOP], "stop_requested", "stop maps to state");
  assertEq(SESSION_COMMAND_STATE[SESSION_DRAIN], "draining", "drain maps to state");

  assertEq(rateToWire(448), 255, "448 Hz encodes as wire 255");
  assertEq(rateFromWire(255), 448, "wire 255 decodes as 448 Hz");
  const captureCmd = encodeSessionCommand(2, 1, 448, 0);
  assertEq(captureCmd[2], 255, "session cmd 448 Hz is wire 255");
}

/* --- status decode --- */
{
  const status = new Uint8Array(36);
  status[0] = 1;
  status[1] = 4; // draining
  status[2] = 224;
  status[3] = 0x20 | 0x10; // drain done + has samples
  new DataView(status.buffer).setUint32(4, 99, true);
  new DataView(status.buffer).setUint16(14, 0, true);
  const decoded = decodeSessionStatus(new DataView(status.buffer));
  assertEq(decoded.stateName, "draining", "v1 status state");
  assert(decoded.drainDone, "v1 drain done flag");
  assert(decoded.hasSamples, "v1 has samples flag");

  const status16 = new Uint8Array(56);
  status16[0] = 2;
  status16[1] = 5;
  status16[2] = 224;
  status16[3] = 224;
  status16[4] = 0x20 | 0x40;
  status16[5] = 0;
  new DataView(status16.buffer).setUint16(6, 3, true);
  new DataView(status16.buffer).setUint32(8, 42, true);
  new DataView(status16.buffer).setUint16(14, 247, true);
  new DataView(status16.buffer).setUint32(24, 1000, true);
  new DataView(status16.buffer).setUint32(28, 1000, true);
  const d16 = decodeSessionStatusV16(new DataView(status16.buffer));
  assertEq(d16.stateName, "finalized", "v16 finalized state");
  assertEq(d16.attMtu, 247, "v16 att mtu");
  assertEq(d16.lastSent, 1000, "v16 last sent");
  assertEq(d16.finalSample, 1000, "v16 final sample");
  assert(d16.drainDone, "v16 drain done");
  assert(d16.rateApplied, "v16 rate applied");
}

/* --- capabilities --- */
{
  const caps = new Uint8Array(20);
  caps[0] = 2;
  caps[1] = 0x1f;
  caps[2] = 0x0f;
  caps[3] = 8;
  caps[4] = 255;
  caps[5] = 255;
  caps[6] = 100;
  new DataView(caps.buffer).setUint16(8, 247, true);
  new DataView(caps.buffer).setUint16(10, 96, true);
  new DataView(caps.buffer).setUint16(12, 2, true);
  const decoded = decodeCaps(new DataView(caps.buffer));
  assert(decoded.supportsV16, "caps supports v16");
  assert(decoded.supportsDrain, "caps supports drain");
  assertEq(decoded.maxBatchFrames, 8, "caps max batch");
  assertEq(decoded.attMtu, 247, "caps mtu");
  assertEq(decoded.maxRateHz, 448, "caps max rate 448");
  assertEq(decoded.imuRateHz, 448, "caps imu rate 448");
  assert(decoded.rates[448], "caps advertises 448 Hz");
  assert(decoded.hasMag, "v1 caps with mag rate have a magnetometer");
  assertEq(decoded.hwRev, 1, "reserved hw byte 0 is legacy v1");
}

/* --- v2 caps: no magnetometer, hw_rev 2 --- */
{
  const caps = new Uint8Array(20);
  caps[0] = 2;
  caps[1] = 0x3f;
  caps[2] = 0x0f;
  caps[6] = 0;
  caps[7] = 2;
  new DataView(caps.buffer).setUint16(8, 247, true);
  const decoded = decodeCaps(new DataView(caps.buffer));
  assert(!decoded.hasMag, "v2 mag rate 0 has no magnetometer");
  assertEq(decoded.magRateHz, 0, "v2 mag rate");
  assertEq(decoded.hwRev, 2, "v2 hardware revision");
  assert(decoded.supportsFused, "v2 still advertises fused frames");
}

/* --- fused capabilities --- */
{
  const caps = new Uint8Array(20);
  caps[0] = 2;
  caps[1] = 0x3f; // includes CAP_FLAG_FUSED_FRAME
  caps[2] = 0x0f;
  caps[3] = 8;
  caps[4] = 255;
  new DataView(caps.buffer).setUint16(8, 247, true);
  new DataView(caps.buffer).setUint16(12, 3, true);
  const decoded = decodeCaps(new DataView(caps.buffer));
  assert(decoded.supportsFused, "caps supports fused");
  assertEq(decoded.firmwareProto, 3, "caps firmware proto fused");
}

/* --- host and pod MTU must both fit the frame --- */
{
  assertEq(negotiatedAttMtu(247, 23), 23, "host default MTU wins over pod 247");
  assertEq(negotiatedAttMtu(247, null), 23, "missing host hint stays at MTU 23");
  assertEq(negotiatedAttMtu(247, 247), 247, "agreed large MTU is kept");
  assertEq(negotiatedAttMtu(23, 247), 23, "pod default MTU is kept");
}

/* --- preflight --- */
{
  const bad = capturePreflight({ attMtu: 23, maxBatchFrames: 8, supportsV16: true }, 224, 1);
  assert(!bad.ok, "small MTU preflight fails for v16");
  const ok = capturePreflight({ attMtu: 247, maxBatchFrames: 8, supportsV16: true }, 56, 1);
  assert(ok.ok, "live rate preflight ok");
  const fusedCap = capturePreflight(
    { attMtu: 247, maxBatchFrames: 8, supportsFused: true, supportsV16: true },
    448,
    1
  );
  assert(fusedCap.ok, "fused 448 Hz preflight ok at MTU 247");
  assertEq(fusedCap.frameLen, 24, "fused preflight frame length");
  assertEq(fusedCap.batch, 4, "fused capture batches 4 frames");
}

/* --- four v2 pods: batch keeps each link near 56 notifies/s --- */
{
  const v1 = { attMtu: 247, maxBatchFrames: 8 };
  assertEq(captureBatchFrames(56), 1, "live stays one frame per notify");
  assertEq(captureBatchFrames(112), 2, "112 Hz packs 2 frames");
  assertEq(captureBatchFrames(224), 4, "224 Hz packs 4 frames");
  const boat224 = capturePreflight(v1, 224, 4);
  assert(boat224.ok, "4 pods at 224 Hz pass at 4 frames per notify");
  assertEq(boat224.batch, 4, "224 Hz batch on MTU 247");
  assertEq(boat224.notifyHz, 56, "224 Hz is 56 notifies/s per pod");
  const fallback = capturePreflight(v1, 112, 4, 1);
  assert(!fallback.ok, "probe fallback at 1 frame per notify warns for 4 pods");
  assertEq(fallback.boatNotifyHz, 448, "112 Hz unbatched is 448 notifies/s");
  const smallMtu = capturePreflight({ attMtu: 23, maxBatchFrames: 8 }, 224, 4);
  assert(!smallMtu.ok, "MTU 23 cannot batch 224 Hz for 4 pods");
  assertEq(smallMtu.batch, 1, "MTU 23 fits one v1 frame");
}

/* --- sync rsp 32-bit sample index (pad bytes 18-19) --- */
{
  const buf = new Uint8Array(20);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, 1000n, true);
  view.setBigUint64(8, 2_000_000n, true);
  view.setUint32(16, 70000, true);
  const rsp = decodeSyncRsp(view);
  assertEq(rsp.seq, 70000, "sync seq is 32-bit sample index");
  assertEq(rsp.deviceUs, 2_000_000, "sync device_us");
  const legacy = new Uint8Array(20);
  const lv = new DataView(legacy.buffer);
  lv.setUint16(16, 0x1234, true);
  assertEq(decodeSyncRsp(lv).seq, 0x1234, "legacy 16-bit seq still decodes");
}

console.log(`protocol tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
