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
| Connected | 25% PWM | Off |
| Streaming notifications | 25% PWM | 25% PWM |
| Mode-change ack | brief dual flash | brief dual flash |
| Light sleep | Off | Off |

## Application flow (current)

1. `device_config_init` — load mode / name / pod id from NVS
2. `ui_init` — LEDs + long-press gesture task
3. `sensor_stream_init` — I²C bus, IMU/mag init, paused 100 Hz task
4. `ble_tracker_init` — NimBLE advertise motion + config services
5. Client enables notifications on motion data → streaming starts
6. Dashboard may write position name / request software sync
7. Long-press (~2 s) while advertising toggles Single/Multi and refreshes ADV
8. No connection for three minutes → BLE stops and light sleep waits for GPIO10
9. Wake press is wake-only; gestures re-arm after advertising resumes

## Multi-pod validation checklist

1. Boot one pod; confirm blue breath and advertised name.
2. Long-press while advertising; confirm dual LED flash and mode log / name change.
3. Power-cycle; confirm mode/name persist from NVS.
4. Enter light sleep; wake with button; confirm wake hold does **not** toggle mode.
5. Web: Add pod → enable notify → rename → reconnect and verify new ADV name.
6. Two pods: overlay traces, per-pod rates/gaps, CSV includes `position`/`synced_ms`.
7. Optional four-pod stress: watch for rising seq gaps / UI lag.

## Web plotter

```text
cd web/ble_plotter
python -m http.server 8080
```

Open `http://localhost:8080/?v=5` in Chrome/Edge (not `file://`). Hard-refresh if Add pod looks dead.

## Known hardware notes

- SCL (GPIO5 / TP5) has been intermittent; idle-high must be ~3.3 V before trusting I²C.
- External 4.7 kΩ pull-ups required; do not rely on internal weak pull-ups alone.
- Leave IMU INT pins for a later stage; never do I²C from an ISR.

## Documentation checkpoints

- ESP-IDF I2C master + NimBLE GATT notify / NVS / light-sleep GPIO wake
- QMI8658A / QMC5883P datasheets (identity, output registers, scales)
- Chrome Web Bluetooth secure context (`localhost` or HTTPS)
- Software sync accuracy is visual/ms-scale only
