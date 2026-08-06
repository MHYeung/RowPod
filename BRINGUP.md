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

## Application flow (current)

1. `ui_init` — LEDs + button GPIOs
2. `sensor_stream_init` — I²C bus, IMU/mag init, paused 100 Hz task
3. `ble_tracker_init` — NimBLE advertise as `C3-Tracker`
4. Client enables notifications on motion data characteristic → streaming starts
5. Nordic LBS LED write `00`–`03` controls LEDs over BLE

## Web plotter

```text
cd web/ble_plotter
python -m http.server 8080
```

Open `http://localhost:8080` in Chrome/Edge (not `file://`).

## Known hardware notes

- SCL (GPIO5 / TP5) has been intermittent; idle-high must be ~3.3 V before trusting I²C.
- External 4.7 kΩ pull-ups required; do not rely on internal weak pull-ups alone.
- Leave IMU INT pins for a later stage; never do I²C from an ISR.

## Documentation checkpoints

- ESP-IDF I2C master + NimBLE GATT notify
- QMI8658A / QMC5883P datasheets (identity, output registers, scales)
- Chrome Web Bluetooth secure context (`localhost` or HTTPS)
