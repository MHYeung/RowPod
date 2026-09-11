# On-device Mahony AHRS

The C3 runs Mahony in the I2C-owning `sensor_stream` task so the lab dashboard
can log attitude without a host AHRS. It is a relative orientation filter for
short captures, not a heading reference next to steel.

Source: `components/mahony/`, wired from `components/sensor_stream/sensor_stream.c`.
Wire format: [`SESSION_PROTOCOL.md`](SESSION_PROTOCOL.md). Capture workflow:
[`TRAJECTORY_CAPTURE.md`](TRAJECTORY_CAPTURE.md). Rowing must not use this yaw:
[`ROWING_SYNC.md`](ROWING_SYNC.md).

## Intent

- Integrate body-rate gyro, correct tilt from accelerometer, and apply mag yaw
  only when a **fresh** magnetometer sample is available.
- Emit a Q15 quaternion on the fused BLE characteristic so CSV v7 and the
  orientation cube share one firmware clock.
- Keep the filter cheap: ESP32-C3 has no FPU (`mahony.c` is soft-float).

## What the fused frame contains

Characteristic `…1004`, 24 bytes:

`uint32 sample_index` + Q15 `qw,qx,qy,qz` + body accel + mag.

Gyro is consumed on-device and **omitted** so the notify stays 24 B. Hosts that
need ω (RowPod catch/finish) must subscribe to v16 (`…1003`) instead of
differentiating the quaternion.

Q15 scale: `32767 = 1.0`. Reconstruct:

```
q = [qw, qx, qy, qz] / 32767
```

## Filter constraints (verified in `mahony.c`)

| Knob | Value | Why |
|------|-------|-----|
| `Kp` | `1.0` | Proportional accel/mag error feedback |
| `Ki` | `0` | Integral left unused; wind-up on a moving athlete is worse than a little gyro bias on a 1–8 s capture |
| Mag update | `mag_valid` only | Mag I2C is strided; do not treat a held vector as a new heading sample |
| `dt` clamp | 50 ms | Coalesced DRDY gaps must not freeze or explode the integrator |
| Accel gate | `‖a‖ > 0.1 g` | Skip tilt correction on a near-zero or failed read |

`dt` is `slots / applied_imu_hz`, where `slots` is 1 for a clean DRDY or the
coalesced count when interrupts piled up.

## IMU / mag pairing

Mahony still runs at IMU ODR. Mag I2C is limited to the magnetometer ODR so the
400 kHz bus can keep 448 Hz 6-DoF.

| IMU ODR | Mag ODR | Mag I2C stride (approx.) |
|---------|---------|--------------------------|
| 56 Hz | 50 Hz | every DRDY |
| 112 Hz | 100 Hz | ~1 |
| 224 Hz | 200 Hz | ~1 |
| 448 Hz | 100 Hz | ~4 IMU DRDYs between mag I2C reads |

Failed IMU reads still consume a `sample_index` slot so the host sees a gap
instead of a stall. The latest-sample queue is length 1 (overwrite stale).

## Who should subscribe

| Host | Motion CCCD | Reason |
|------|-------------|--------|
| Lab dashboard (`index.html`) | fused if caps + ATT MTU ≥ 27 | CSV v7 / cube use firmware quats |
| RowPod (`rowpod.html`) | v16 raw gyro | Mag yaw walks toward the steel gate; `preferRawGyro` |
| Legacy v15 | `…1001` 20 B | 16-bit seq only |

Firmware prefers **fused → v16 → v1** when more than one CCCD is enabled so the
radio is not doubled. Do not enable two motion notifies from a new host.

## Common pitfalls

- Differentiating fused quaternions is **not** raw gyro. Mahony already mixed
  accel/mag corrections into the attitude; RowPod 1.0.1 dropped that path.
- Uncalibrated mag (or a mount change) pulls yaw. Recalibrate the assembled
  pod before trajectory work.
- Soft-float at 448 Hz is why fusion lives in `sensor_stream`, not a BLE
  callback and not an ISR. Never call I2C or `mahony_update` from those contexts.
