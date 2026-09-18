# V16 BLE throughput and drain test

Repeatable procedure for validating additive protocol v16 capture integrity.
Pair this with an external current logger when assessing energy use.

## Goals

- Confirm 32-bit sample indexing across a wrap longer than the legacy 16-bit
  sequence (more than 4 minutes 53 seconds at 224 Hz).
- Confirm `DRAIN` freezes the transport boundary and `FINALIZE` is rejected
  until `drain_done` is set with an empty queue.
- Measure drop counters and missing-frame counts under 1–4 pods and
  56 / 112 / 224 Hz.
- Record negotiated ATT MTU and observe preflight warnings on small MTUs.

## Equipment

- One to four flashed v16 pods.
- Chrome or Edge on HTTPS / localhost IMU lab `lab.html?v=16.8`.
- Optional: BLE sniffer or phone that forces a small ATT MTU.

## Cases

| Case | Pods | Rate | Duration | Pass criteria |
|------|------|------|----------|---------------|
| A | 1 | 56 Hz | 2 min | missing≈0, transport_dropped=0 |
| B | 1 | 224 Hz | ≥5 min | no sample_ms rollback; missing matches sensor+transport drops |
| C | 2–4 | 112 Hz | 3 min | preflight may warn; document gaps vs drops |
| D | 1 | 224 Hz | stop mid-burst | stop → drain wait → finalize only after drain_done |
| E | 1 | any | disconnect during capture | host aborts; no false finalized claim |

## Procedure

1. Flash firmware and hard-refresh the IMU lab (`lab.html?v=16.8`).
2. Add the required pods. Confirm Summary → Capture integrity shows
   `proto v2`, applied rate, MTU, and queue counters.
3. Start a status log on the Battery test tab (60 s interval).
4. Run the capture case from the CSV log or HYROX tab.
5. On Stop, watch integrity for `drain✓` before the live rate restores.
6. Download motion CSV v7 and status CSV v3.

## Forced-fault hooks

- Pause another radio-heavy app or walk far enough to induce notify failures;
  `notify_failures` and `missing_frames` should rise together.
- For small-MTU hosts, confirm preflight warns before 224 Hz start.
- Button-pause on the pod during DRAIN should still allow queue flush or
  surface a drain timeout rather than a silent finalize.

## Record

- Firmware hash / build, dashboard `?v=16`, browser, OS.
- Per case: MTU, observed Hz, gaps, missing frames, sensor/transport drops,
  notify failures, queue high-water, drain wait duration.
- Whether FINALIZE succeeded only after `drain_done`.

Hardware-only checks that cannot run in CI are cases B–E above.
