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
| Blue LED (active high) | 7 |
| User button (active-low, deep-sleep wake) | 0 |
| Battery ADC | 2 |
| I²C SDA / SCL | 4 / 5 |
| IMU INT1 / INT2 | 8 / 3 |

QMI8658A @ `0x6A` (WHO_AM_I `0x05`). RowPod v2 does not fit a magnetometer.
The orange LED is the TP4056 charge indicator and is not driven by the MCU.

## Status LED

| State | Blue (GPIO7) |
|-------|----------------|
| Advertising / waiting | LEDC breathing, 2 s period |
| Connected | Dim |
| Streaming notifications | Dim |
| Deep sleep | Held off |

## Application flow (current)

1. `device_config_init` — load name / pod id from NVS
2. `ui_init` — LEDs + debounced button gesture task
3. `sensor_stream_init` — I²C bus, IMU init, INT2 DRDY task
4. `ble_tracker_init` — NimBLE advertise motion + config services
5. Client enables notifications on motion data → streaming starts
6. Dashboard may write position name / request software sync
7. Every pod advertises as a fixed single-node peripheral with a unique pod name
8. The host may connect one or multiple pods using repeated **Add pod** actions
9. No connection for three minutes → BLE stops, the IMU powers down, and the chip enters deep sleep. USB-Serial/JTAG is gone until the next boot.
10. A short press on GPIO0 is ignored (the chip boots, rejects the press, and sleeps again). Hold GPIO0 for 2 s and advertising starts. Deep sleep resets `sample_index` to 0.
11. In a connected pod, single-tap pauses/resumes the BLE sensor stream

## Multi-pod validation checklist

1. Boot one pod; confirm blue breath and advertised name.
2. Confirm the pod advertises with a unique `C3-T-XXXX` name.
3. Power-cycle; confirm pod id/name persist from NVS.
4. Enter deep sleep; short-tap and confirm it stays asleep; hold GPIO0 for 2 s and confirm it advertises. Unplug USB before this check, or the idle policy stays awake.
5. Web: Add pod → enable notify → single-tap and verify frames stop/resume.
6. Two pods: overlay traces, per-pod rates/gaps, CSV includes `position`/`synced_ms`.
7. Optional four-pod stress: watch for rising seq gaps / UI lag.

## Web plotter

```text
cd web/ble_plotter
python -m http.server 8080
```

Open `http://localhost:8080/lab.html?v=16.13` in Chrome/Edge (not `file://`). Hard-refresh if Add pod looks dead. RowPod (rowing) is `http://localhost:8080/?v=1.5.6`. Known pods reconnect on reload; **Reconnect pods** retries any that were asleep.

## Known hardware notes

- SCL (GPIO5 / TP5) has been intermittent; idle-high must be ~3.3 V before trusting I²C.
- External 4.7 kΩ pull-ups required; do not rely on internal weak pull-ups alone.
- IMU INT2 (GPIO3) is the DRDY input; verify it is wired and toggles at the
  selected ODR. The ISR only notifies the sensor task; it never performs I²C.

## Documentation checkpoints

- ESP-IDF I2C master + NimBLE GATT notify / NVS / deep-sleep GPIO wake (`esp_sleep_enable_gpio_wakeup_on_hp_periph_powerdown`, GPIO0–5 on the C3)
- QMI8658A datasheet (WHO_AM_I, CTRL1 SensorDisable, CTRL7, supply-current table)
- ESP32-C3 datasheet "Strapping Pins": GPIO2 (battery divider) and GPIO8 (IMU INT1) must still allow GPIO9+RST download mode with a battery fitted
- Chrome Web Bluetooth secure context (`localhost` or HTTPS)
- Software sync accuracy is visual/ms-scale only
