/** Motion service UUIDs (must match firmware sensor_protocol). */
export const MOTION_SVC = "9b7e1000-2b2f-4f71-9b86-4bb2e6d54f00";
export const MOTION_DATA = "9b7e1001-2b2f-4f71-9b86-4bb2e6d54f00";
export const MOTION_META = "9b7e1002-2b2f-4f71-9b86-4bb2e6d54f00";

/** Nordic LBS */
export const LBS_SVC = "00001523-1212-efde-1523-785feabcd123";
export const LBS_LED = "00001525-1212-efde-1523-785feabcd123";

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
