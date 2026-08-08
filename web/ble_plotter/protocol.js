/** Motion service UUIDs (must match firmware sensor_protocol). */
export const MOTION_SVC = "9b7e1000-2b2f-4f71-9b86-4bb2e6d54f00";
export const MOTION_DATA = "9b7e1001-2b2f-4f71-9b86-4bb2e6d54f00";
export const MOTION_META = "9b7e1002-2b2f-4f71-9b86-4bb2e6d54f00";

/** Pod configuration / software-sync service. */
export const CFG_SVC = "9b7e2000-2b2f-4f71-9b86-4bb2e6d54f00";
export const CFG_INFO = "9b7e2001-2b2f-4f71-9b86-4bb2e6d54f00";
export const CFG_NAME = "9b7e2002-2b2f-4f71-9b86-4bb2e6d54f00";
export const CFG_SYNC = "9b7e2003-2b2f-4f71-9b86-4bb2e6d54f00";
export const CFG_BATT = "9b7e2004-2b2f-4f71-9b86-4bb2e6d54f00";

export const FLAG_MULTI = 0x0001;
export const BATT_FLAG_VALID = 0x01;

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
 * @param {{accel_lsb_per_g:number,gyro_lsb_per_dps:number,mag_lsb_per_gauss:number}} meta
 */
export function decodeFrame(view, meta) {
  if (view.byteLength < 20) {
    throw new Error(`short frame ${view.byteLength}`);
  }
  const seq = view.getUint16(0, true);
  const raw = {
    ax: view.getInt16(2, true),
    ay: view.getInt16(4, true),
    az: view.getInt16(6, true),
    gx: view.getInt16(8, true),
    gy: view.getInt16(10, true),
    gz: view.getInt16(12, true),
    mx: view.getInt16(14, true),
    my: view.getInt16(16, true),
    mz: view.getInt16(18, true),
  };
  const a = meta.accel_lsb_per_g || 4096;
  const g = meta.gyro_lsb_per_dps || 64;
  const m = meta.mag_lsb_per_gauss || 1000;
  return {
    seq,
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

/** @param {DataView} view */
export function decodeMeta(view) {
  if (view.byteLength < 12) {
    throw new Error(`short meta ${view.byteLength}`);
  }
  return {
    ver: view.getUint8(0),
    rate_hz: view.getUint8(1),
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
export function decodeSyncRsp(view) {
  if (view.byteLength < 20) {
    throw new Error(`short sync rsp ${view.byteLength}`);
  }
  const clientMs = Number(view.getBigUint64(0, true));
  const deviceUs = Number(view.getBigUint64(8, true));
  const seq = view.getUint16(16, true);
  return { clientMs, deviceUs, seq };
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
