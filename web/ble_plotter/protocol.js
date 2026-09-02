/** Motion service UUIDs (must match firmware sensor_protocol). */
export const MOTION_SVC = "9b7e1000-2b2f-4f71-9b86-4bb2e6d54f00";
export const MOTION_DATA = "9b7e1001-2b2f-4f71-9b86-4bb2e6d54f00";
export const MOTION_META = "9b7e1002-2b2f-4f71-9b86-4bb2e6d54f00";
export const MOTION_DATA_V16 = "9b7e1003-2b2f-4f71-9b86-4bb2e6d54f00";
export const MOTION_DATA_FUSED = "9b7e1004-2b2f-4f71-9b86-4bb2e6d54f00";

/** Pod configuration / software-sync service. */
export const CFG_SVC = "9b7e2000-2b2f-4f71-9b86-4bb2e6d54f00";
export const CFG_INFO = "9b7e2001-2b2f-4f71-9b86-4bb2e6d54f00";
export const CFG_NAME = "9b7e2002-2b2f-4f71-9b86-4bb2e6d54f00";
export const CFG_SYNC = "9b7e2003-2b2f-4f71-9b86-4bb2e6d54f00";
export const CFG_BATT = "9b7e2004-2b2f-4f71-9b86-4bb2e6d54f00";
export const CFG_RATE = "9b7e2005-2b2f-4f71-9b86-4bb2e6d54f00";
export const CFG_PROFILE = "9b7e2006-2b2f-4f71-9b86-4bb2e6d54f00";
export const CFG_SESSION = "9b7e2007-2b2f-4f71-9b86-4bb2e6d54f00";
export const CFG_STATUS = "9b7e2008-2b2f-4f71-9b86-4bb2e6d54f00";
export const CFG_CAPS = "9b7e2009-2b2f-4f71-9b86-4bb2e6d54f00";
export const CFG_SESSION_V16 = "9b7e200a-2b2f-4f71-9b86-4bb2e6d54f00";
export const CFG_STATUS_V16 = "9b7e200b-2b2f-4f71-9b86-4bb2e6d54f00";

export const FLAG_MULTI = 0x0001;
export const BATT_FLAG_VALID = 0x01;
export const PROFILE_GENERAL = 0;
export const PROFILE_HYROX = 1;
export const PROFILE_ROWING = 2;
export const SESSION_PREPARE = 1;
export const SESSION_START = 2;
export const SESSION_STOP = 3;
export const SESSION_DRAIN = 4;
export const SESSION_FINALIZE = 5;
export const SESSION_ABORT = 6;

export const SESSION_FLAG_CONNECTED = 0x01;
export const SESSION_FLAG_SUBSCRIBED = 0x02;
export const SESSION_FLAG_STREAMING = 0x04;
export const SESSION_FLAG_BATT_VALID = 0x08;
export const SESSION_FLAG_HAS_SAMPLES = 0x10;
export const SESSION_FLAG_DRAIN_DONE = 0x20;
export const SESSION_FLAG_RATE_APPLIED = 0x40;

export const CAP_FLAG_V1_FRAME = 0x01;
export const CAP_FLAG_V16_FRAME = 0x02;
export const CAP_FLAG_DRAIN_BARRIER = 0x04;
export const CAP_FLAG_APPLIED_RATE = 0x08;
export const CAP_FLAG_32BIT_SEQ = 0x10;
export const CAP_FLAG_FUSED_FRAME = 0x20;

export const SESSION_STATES = Object.freeze({
  0: "idle",
  1: "prepared",
  2: "recording",
  3: "stop_requested",
  4: "draining",
  5: "finalized",
  6: "error",
});

/** Expected status.stateName after a successful session command. */
export const SESSION_COMMAND_STATE = Object.freeze({
  [SESSION_PREPARE]: "prepared",
  [SESSION_START]: "recording",
  [SESSION_STOP]: "stop_requested",
  [SESSION_DRAIN]: "draining",
  [SESSION_FINALIZE]: "finalized",
  [SESSION_ABORT]: "idle",
});

export const ERROR_REASONS = Object.freeze({
  0: "none",
  1: "bad_version",
  2: "bad_state",
  3: "bad_capture_id",
  4: "bad_rate",
  5: "drain_incomplete",
  6: "busy",
});

/** Device stream rates (must match firmware allow-list). */
export const RATE_LIVE_HZ = 56;
export const RATE_LOG_HZ = 112;
export const RATE_HIGH_HZ = 224;
/** QMI8658A 6-DoF native ODR (448.4 Hz). Accel-only 500 Hz is not used. */
export const RATE_CAPTURE_HZ = 448;
export const RATE_LOG_MAX_HZ = RATE_CAPTURE_HZ;
/** uint8 wire token: 448 does not fit in 1-byte rate fields. */
export const RATE_CAPTURE_WIRE = 255;

export function rateToWire(hz) {
  return hz >= RATE_CAPTURE_HZ ? RATE_CAPTURE_WIRE : hz;
}

export function rateFromWire(wire) {
  return wire === RATE_CAPTURE_WIRE ? RATE_CAPTURE_HZ : wire;
}

export const FRAME_V1_LEN = 20;
export const FRAME_V16_LEN = 22;
export const FRAME_FUSED_LEN = 24;
export const Q15 = 32767;

export const CHANNELS = [
  { key: "ax", group: "accel", color: "#f07178", label: "Ax" },
  { key: "ay", group: "accel", color: "#3dd68c", label: "Ay" },
  { key: "az", group: "accel", color: "#5b8def", label: "Az" },
  { key: "gx", group: "gyro", color: "#f07178", label: "Gx" },
  { key: "gy", group: "gyro", color: "#3dd68c", label: "Gy" },
  { key: "gz", group: "gyro", color: "#5b8def", label: "Gz" },
  { key: "mx", group: "mag", color: "#f07178", label: "Mx" },
  { key: "my", group: "mag", color: "#3dd68c", label: "My" },
  { key: "mz", group: "mag", color: "#5b8def", label: "Mz" },
];

export const POD_COLORS = [
  "#3d9cf0",
  "#3dd68c",
  "#f0a030",
  "#f07178",
  "#c084fc",
  "#22d3ee",
];

/**
 * @param {DataView} view
 * @param {number} offset
 * @param {{accel_lsb_per_g:number,gyro_lsb_per_dps:number,mag_lsb_per_gauss:number}} meta
 */
function decodeAxes(view, offset, meta) {
  const raw = {
    ax: view.getInt16(offset + 0, true),
    ay: view.getInt16(offset + 2, true),
    az: view.getInt16(offset + 4, true),
    gx: view.getInt16(offset + 6, true),
    gy: view.getInt16(offset + 8, true),
    gz: view.getInt16(offset + 10, true),
    mx: view.getInt16(offset + 12, true),
    my: view.getInt16(offset + 14, true),
    mz: view.getInt16(offset + 16, true),
  };
  const a = meta.accel_lsb_per_g || 2048;
  const g = meta.gyro_lsb_per_dps || 16;
  const m = meta.mag_lsb_per_gauss || 3750;
  return {
    raw,
    eng: {
      ax: raw.ax / a,
      ay: raw.ay / a,
      az: raw.az / a,
      gx: raw.gx / g,
      gy: raw.gy / g,
      gz: raw.gz / g,
      mx: raw.mx / m,
      my: raw.my / m,
      mz: raw.mz / m,
    },
  };
}

/**
 * @param {DataView} view
 * @param {{accel_lsb_per_g:number,gyro_lsb_per_dps:number,mag_lsb_per_gauss:number}} meta
 */
export function decodeFrame(view, meta) {
  if (view.byteLength < FRAME_V1_LEN) {
    throw new Error(`short frame ${view.byteLength}`);
  }
  const seq = view.getUint16(0, true);
  const axes = decodeAxes(view, 2, meta);
  return {
    protocol: 1,
    seq,
    sampleIndex: seq,
    raw: axes.raw,
    eng: axes.eng,
  };
}

/**
 * @param {DataView} view
 * @param {{accel_lsb_per_g:number,gyro_lsb_per_dps:number,mag_lsb_per_gauss:number}} meta
 */
export function decodeFrameV16(view, meta) {
  if (view.byteLength < FRAME_V16_LEN) {
    throw new Error(`short v16 frame ${view.byteLength}`);
  }
  const sampleIndex = view.getUint32(0, true);
  const axes = decodeAxes(view, 4, meta);
  return {
    protocol: 2,
    seq: sampleIndex >>> 0,
    sampleIndex,
    raw: axes.raw,
    eng: axes.eng,
  };
}

/**
 * Fused 24-byte frame: sample_index + Q15 quat + accel + mag. Gyro is omitted.
 * @param {DataView} view
 * @param {{accel_lsb_per_g:number,mag_lsb_per_gauss:number}} meta
 */
export function decodeFrameFused(view, meta) {
  if (view.byteLength < FRAME_FUSED_LEN) {
    throw new Error(`short fused frame ${view.byteLength}`);
  }
  const sampleIndex = view.getUint32(0, true);
  const qw = view.getInt16(4, true) / Q15;
  const qx = view.getInt16(6, true) / Q15;
  const qy = view.getInt16(8, true) / Q15;
  const qz = view.getInt16(10, true) / Q15;
  const a = meta.accel_lsb_per_g || 2048;
  const m = meta.mag_lsb_per_gauss || 3750;
  const raw = {
    ax: view.getInt16(12, true),
    ay: view.getInt16(14, true),
    az: view.getInt16(16, true),
    gx: 0,
    gy: 0,
    gz: 0,
    mx: view.getInt16(18, true),
    my: view.getInt16(20, true),
    mz: view.getInt16(22, true),
    qw: view.getInt16(4, true),
    qx: view.getInt16(6, true),
    qy: view.getInt16(8, true),
    qz: view.getInt16(10, true),
  };
  return {
    protocol: 3,
    seq: sampleIndex >>> 0,
    sampleIndex,
    quat: { qw, qx, qy, qz },
    raw,
    eng: {
      ax: raw.ax / a,
      ay: raw.ay / a,
      az: raw.az / a,
      gx: 0,
      gy: 0,
      gz: 0,
      mx: raw.mx / m,
      my: raw.my / m,
      mz: raw.mz / m,
    },
  };
}

/**
 * Body-frame deg/s from consecutive unit quaternions (Mahony already used gyro).
 * @param {{qw:number,qx:number,qy:number,qz:number}|null} prev
 * @param {{qw:number,qx:number,qy:number,qz:number}} cur
 * @param {number} dtSec
 */
export function gyroDpsFromQuat(prev, cur, dtSec) {
  if (!prev || !(dtSec > 1e-4)) {
    return { gx: 0, gy: 0, gz: 0 };
  }
  const dq0 = (cur.qw - prev.qw) / dtSec;
  const dq1 = (cur.qx - prev.qx) / dtSec;
  const dq2 = (cur.qy - prev.qy) / dtSec;
  const dq3 = (cur.qz - prev.qz) / dtSec;
  const rad2deg = 180 / Math.PI;
  return {
    gx: (2 * (-cur.qx * dq0 + cur.qw * dq1 + cur.qz * dq2 - cur.qy * dq3)) * rad2deg,
    gy: (2 * (-cur.qy * dq0 - cur.qz * dq1 + cur.qw * dq2 + cur.qx * dq3)) * rad2deg,
    gz: (2 * (-cur.qz * dq0 + cur.qy * dq1 - cur.qx * dq2 + cur.qw * dq3)) * rad2deg,
  };
}

/** Aerospace ZYX Euler radians from a unit quaternion. */
export function eulerFromQuat(qw, qx, qy, qz) {
  const sinp = 2 * (qw * qy - qz * qx);
  return {
    roll: Math.atan2(2 * (qw * qx + qy * qz), 1 - 2 * (qx * qx + qy * qy)),
    pitch: Math.abs(sinp) >= 1 ? Math.sign(sinp) * (Math.PI / 2) : Math.asin(sinp),
    yaw: Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz)),
  };
}

/** Decode one or more packed 24-byte fused frames from a BLE notification. */
export function decodeFramesFused(view, meta) {
  if (view.byteLength < FRAME_FUSED_LEN || view.byteLength % FRAME_FUSED_LEN !== 0) {
    throw new Error(`invalid fused motion payload ${view.byteLength}`);
  }
  const frames = [];
  for (let offset = 0; offset < view.byteLength; offset += FRAME_FUSED_LEN) {
    frames.push(
      decodeFrameFused(
        new DataView(view.buffer, view.byteOffset + offset, FRAME_FUSED_LEN),
        meta
      )
    );
  }
  return frames;
}

/** Decode one or more packed 20-byte frames from a BLE notification. */
export function decodeFrames(view, meta) {
  if (view.byteLength < FRAME_V1_LEN || view.byteLength % FRAME_V1_LEN !== 0) {
    throw new Error(`invalid motion payload ${view.byteLength}`);
  }
  const frames = [];
  for (let offset = 0; offset < view.byteLength; offset += FRAME_V1_LEN) {
    frames.push(
      decodeFrame(
        new DataView(view.buffer, view.byteOffset + offset, FRAME_V1_LEN),
        meta
      )
    );
  }
  return frames;
}

/** Decode one or more packed 22-byte v16 frames from a BLE notification. */
export function decodeFramesV16(view, meta) {
  if (view.byteLength < FRAME_V16_LEN || view.byteLength % FRAME_V16_LEN !== 0) {
    throw new Error(`invalid v16 motion payload ${view.byteLength}`);
  }
  const frames = [];
  for (let offset = 0; offset < view.byteLength; offset += FRAME_V16_LEN) {
    frames.push(
      decodeFrameV16(
        new DataView(view.buffer, view.byteOffset + offset, FRAME_V16_LEN),
        meta
      )
    );
  }
  return frames;
}

/**
 * Track logical sample index across 16-bit wraps and count missing samples.
 */
export class SequenceTracker {
  constructor({ bits = 32 } = {}) {
    this.bits = bits;
    this.mask = bits >= 32 ? 0xffffffff : (1 << bits) - 1;
    this.lastWire = null;
    this.logical = null;
    this.gapEvents = 0;
    this.missingFrames = 0;
  }

  /**
   * @param {number} wireSeq
   * @returns {{logical:number, missing:number, gapEvent:boolean}}
   */
  observe(wireSeq) {
    const seq = wireSeq >>> 0;
    if (this.lastWire === null) {
      this.lastWire = seq;
      this.logical = seq;
      return { logical: this.logical, missing: 0, gapEvent: false };
    }
    let delta = (seq - this.lastWire) & this.mask;
    if (delta === 0) {
      return { logical: this.logical, missing: 0, gapEvent: false };
    }
    /* Guard against huge backwards jumps being treated as forward wraps. */
    if (delta > this.mask / 2) {
      delta = 0;
    }
    const missing = Math.max(0, delta - 1);
    if (missing > 0) {
      this.gapEvents += 1;
      this.missingFrames += missing;
    }
    this.logical = (this.logical + delta) >>> 0;
    this.lastWire = seq;
    return { logical: this.logical, missing, gapEvent: missing > 0 };
  }

  /**
   * Re-baseline without counting a gap. Used after intentional stream holds
   * (e.g. peer pod connect) so lifetime health is not permanently degraded.
   * @param {number} [wireSeq]
   */
  rebase(wireSeq) {
    if (wireSeq == null) {
      this.lastWire = null;
      this.logical = null;
    } else {
      const seq = wireSeq >>> 0;
      this.lastWire = seq;
      this.logical = seq;
    }
    this.gapEvents = 0;
    this.missingFrames = 0;
  }
}

/** @param {DataView} view */
export function decodeMeta(view) {
  if (view.byteLength < 12) {
    throw new Error(`short meta ${view.byteLength}`);
  }
  return {
    ver: view.getUint8(0),
    rate_hz: rateFromWire(view.getUint8(1)),
    accel_lsb_per_g: view.getUint16(2, true),
    gyro_lsb_per_dps: view.getUint16(4, true),
    mag_lsb_per_gauss: view.getUint16(6, true),
    flags: view.getUint16(8, true),
    reserved: view.getUint16(10, true),
  };
}

/** @param {DataView} view */
export function decodeCfgInfo(view) {
  if (view.byteLength < 4) {
    throw new Error(`short cfg info ${view.byteLength}`);
  }
  return {
    mode: view.getUint8(0),
    podId: view.getUint16(1, true),
    hasCustomName: (view.getUint8(3) & 0x01) !== 0,
  };
}

/** @param {DataView} view */
export function decodeCaps(view) {
  if (view.byteLength < 20) {
    throw new Error(`short caps ${view.byteLength}`);
  }
  const featureFlags = view.getUint8(1);
  const rateMask = view.getUint8(2);
  return {
    ver: view.getUint8(0),
    featureFlags,
    rateMask,
    maxBatchFrames: view.getUint8(3),
    maxRateHz: rateFromWire(view.getUint8(4)),
    imuRateHz: rateFromWire(view.getUint8(5)),
    magRateHz: view.getUint8(6),
    attMtu: view.getUint16(8, true),
    queueDepthMax: view.getUint16(10, true),
    firmwareProto: view.getUint16(12, true),
    supportsV16: (featureFlags & CAP_FLAG_V16_FRAME) !== 0,
    supportsDrain: (featureFlags & CAP_FLAG_DRAIN_BARRIER) !== 0,
    supports32bitSeq: (featureFlags & CAP_FLAG_32BIT_SEQ) !== 0,
    supportsFused: (featureFlags & CAP_FLAG_FUSED_FRAME) !== 0,
    rates: {
      56: (rateMask & 0x01) !== 0,
      112: (rateMask & 0x02) !== 0,
      224: (rateMask & 0x04) !== 0,
      448: (rateMask & 0x08) !== 0,
    },
  };
}

/** @param {DataView} view */
export function decodeSyncRsp(view) {
  if (view.byteLength < 20) {
    throw new Error(`short sync rsp ${view.byteLength}`);
  }
  const clientMs = Number(view.getBigUint64(0, true));
  const deviceUs = Number(view.getBigUint64(8, true));
  /* Bytes 16-19: uint32 sample_index. Old firmware wrote uint16 seq + pad 0. */
  const seq = view.getUint32(16, true);
  return { clientMs, deviceUs, seq, seq16: seq & 0xffff };
}

/** @param {DataView} view */
export function decodeBatt(view) {
  if (view.byteLength < 4) {
    throw new Error(`short batt ${view.byteLength}`);
  }
  const millivolts = view.getUint16(0, true);
  const percent = view.getUint8(2);
  const flags = view.getUint8(3);
  return {
    millivolts,
    percent,
    valid: (flags & BATT_FLAG_VALID) !== 0,
  };
}

export function encodeSessionCommand(command, captureId, rateHz = 0, flags = 0) {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, 1);
  view.setUint8(1, command);
  view.setUint8(2, rateToWire(rateHz));
  view.setUint8(3, flags);
  view.setUint32(4, captureId >>> 0, true);
  return bytes;
}

export function encodeSessionCommandV16(
  command,
  captureId,
  rateHz = 0,
  flags = 0,
  commandId = 1
) {
  const bytes = new Uint8Array(12);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, 2);
  view.setUint8(1, command);
  view.setUint8(2, rateToWire(rateHz));
  view.setUint8(3, flags);
  view.setUint32(4, captureId >>> 0, true);
  view.setUint16(8, commandId & 0xffff, true);
  view.setUint16(10, 0, true);
  return bytes;
}

export function decodeSessionStatus(view) {
  if (view.byteLength < 36) {
    throw new Error(`short session status ${view.byteLength}`);
  }
  const state = view.getUint8(1);
  const flags = view.getUint8(3);
  return {
    protocol: 1,
    ver: view.getUint8(0),
    state,
    stateName: SESSION_STATES[state] || "unknown",
    rateHz: rateFromWire(view.getUint8(2)),
    requestedRateHz: rateFromWire(view.getUint8(2)),
    appliedRateHz: rateFromWire(view.getUint8(2)),
    flags,
    captureId: view.getUint32(4, true),
    rateEpoch: view.getUint16(8, true),
    firstSeq: view.getUint16(10, true),
    lastSeq: view.getUint16(12, true),
    firstSample: view.getUint16(10, true),
    lastProduced: view.getUint16(12, true),
    lastSent: view.getUint16(12, true),
    finalSample: 0,
    queueDepth: view.getUint16(14, true),
    queueHighWater: view.getUint16(14, true),
    sensorDropped: view.getUint32(16, true),
    transportDropped: view.getUint32(20, true),
    notifyFailures: view.getUint32(24, true),
    uptimeMs: view.getUint32(28, true),
    batteryMv: view.getUint16(32, true),
    batteryPercent: view.getUint8(34),
    batteryValid: (flags & SESSION_FLAG_BATT_VALID) !== 0,
    hasSamples: (flags & SESSION_FLAG_HAS_SAMPLES) !== 0,
    drainDone: (flags & SESSION_FLAG_DRAIN_DONE) !== 0,
    rateApplied: (flags & SESSION_FLAG_RATE_APPLIED) !== 0,
    errorReason: 0,
    errorName: "none",
    lastCommandId: 0,
    attMtu: 0,
    magRateHz: 0,
  };
}

export function decodeSessionStatusV16(view) {
  if (view.byteLength < 56) {
    throw new Error(`short session status v16 ${view.byteLength}`);
  }
  const state = view.getUint8(1);
  const flags = view.getUint8(4);
  const errorReason = view.getUint8(5);
  return {
    protocol: 2,
    ver: view.getUint8(0),
    state,
    stateName: SESSION_STATES[state] || "unknown",
    requestedRateHz: rateFromWire(view.getUint8(2)),
    appliedRateHz: rateFromWire(view.getUint8(3)),
    rateHz: rateFromWire(view.getUint8(3)),
    flags,
    errorReason,
    errorName: ERROR_REASONS[errorReason] || "unknown",
    lastCommandId: view.getUint16(6, true),
    captureId: view.getUint32(8, true),
    rateEpoch: view.getUint16(12, true),
    attMtu: view.getUint16(14, true),
    firstSample: view.getUint32(16, true),
    lastProduced: view.getUint32(20, true),
    lastSent: view.getUint32(24, true),
    finalSample: view.getUint32(28, true),
    firstSeq: view.getUint32(16, true),
    lastSeq: view.getUint32(20, true),
    queueDepth: view.getUint16(32, true),
    queueHighWater: view.getUint16(34, true),
    sensorDropped: view.getUint32(36, true),
    transportDropped: view.getUint32(40, true),
    notifyFailures: view.getUint32(44, true),
    uptimeMs: view.getUint32(48, true),
    batteryMv: view.getUint16(52, true),
    batteryPercent: view.getUint8(54),
    magRateHz: view.getUint8(55),
    batteryValid: (flags & SESSION_FLAG_BATT_VALID) !== 0,
    hasSamples: (flags & SESSION_FLAG_HAS_SAMPLES) !== 0,
    drainDone: (flags & SESSION_FLAG_DRAIN_DONE) !== 0,
    rateApplied: (flags & SESSION_FLAG_RATE_APPLIED) !== 0,
  };
}

/**
 * Preflight whether a capture rate is likely safe for the current link.
 * @param {{attMtu?:number,maxBatchFrames?:number,supportsV16?:boolean}} caps
 * @param {number} rateHz
 * @param {number} podCount
 */
export function capturePreflight(caps, rateHz, podCount = 1) {
  const warnings = [];
  const mtu = caps?.attMtu || 23;
  const frameLen = caps?.supportsFused
    ? FRAME_FUSED_LEN
    : caps?.supportsV16
      ? FRAME_V16_LEN
      : FRAME_V1_LEN;
  const payload = Math.max(0, mtu - 3);
  const maxBatch = caps?.maxBatchFrames || 1;
  const highRateCap = rateHz >= RATE_HIGH_HZ ? (caps?.supportsFused ? 4 : 2) : maxBatch;
  const batch = Math.max(
    1,
    Math.min(maxBatch, highRateCap, Math.floor(payload / frameLen) || 1)
  );
  const notifyHz = rateHz / batch;
  if (payload < frameLen) {
    warnings.push(`ATT MTU ${mtu} cannot carry a ${frameLen}-byte frame`);
  }
  if (rateHz >= RATE_HIGH_HZ && podCount > 1) {
    warnings.push(`${rateHz} Hz is only recommended for a single pod`);
  }
  if (rateHz >= 112 && batch < 2) {
    warnings.push(`low batching (${batch} frame/notify) at ${rateHz} Hz may drop samples`);
  }
  if (notifyHz > 120) {
    warnings.push(`estimated notify rate ~${Math.round(notifyHz)} Hz may stress the link`);
  }
  return {
    ok: warnings.length === 0,
    warnings,
    frameLen,
    batch,
    notifyHz,
    payload,
  };
}
