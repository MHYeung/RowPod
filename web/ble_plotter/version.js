/**
 * RowPod semver. Major (v2) is a human decision.
 *
 * 1.0.0  First portrait PWA (oar angle + crew sync).
 * 1.0.1  Stop integrating Mahony-differentiated gyro (yaw vs Zero).
 * 1.1.0  Prefer v16 raw gyro · g; stroke-midpoint lock; confidence chip.
 * 1.2.0  Smooth DC (no finish jump); catch/finish state machine; blade feather.
 * 1.3.0  Boat class 2x–8+; per-seat stroke-side / bow-side; overlay sign from rig.
 * 1.4.0  Honest Crew Clock: forward match, in-sync only with two complete seats.
 * 1.4.1  180° fan; thick per-seat bars; larger catch/finish numbers.
 * 1.4.2  Live catch late/early vs stroke (does not wait for a finish).
 * 1.4.3  Drive arc + blade metres; gated feather-on Δt vs stroke after finish.
 * 1.4.4  Pages root is RowPod; IMU lab parked at lab.html.
 * 1.4.5  Light theme refresh, fan motion, in-place coach table, six-pod layout.
 * 1.5.0  Connect and go: first stroke centres the fan. Zero is measured-only.
 * 1.5.1  Per-stroke SPM. Gyro-propagated gravity, bias estimate, stroke gates.
 *        Drive index is unitless, not watts.
 * 1.5.2  Live motion uses the host ATT MTU. A pod-only 247 no longer selects
 *        a frame Windows drops, which left other seats with no stroke.
 * 1.5.3  Connect skips the 2 s MTU poll when the host hint cannot raise it.
 *        Shared client counts motion packets for the lab's batch probe.
 */
export const ROWPOD_VERSION = "1.5.3";
