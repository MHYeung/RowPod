# Sensor sampling — I2C, IMU, mag, DRDY clock

The pod samples on the **QMI8658 INT2 data-ready pulse**, not a FreeRTOS timer.
One task owns the I2C bus. That is why live rowing stays at 56 Hz and why
rate writes from BLE are applied asynchronously.

Wire frames and capture lifecycle: [`SESSION_PROTOCOL.md`](SESSION_PROTOCOL.md).
Bring-up pin map: [`../BRINGUP.md`](../BRINGUP.md).

## Architecture

```
INT2 (GPIO3, rising)  →  ISR: xTaskNotify (no I2C)
                      →  sensor_stream task (priority 5)
                            ├─ optional ODR update (IMU + mag)
                            ├─ qmi8658_read_raw (every DRDY)
                            ├─ qmc5883p_read_raw (strided to mag ODR)
                            ├─ mahony_update
                            └─ length-1 latest queue + BLE sample callback
```

| Constraint | Why |
|------------|-----|
| Never I2C from an ISR or BLE callback | Bus is owned by `stream_task`. Rate/profile GATT writes only set a dirty flag and notify the task. |
| INT1 (GPIO8) is unused | DRDY is routed to **INT2**. Probing INT1 will look dead. |
| Internal pull-ups are enabled | They are not enough. Bring-up still needs external **4.7 kΩ** on SDA/SCL. Init fails if the bus is not idle-high within **500 ms**. |
| 400 kHz Fast-mode | Required for 448 Hz 6-DoF + mag stride. Device `scl_speed_hz` is `BOARD_I2C_FREQ_HZ`. |

`sensor_stream_init()` order: DRDY GPIO → `i2c_bus_init` → IMU → mag → live
ODR (56 Hz) → Mahony → length-1 queue → task → ISR attach. Streaming stays
**paused** until a motion CCCD is enabled.

## QMI8658A (`0x6A`, WHO_AM_I `0x05`)

Trajectory profile is **±16 g** (2048 LSB/g) and **±2048 dps** (16 LSB/dps).
Wide ranges avoid clipping fast arm strokes; they are not a precision IMU
setting.

| Item | Value | Notes |
|------|-------|--------|
| CTRL1 | `0x50` | `ADDR_AI` (bit 6) + INT2 enable. **Without auto-increment, a 12-byte read from `0x35` repeats AX and looks like noise.** |
| CTRL7 | `0x03` | Accel + gyro on; `DRDY_DIS=0` so pulses go to INT2. |
| Burst | `0x35` … 12 bytes LE | AX..GZ. |
| Identity | 3 consecutive WHO_AM_I matches in 5 tries | Soft-reset (`0x60=0xB0`) then 50 ms delay. |

6-DoF ODR codes (CTRL2/CTRL3 low nibble). Accel-only **500 Hz is not used**.

| Host rate | ODR code | Datasheet |
|-----------|----------|-----------|
| 56 Hz | `0x7` | 56.2 Hz 6-DoF |
| 112 Hz | `0x6` | 112.1 Hz |
| 224 Hz | `0x5` | 224.2 Hz |
| 448 Hz | `0x4` | **448.4 Hz** 6-DoF |

## QMC5883P (`0x2C`, CHIPID `0x80`)

±8 G (3750 LSB/G). Board-specific `XYZ_SIGN = 0x06` and CTRL2 set/reset
(`0x08`) run after soft-reset. Do not copy another PCB’s sign register.

| IMU profile | Mag ODR (CTRL1 bits) | Mag I2C stride |
|-------------|----------------------|----------------|
| 56 Hz | 50 Hz | every DRDY |
| 112 Hz | 100 Hz | ~1 |
| 224 Hz | 200 Hz | ~1 |
| 448 Hz | 100 Hz | ~4 IMU DRDYs (~10 ms heading correction) |

Mag I2C is limited to the magnetometer ODR so the 400 kHz bus can keep 448 Hz
6-DoF. Held mag samples are reused; Mahony only applies yaw when `mag_fresh`.

## Sample clock

INT2 is the only sampling clock. `sample_index` is a monotonic `uint32`
advanced for **every DRDY slot**, including:

- coalesced interrupts (`s_drdy_count` jumped by more than 1);
- failed IMU reads (logged, counted as dropped, still consume an index).

That keeps `sample_ms` a uniform timebase instead of a silent stall. The
latest-sample queue is **length 1** (overwrite stale). BLE batching / drain
lives in `ble_tracker`, not here.

Rate writes (`…2005` or session PREPARE) call `sensor_stream_set_rate_hz`,
which is safe from a BLE callback. Hardware ODR changes on the next
`stream_task` wake. `rate_epoch` (session status) increments only after the
applied IMU rate actually changes. 448 Hz is wire token **255**.

## Common pitfalls

- Treating datasheet **accel-only 500 Hz** as a 6-DoF capture rate.
- Reading IMU from a notify callback “to be faster” — it is a bus race.
- Skipping `ADDR_AI` after a driver rewrite; traces look noisy, WHO_AM_I still
  passes.
- SCL stuck low: `i2c_bus_init` returns `ESP_ERR_INVALID_STATE`. Measure idle
  high ~3.3 V at TP5 before trusting sensors.
- Enabling two motion CCCDs: firmware prefers fused → v16 → v1 so the radio
  is not doubled. RowPod must request **raw gyro** (`preferRawGyro`).

## Usage (firmware)

```c
ESP_ERROR_CHECK(sensor_stream_init());
sensor_stream_set_sample_cb(on_sample, NULL); /* queue/notify only */
ESP_ERROR_CHECK(sensor_stream_set_rate_hz(56)); /* applied on the I2C task */
```

Call `sensor_stream_set_enabled(true)` only after a peer subscribes. Keep the
sample callback off the I2C path.

Datasheets to keep open: QMI8658A CTRL2/CTRL3 6-DoF ODR tables and INT2 DRDY;
QMC5883P CTRL1 ODR/OSR, CTRL2 range/set-reset, XYZ sign.
