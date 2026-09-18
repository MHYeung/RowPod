# Short arm-stroke trajectory capture

This setup targets relative 3D shape over a 1–3 second arm stroke. It does not
turn a single IMU into an absolute room-position sensor. Magnetometer data
constrains heading; it does not observe translation.

## Before collecting data

1. Flash the current firmware and open the IMU lab over HTTPS (`/lab.html?v=16.8` locally).
2. Connect one pod and select **Calibrate mag (30 s)**.
3. Move the assembled pod in a slow figure-8 and tumble it through
   nose-down / tail-down / each side-down. Flat table spins leave one axis
   uncovered. Stay away from steel, loudspeakers, motors, charging cables,
   and the laptop. Watch the live X/Y/Z coverage until each axis shows ✓.
4. Mount the pod rigidly on the hand or forearm. Do not let it move inside a
   loose palm grip.

Recalibrate after changing the enclosure, battery position, mounting hardware,
or test room.

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
selects 448 Hz 6-DoF (not accel-only 500 Hz) with 100 Hz magnetometer; coalesced acquisition events advance `seq` so quality checks
can detect them.

## Reconstruct and validate

Run:

```powershell
python tools/reconstruct_trajectory.py path\capture.csv --output trajectory.csv
```

For automatic, auditable repair of isolated rails and spikes, use:

```powershell
python tools/reconstruct_trajectory.py path\capture.csv `
  --clean-outliers --output trajectory.csv
```

This preserves the original CSV and, on v6 debug dumps only, replaces flagged
engineering samples in memory using neighboring valid samples. To inspect a v6
repair, export a separate file with `tools/clean_motion_csv.py`. CSV v7 has no
raw columns; reconstruction uses firmware quaternions instead.

For a stroke known to return to its exact starting point, add the external
endpoint constraint:

```powershell
python tools/reconstruct_trajectory.py path\capture.csv `
  --end-displacement-m 0,0,0 --output trajectory.csv
```

The tool refuses a result unless sequence loss, dense IMU clipping, start/end
stillness, magnetometer calibration, and capture duration pass quality gates.
A few isolated peak clips on a short stroke are allowed; sustained saturation
is not.
`--allow-untrusted` is diagnostic only and must not be treated as validation.

For metric accuracy, measure at least one external reference (known endpoint,
video marker, optical tracking, or UWB). A shoulder-anchor assumption limits
the motion model but does not independently correct translational drift,
especially when the elbow bends.

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
