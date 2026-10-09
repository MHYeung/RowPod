# IMU lab dashboard (host architecture)

Portrait **RowPod** is the Pages root. This file is the **IMU lab**
(`lab.html`): plots, orientation cube, HYROX, session CSV, mag-cal, battery
status log. Do not fold those surfaces into the towpath PWA.

Hosting: [`DASHBOARD_PAGES.md`](DASHBOARD_PAGES.md). Capture wire protocol:
[`SESSION_PROTOCOL.md`](SESSION_PROTOCOL.md). Trajectory reconstruction:
[`TRAJECTORY_CAPTURE.md`](TRAJECTORY_CAPTURE.md).

## Two hosts, two cache schemes

| Host | Entry | Cache-bust | Service worker |
|------|-------|------------|----------------|
| RowPod 1.4.4 | `index.html?v=1.4.4` | query + `sw.js` cache `rowpod-1.4.4` | Yes (`rowpod.js` registers it) |
| IMU lab 16.8 | `lab.html?v=16.8` | query on `styles.css` and `app.js` only | **No** |

They do not share a token. After 1.4.4, `/?v=16.8` is still RowPod. Open
`lab.html?v=16.8`. `app.js` throws if the HTML is missing lab controls
(`captureIntegrity`, mag-cal, HYROX, battery test) — hard-refresh
(Ctrl+Shift+R). Installed PWAs only apply to RowPod; delete and re-add when
the cache name changes.

GitHub Actions deploys **only** `web/ble_plotter/` on pushes to `main` under
that path (or workflow_dispatch). Firmware-only commits do not refresh Pages.

## File map

| File | Role |
|------|------|
| `lab.html` / `app.js` | Lab shell, tabs, capture / HYROX / mag-cal / battery-test UI |
| `ble_client.js` | One GATT connection; serialized writes; motion CCCD choice |
| `pod_registry.js` | Multi-pod sessions, labels, seats, sync, soft-hold on Add pod |
| `protocol.js` | UUIDs, pack/unpack, capture preflight |
| `timebase.js` | `sample_index` unwrap / host-ms fit (RowPod also uses this) |
| `csv_log.js` | Motion CSV v7 ring (120k rows) |
| `status_log.js` | Low-rate endurance CSV (Battery test tab) |
| `hyrox.js` | Host-only station detector |
| `mag_calibration.js` | Browser hard-iron; `localStorage` `c3_mag_calibration_v1` |
| `outlier_filter.js` | Display/HYROX rail guard only (`|raw| ≥ 32760`) |
| `plot.js` / `orientation.js` | Overlay plots and cube |

RowPod-only: `rowpod.js`, `rowing_*.js`, `boat_rig.js`, `version.js`, `sw.js`.

Unit tests (no browser): `node web/ble_plotter/protocol.test.js`.

## Connect

`requestDevice` OR-filters: motion service UUID, `C3-Tracker*`, `C3-T-*`.
The motion UUID is in the **advertising** payload; the local name is in the
**scan response**. A renamed pod (e.g. `stroke`) still matches the service
filter. Name charset on the pod: A–Z, a–z, 0–9, space, `-`, `_`, max 20
(NVS namespace `pod`, keys `pod_id` / `name`). Empty write restores
`C3-T-XXXX` from the stored 16-bit id (BT MAC bytes 4–5).

GATT operations on one client run on a promise queue. Adding a second pod
**soft-holds** existing links: CCCD stays on so firmware keeps sampling;
gap counters pause. A hard `stopNotifications` used to freeze the first pod
with a permanent sequence hole.

Motion CCCD (lab does **not** set `preferRawGyro`):

| Condition | Subscribe |
|-----------|-----------|
| caps fused + ATT MTU ≥ 27 | `…1004` fused (lab default) |
| else caps v16 + MTU ≥ 25 | `…1003` v16 |
| else | `…1001` v1 |

RowPod passes `preferRawGyro: true` and stays on v16. Differentiating fused
quats is not raw gyro.

Windows/Chrome often leave ATT MTU at **23**. Status integrity then shows
`MTU 23 → motion v1`. Preflight warns before high-rate start.

## Capture workflow (`app.js`)

Live monitor is always **56 Hz**. Start (CSV log or HYROX) picks:

- **1 pod → 448 Hz**
- **2+ pods → 112 Hz**

Policy is “max rate over zero-loss”; sparse gaps are accepted. Sequence:

1. Preflight (`capturePreflight`) — confirm or abort.
2. `PREPARE` with a random `capture_id` and the log rate; every pod must
   report `prepared` and that rate.
3. Logger `start` (host phase `bias_start`, 2 s stillness).
4. `START` → pod `recording`.
5. After 2 s, host phase becomes `motion` (accel `|‖a‖−1| ≤ 0.08 g` stamps
   `stationary` on each row; it is not a capture gate).
6. Stop: `STOP` **first**, then 2 s end stillness, then `DRAIN` (8 s poll),
   then `FINALIZE`. Restore 56 Hz (and profile 0 after HYROX).

STOP is write-without-response so control still lands under notify load.
The host waits for the STOP ack **before** labeling `bias_end` — a hung
Write Request at 2 pods @ 112 Hz used to leave the UI in `stop_requested`
while firmware kept recording.

Failure path: `ABORT` best-effort; do not claim finalize.

Plots downsample to ~56 Hz (`keepEvery = round(deviceHz / 56)`) so 448 Hz
capture does not melt the canvas. The CSV ring stores every accepted sample
until 120k rows, then overwrites the oldest (`dropped` counter).

## What the motion CSV is (v7)

Same logger for CSV log and HYROX. Header `# C3-Tracker CSV v7`. Rows:

`position,device_id,pod_id,rate_hz,sample_index,sample_ms,arrival_ms,capture_phase,stationary,qw..qz,ax_g..az_g,mx_G..mz_G,missing_frames,gap_events,sensor_dropped,transport_dropped,notify_failures`

- Quats are **on-device Mahony**. Gyro is omitted (fused path).
- Mag-cal is stamped in the header (`# podN_mag_cal=`) and applied to the
  cube **fallback** only. CSV `mx_G` is the vector Mahony consumed.
- HYROX header also stamps `# training_profile=1;station=…`. Candidate
  reps are **not** columns.
- `outlier_filter.js` cleans rails for plots/HYROX display; `logger.push`
  uses the original `frame`.

## HYROX detector (host-only)

Firmware profile `1` selects the high-rate capture policy. Reps and
work/rest are estimated in `hyrox.js`. On the lab fused path, `eng.gx..gz`
is **Mahony-differentiated** (`gyroDpsFromQuat` in `ble_client.js`), not
raw ω — fine for intensity, not for oar angle.

```
signal = clamp((‖gyro_dps‖ / 180 + |‖accel_g‖ − 1| / 0.6) / 2, 0, 1.5)
```

A candidate rep is a rising edge through `threshold` after `refractoryMs`.
Stations with `rep: false` only contribute work time.

| Station key | Label | Rep? | Threshold | Refractory |
|-------------|-------|------|-----------|------------|
| `run` | Run | no | 0.55 | 0 |
| `ski` | SkiErg | yes | 0.75 | 450 ms |
| `sled_push` | Sled push | no | 0.65 | 0 |
| `sled_pull` | Sled pull | yes | 0.75 | 500 ms |
| `burpee` | Burpee broad jump | yes | 0.80 | 900 ms |
| `row` | Row | yes | 0.65 | 650 ms |
| `carry` | Farmers carry | no | 0.45 | 0 |
| `lunge` | Sandbag lunges | yes | 0.60 | 650 ms |
| `wall_ball` | Wall balls | yes | 0.65 | 550 ms |

Defaults are unvalidated. Tune from counted sets; see
[`HYROX_TRAINING.md`](HYROX_TRAINING.md).

## Browser storage (not firmware)

| Key | Purpose |
|-----|---------|
| `c3_pod_labels_v1` | Rename / position strings |
| `c3_pod_seats_v1` | RowPod seat assignments |
| `c3_mag_calibration_v1` | Mag offsets/scales per device id |
| `rowpod_rig_v1` | Boat class / Stroke sits / spans |

Clearing site data drops mag-cal and names; pods still advertise `C3-T-XXXX`
until you rewrite NVS.

## Sync

`…2003` every 4 s. Lab overlay timestamps use the software offset for CSV
`arrival_ms` diagnostics; `sample_ms` is `sample_index` / log rate from the
first sample of that capture. It is not IMU phase lock. RowPod fits
`hostMs = a * sampleIndex + b` instead — [`ROWING_SYNC.md`](ROWING_SYNC.md).
