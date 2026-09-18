/**
 * Drive arc and blade arc length for RowPod 1.4.3.
 *
 * Blade metres are outboard * θ_rad about the pin. That is oar arc, not
 * distance through the water (the hull is moving). Inboard is stored for
 * the CSV header; it does not scale the live length.
 */

export const SPAN_SWEEP = { inboardM: 1.15, outboardM: 2.61 };
export const SPAN_SCULL = { inboardM: 0.88, outboardM: 2.00 };

export function defaultSpansForKind(kind) {
  return kind === "scull" ? { ...SPAN_SCULL } : { ...SPAN_SWEEP };
}

export function driveArcDeg(catchTheta, finishTheta) {
  if (!Number.isFinite(catchTheta) || !Number.isFinite(finishTheta)) return null;
  return finishTheta - catchTheta;
}

export function bladeArcM(arcDeg, outboardM) {
  if (!Number.isFinite(arcDeg) || !Number.isFinite(outboardM) || outboardM <= 0) {
    return null;
  }
  return (arcDeg * Math.PI / 180) * outboardM;
}

/** Coach-typed centimetres → metres, with a sane fallback. */
export function spanCmToM(cm, fallbackM) {
  const n = Number(cm);
  if (!Number.isFinite(n) || n <= 0 || n > 800) return fallbackM;
  return n / 100;
}
