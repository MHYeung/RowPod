# Short arm-stroke trajectory capture

This setup targets relative 3D shape over a 1–3 second arm stroke. It does not
turn a single IMU into an absolute room-position sensor. Magnetometer data
constrains heading; it does not observe translation.

Lab-only. RowPod (`/?v=1.4.4`) does not run this pipeline.

## Before collecting data

1. Flash the current firmware and open the IMU lab (`/lab.html?v=16.8`, HTTPS
   or `localhost`).
2. Connect **one** pod and select **Calibrate mag (30 s)**.
3. Move the assembled pod in a slow figure-8 and tumble it through
   nose-down / tail-down / each side-down. Flat table spins leave one axis
   uncovered. Stay away from steel, loudspeakers, motors, charging cables,
   and the laptop. Watch the live X/Y/Z coverage until each axis shows ✓.
4. Mount the pod rigidly on the hand or forearm. Do not let it move inside a
   loose palm grip.

Recalibrate after changing the enclosure, battery position, mounting hardware,
or test room.

### Mag calibration (host, not firmware)

`web/ble_plotter/mag_calibration.js` fits a per-axis hard-iron offset and
scale into **browser `localStorage`** (`c3_mag_calibration_v1`), keyed by the
Web Bluetooth device id. It does **not** write NVS, change Mahony, or rewrite
CSV `mx_G` / `my_G` / `mz_G` rows. Those columns stay the vector the fused
frame (or v16 mag) actually carried.

The 30 s button is a timer, not a sample counter. Finish still requires:

| Gate | Value | Why |
|------|-------|-----|
| Samples | ≥ **400** | Keep the pod connected and streaming |
| Half-range per axis | ≥ **0.12 G** | Earth field is ~0.3–0.5 G; table yaw never covers Z |
| Motion | figure-8 + tumble | Nose / tail / each side down |

A successful cal is stamped in the CSV header as `# podN_mag_cal=offset:…`.
`tools/reconstruct_trajectory.py` refuses the file unless that comment is
present (unless `--allow-untrusted`).

Cube attitude uses the cal **only** when the selected pod has no fused
quaternion. Plots and the v7 logger always consume the uncalibrated `eng`
vector.

## Capture protocol

1. Press **Start** and remain completely still for the indicated two seconds.
2. Perform one short stroke. Keep the total capture below eight seconds.
3. Press **Stop**, then remain still for the final two seconds.
4. Download the CSV. A valid v7 file contains `bias_start`, `motion`, and
   `bias_end` phases, on-device Mahony `qw..qz`, body accel, and the magnetometer
   vector Mahony consumed. Integrity counters stay in-row; raw/clean/cal
   duplicates do not.

The firmware uses native 56/112/224/448 Hz sensor-clock profiles, ±16 g, ±2048 dps,
400 kHz I2C, DRDY loss accounting, and BLE packet batching. Single-pod logging
selects 448 Hz 6-DoF (not accel-only 500 Hz) with 100 Hz magnetometer; coalesced
acquisition events still advance `sample_index` so quality checks can detect
them. Two or more connected pods drop the lab log rate to 112 Hz.

The browser ring holds **120 000** rows (~6 min at 448 Hz, or ~4 min at
4×112 Hz). Overflow drops the oldest samples and increments the logger's
dropped counter. Do not treat a wrap as a complete stroke.

`stationary` is a host flag: `abs(|accel| − 1) ≤ 0.08 g`. Fused CSV has no
raw gyro, so stillness is accel-only.

## CSV v7 columns

Comment header, then:

```
position,device_id,pod_id,rate_hz,sample_index,sample_ms,arrival_ms,
capture_phase,stationary,qw,qx,qy,qz,ax_g,ay_g,az_g,mx_G,my_G,mz_G,
missing_frames,gap_events,sensor_dropped,transport_dropped,notify_failures
```

| Field | Source |
|-------|--------|
| `sample_ms` | `(sample_index − first) × 1000 / rate_hz` |
| `arrival_ms` | `performance.now()` since Start (browser latency, not IMU phase) |
| `qw..qz` | On-device Mahony, unit quaternion (empty if the host never got fused) |
| `ax..az` | Body accel in g |
| `mx..mz` | Mag in gauss **as streamed** (Mahony consumed this; not the host cal) |
| drop counters | Device session-status snapshot copied onto each row |

v6 files still have `gx_dps` / raw columns. Do not mix the two in one
reconstruction.

## Reconstruct and validate

Python 3, stdlib only. From the repo root:

```sh
python tools/reconstruct_trajectory.py path/capture.csv --output trajectory.csv
```

| Flag | Effect |
|------|--------|
| `--device-id` | Required when the CSV has more than one pod |
| `--output` | Default `trajectory.csv` |
| `--clean-outliers` | v6 only: repair rails / isolated spikes **in memory**. v7 has no `ax_raw` and skips this |
| `--end-displacement-m x,y,z` | External endpoint (use `0,0,0` for a closed stroke) |
| `--allow-untrusted` | Print FAIL lines and still write. Diagnostic only |

Inspect a v6 repair as a separate file:

```sh
python tools/clean_motion_csv.py path/v6_capture.csv --output path/v6_cleaned.csv
```

That script exits if `ax_raw` / `gx_dps` are missing (v7).

v7 reconstruction prefers firmware `qw..qz` (needs ≥90 % finite, unit-ish
quaternions). v6 without those columns falls back to host AHRS from gyro + mag.

### Quality gates (refuse unless all PASS)

| Check | Pass rule |
|-------|-----------|
| `sequence_loss_below_0.5pct` | Missing `sample_index` slots / (rows + missing) < 0.5 % |
| `imu_rail_sparse_ok` | Raw \|int16\| ≥ 32760 on ≤ `max(5, 0.5 % of rows)` (v6). v7 has no raw → rails = 0 |
| `stationary_start_at_least_1s` | `bias_start` rows with `stationary=1` ≥ log rate (one second) |
| `stationary_end_at_least_1s` | Same for `bias_end` |
| `magnetometer_calibrated` | Header contains `_mag_cal=` |
| `capture_under_8s` | `sample_ms` span ≤ 8 s |

A two-second UI hold can still fail the 1 s stationary gate if `|accel|` never
sits within 0.08 g of 1 g (loose mount, clipping, or a non-1 g bias).

`--allow-untrusted` is diagnostic only and must not be treated as validation.

Output columns: `sample_ms`, `seq` (`sample_index`), `x/y/z_m`, `vx..vz_mps`,
`lin_ax..az_mps2`, `qw..qz`. Position is relative to the first sample, gravity
removed in the estimated world frame. A shoulder-anchor assumption does not
observe translation; elbow bend and gyro bias still walk the path.

For metric accuracy, measure at least one external reference (known endpoint,
video marker, optical tracking, or UWB).

## Required reference reading

- QMI8658A datasheet: CTRL2/CTRL3 full-scale and 6-DoF ODR tables; DRDY behavior.
- QMI8658A datasheet section 8: FIFO and watermark behavior.
- QMC5883P datasheet: normal mode setup, CTRL1 ODR/OSR, CTRL2 range/set-reset.
- ESP-IDF NimBLE documentation: GATT notifications, ATT MTU, and connection
  throughput.

The QMI hardware FIFO is not enabled in this profile. Acquisition remains
DRDY-clocked; the data-loss fix is the queued, MTU-aware BLE notification
batcher. Hardware FIFO is a future option if on-device scheduling still causes
loss after transport gaps have been removed.

CSV / session wire fields: [`SESSION_PROTOCOL.md`](SESSION_PROTOCOL.md).
