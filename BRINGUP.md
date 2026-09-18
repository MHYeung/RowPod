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

Matches `main/main.c`:

1. `nvs_flash_init` + default event loop
2. `device_config_init` — load name / pod id from NVS
3. `ui_init` — LEDs + debounced button gesture task
4. `battery_init` — ADC oneshot on GPIO2 (pack = ADC × 2)
5. `power_init` — three-minute disconnected idle → light sleep
6. `sensor_stream_init` — I²C bus, IMU/mag init, INT2 DRDY task, Mahony
7. `ble_tracker_set_link_cb(power_on_ble_link)` then `ble_tracker_init`
8. Client enables notifications on **one** motion characteristic → streaming
   (firmware prefers fused, then v16, then v1)
9. Dashboard may write position name / workout profile / software sync
10. Every pod advertises as a fixed single-node peripheral with a unique pod name
11. The host may connect one or multiple pods using repeated **Add pod** actions
12. No connection for three minutes → BLE stops and light sleep waits for GPIO10
13. A short wake press is ignored; hold GPIO10 for 2 s, release, and advertising resumes
14. In a connected pod, single-tap pauses/resumes the BLE sensor stream

Console is the C3 **USB Serial/JTAG** port (`CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG`).
Use `idf.py -p <port> flash monitor` on that interface, not a UART-only cable
on GPIO20/21.

## I²C ownership

One FreeRTOS task (`sensor_stream`) owns the bus. The INT2 ISR only
`xTaskNotifyFromISR`; BLE callbacks only request rate/enable flags. Do not add
I2C, Mahony, or blocking `ble_gatts_notify` on those paths.

`i2c_bus_init` waits up to 500 ms for SDA/SCL idle-high, then enables the IDF
master with internal pull-ups. Those internals are **not** a substitute for
external 4.7 kΩ pull-ups; SCL (GPIO5 / TP5) must still idle near 3.3 V.

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

Open `http://localhost:8080/?v=1.4.4` (RowPod) or
`http://localhost:8080/lab.html?v=16.8` (IMU lab) in Chrome/Edge (not
`file://`). Hard-refresh if Add pod looks dead. The two hosts use **different**
cache-bust tokens — see [`docs/DASHBOARD_PAGES.md`](docs/DASHBOARD_PAGES.md).

## Developer pitfalls

| Symptom | Likely cause |
|---------|----------------|
| `i2c_bus: not idle` at boot | Missing external pull-ups, solder bridge, or SCL stuck low |
| WHO_AM_I / CHIPID fail | Bus not 400 kHz healthy; confirm 0x6A / 0x2C with a probe |
| Connected but 0 Hz / queue high-water | ATT MTU still 23, or notify-inflight deadlock (see [`docs/SESSION_PROTOCOL.md`](docs/SESSION_PROTOCOL.md)) |
| Oar catch walks toward iron | Host subscribed fused Mahony instead of v16 raw gyro |
| Capture `FINALIZE` rejected | Drain not complete / queue not empty |
| Light sleep never resumes BLE | Wake press shorter than 2 s; short GPIO wake is ignored |
| Stale RowPod after a host bump | Hard-refresh `/?v=1.4.4`; delete the installed PWA (`rowpod-1.4.4`) |
| Stale IMU lab after a lab JS change | Hard-refresh `lab.html?v=16.8` (lab has no service worker) |
| `file://` Web Bluetooth | Serve `localhost` or the Pages HTTPS URL |
| Monitor shows nothing | Wrong port; firmware uses USB Serial/JTAG |

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
- On-device Mahony vs v16 raw gyro: [`docs/MAHONY_AHRS.md`](docs/MAHONY_AHRS.md)
- BLE MTU / batching / IDF 6 `NOTIFY_TX`: [`docs/SESSION_PROTOCOL.md`](docs/SESSION_PROTOCOL.md)
