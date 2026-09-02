/**
 * Boat class, stroke-side / bow-side, and port/starboard for RowPod.
 *
 * Stroke-side is the gunwale the stroke's oar sits on. Bow-side is the other.
 * That is not "catch toward the bow" — catch/finish are the sweep in the
 * horizontal plane; hand is which oar.
 *
 * Port/starboard follow the global "Stroke sits" control so a standard-rig
 * eight (stroke on starboard) and an opposite-rig boat both map correctly.
 */

export const HAND_STROKE = "stroke";
export const HAND_BOW = "bow";

export const BOAT_CLASSES = {
  "2x": {
    id: "2x",
    kind: "scull",
    label: "2x  double",
    seats: ["stroke", "bow"],
  },
  "2-": {
    id: "2-",
    kind: "sweep",
    label: "2−  pair",
    seats: ["stroke", "bow"],
  },
  "2+": {
    id: "2+",
    kind: "sweep",
    label: "2+  coxed pair",
    seats: ["stroke", "bow"],
  },
  "4x": {
    id: "4x",
    kind: "scull",
    label: "4x  quad",
    seats: ["stroke", "3", "2", "bow"],
  },
  "4-": {
    id: "4-",
    kind: "sweep",
    label: "4−  four",
    seats: ["stroke", "3", "2", "bow"],
  },
  "4+": {
    id: "4+",
    kind: "sweep",
    label: "4+  coxed four",
    seats: ["stroke", "3", "2", "bow"],
  },
  "4x+": {
    id: "4x+",
    kind: "scull",
    label: "4x+ coxed quad",
    seats: ["stroke", "3", "2", "bow"],
  },
  "8+": {
    id: "8+",
    kind: "sweep",
    label: "8+  eight",
    seats: ["stroke", "7", "6", "5", "4", "3", "2", "bow"],
  },
};

export const BOAT_CLASS_ORDER = ["2x", "2-", "2+", "4x", "4-", "4+", "4x+", "8+"];

const RIG_STORE_KEY = "rowpod_rig_v1";

export function getBoatClass(id) {
  return BOAT_CLASSES[id] || BOAT_CLASSES["8+"];
}

export function seatInBoat(boatClassId, seat) {
  return getBoatClass(boatClassId).seats.includes(seat);
}

/**
 * Sweep: stroke, 6, 4, 2 are stroke-side; 7, 5, 3, bow are bow-side.
 * Scull: each seat has both blades — default stroke-side (same gunwale)
 * so two scullers overlay without an extra invert unless the coach picks
 * the other blade.
 */
export function defaultHandForSeat(boatClassId, seat) {
  const boat = getBoatClass(boatClassId);
  const i = boat.seats.indexOf(seat);
  if (i < 0) return HAND_STROKE;
  if (boat.kind === "scull") return HAND_STROKE;
  return i % 2 === 0 ? HAND_STROKE : HAND_BOW;
}

/** @param {"stroke"|"bow"} hand @param {"port"|"starboard"} strokeSits */
export function portStarboardFromHand(hand, strokeSits) {
  const strokeSide = strokeSits === "port" ? "port" : "starboard";
  const bowSide = strokeSide === "port" ? "starboard" : "port";
  return hand === HAND_BOW ? bowSide : strokeSide;
}

export function loadRig() {
  try {
    const raw = JSON.parse(localStorage.getItem(RIG_STORE_KEY) || "{}");
    const boatClass = BOAT_CLASSES[raw.boatClass] ? raw.boatClass : "8+";
    const strokeSits = raw.strokeSits === "port" ? "port" : "starboard";
    return { boatClass, strokeSits };
  } catch {
    return { boatClass: "8+", strokeSits: "starboard" };
  }
}

export function saveRig(rig) {
  localStorage.setItem(
    RIG_STORE_KEY,
    JSON.stringify({
      boatClass: getBoatClass(rig.boatClass).id,
      strokeSits: rig.strokeSits === "port" ? "port" : "starboard",
    })
  );
}
