# ESP32-C3 Motion Tracker Bring-Up

Firmware is modular under `components/`. Prefer one concern per image while
debugging hardware; the production app wires UI + sensors + BLE together.

## Hardware safety before power

1. Inspect the board for solder bridges and confirm battery polarity.
2. With power removed, measure resistance from `3V3` to `GND`.
3. Power from USB first; verify `VBUS`, `V_SYS`, and `3V3` at the test pads.
4. Connect the LiPo only after the 3V3 rail is confirmed.

## Verified pin map (`components/board/include/board_pins.h`)

| Function | GPIO |
|----------|------|
| Green LED | 6 |
| Blue LED | 7 |
| User button (active-low) | 10 |
| Battery ADC | 2 |
| I²C SDA / SCL | 4 / 5 |
| IMU INT1 / INT2 | 8 / 3 |

QMI8658A @ `0x6A` (WHO_AM_I `0x05`), QMC5883P @ `0x2C` (CHIPID `0x80`).

## Status LEDs

| State | Green | Blue |
|-------|-------|------|
| Advertising / waiting | Off | LEDC breathing, 2 s period |
| Connected | Off | Dim blue |
| Streaming notifications | Off | Dim blue |
| Light sleep | Off | Off |

## Application flow (current)

1. `device_config_init` — load name / pod id from NVS
2. `ui_init` — LEDs + debounced button gesture task
3. `sensor_stream_init` — I²C bus, IMU/mag init, INT2 DRDY task
4. `ble_tracker_init` — NimBLE advertise motion + config services
5. Client enables notifications on motion data → streaming starts
6. Dashboard may write position name / request software sync
7. Every pod advertises as a fixed single-node peripheral with a unique pod name
8. The host may connect one or multiple pods using repeated **Add pod** actions
9. No connection for three minutes → BLE stops and light sleep waits for GPIO10
10. A short wake press is ignored; hold GPIO10 for 2 s, release, and advertising resumes
11. In a connected pod, single-tap pauses/resumes the BLE sensor stream

## Multi-pod validation checklist

1. Boot one pod; confirm blue breath and advertised name.
2. Confirm the pod advertises with a unique `C3-T-XXXX` name.
3. Power-cycle; confirm pod id/name persist from NVS.
4. Enter light sleep; short-tap and confirm it remains asleep; hold 2 s and release.
5. Web: Add pod → enable notify → single-tap and verify frames stop/resume.
6. Two pods: overlay traces, per-pod rates/gaps, CSV includes `position`/`synced_ms`.
7. Optional four-pod stress: watch for rising seq gaps / UI lag.

## Web plotter

```text
cd web/ble_plotter
python -m http.server 8080
```

Open `http://localhost:8080/?v=7` in Chrome/Edge (not `file://`). Hard-refresh if Add pod looks dead.

## Known hardware notes

- SCL (GPIO5 / TP5) has been intermittent; idle-high must be ~3.3 V before trusting I²C.
- External 4.7 kΩ pull-ups required; do not rely on internal weak pull-ups alone.
- IMU INT2 (GPIO3) is the DRDY input; verify it is wired and toggles at the
  selected ODR. The ISR only notifies the sensor task; it never performs I²C.

## Documentation checkpoints

- ESP-IDF I2C master + NimBLE GATT notify / NVS / light-sleep GPIO wake
- QMI8658A / QMC5883P datasheets (identity, output registers, scales)
- Chrome Web Bluetooth secure context (`localhost` or HTTPS)
- Software sync accuracy is visual/ms-scale only
