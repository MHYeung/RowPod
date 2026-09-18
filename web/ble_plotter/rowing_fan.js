/**
 * RowPod fan overlay geometry.
 *
 * Oar 0° is perpendicular (up on the canvas). Catch (negative) is left toward
 * the bow; finish (positive) is right toward the stern. Canvas `arc()` angles
 * increase clockwise, so catch → finish through 0° is counterclockwise=false.
 * counterclockwise=true takes the long way through the unused bottom half.
 */

export const FAN_MIN_DEG = -90;
export const FAN_MAX_DEG = 90;
/** Canvas `arc` counterclockwise flag for the upper 180° (catch → finish). */
export const FAN_ARC_CCW = false;

export function clampFanDeg(deg) {
  const n = Number(deg);
  if (!Number.isFinite(n)) return 0;
  return Math.max(FAN_MIN_DEG, Math.min(FAN_MAX_DEG, n));
}

export function oarToCanvasRad(deg) {
  return (clampFanDeg(deg) * Math.PI) / 180 - Math.PI / 2;
}

export function oarToXY(deg, radius, cx, cy) {
  const rad = (clampFanDeg(deg) * Math.PI) / 180;
  return {
    x: cx + radius * Math.sin(rad),
    y: cy - radius * Math.cos(rad),
  };
}

export function seatLaneRadius(index, count, r) {
  const n = Math.max(count, 1);
  const outer = r * 0.8;
  const inner = r * 0.44;
  if (n === 1) return (outer + inner) / 2;
  return outer - (index * (outer - inner)) / (n - 1);
}
