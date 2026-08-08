# ESP32-C3 Motion Tracker

> gstack ESP-IDF project — modular, fast, embedded-first.

Athletic / portable tracker on **ESP32-C3FH4** with QMI8658A IMU, QMC5883P
magnetometer, CA-C03 chip antenna, and a local Web Bluetooth plotter.

## Requirements

- ESP-IDF **6.0.1** (or compatible 6.x)
- Target chip: **esp32c3**
- Chrome or Edge for the Web Bluetooth plotter (HTTPS or `localhost`)

## Build & flash

```sh
idf.py set-target esp32c3
idf.py build
idf.py -p COMx flash monitor
```

## Web plotter

**Hosted (recommended, GitHub Pro):** after the one-time Pages setup in
[`docs/DASHBOARD_PAGES.md`](docs/DASHBOARD_PAGES.md), open:

`https://mhyeung.github.io/ESP32C3_MotionTracking_Gadget/?v=7`

Actions deploys only `web/ble_plotter/` as the Pages site; firmware stays on
`main`. The site URL is still publicly reachable.

**Local fallback:**

```sh
cd web/ble_plotter
python -m http.server 8080
```

Open `http://localhost:8080/?v=7`, click **Add pod**, select a tracker.

## Pod identity and host selection

- Every firmware pod is permanently a single-node BLE peripheral.
- The default advertised name is unique: `C3-T-XXXX` (stable pod id from NVS/MAC).
- The dashboard host selects one or multiple pods by using **Add pod** for each
  device; no device-side mode switch is required.
- Hold GPIO10 for ~2 s in light sleep to wake; a shorter wake press is ignored.
- In a connected pod, single-tap pauses/resumes the BLE sensor stream.
- Dashboard rename writes the position name into the pod NVS and becomes the
  BLE advertised name (max 20 chars). Motion service UUIDs stay fixed.
- Software clock sync estimates millisecond-scale offsets for overlay/CSV; it
  is not sample-level IMU phase lock.
- Target 2–4 simultaneous Web Bluetooth pods; each first connect needs a
  browser gesture.

## Project structure

```
.
├── main/                 Orchestration only (app_main)
├── components/
│   ├── board/            Pin / address map
│   ├── device_config/    NVS name, pod id, fixed single-node identity
│   ├── i2c_bus/          Single I2C master owner
│   ├── qmi8658/          IMU driver
│   ├── qmc5883p/         Magnetometer driver
│   ├── sensor_protocol/  BLE wire frame + UUIDs
│   ├── sensor_stream/    DRDY-clocked 50 Hz live / 100–150 Hz log stream
│   ├── ble_tracker/      NimBLE motion + config peripheral
│   ├── ui/               Status LEDs + button gestures
│   ├── battery/          ADC oneshot on GPIO2 → pack mV / %
│   └── power/            Three-minute light-sleep policy
└── web/ble_plotter/      Local Web Bluetooth UI
```

## Adding a component

1. Create `components/<name>/` with `include/`, `<name>.c`, `CMakeLists.txt`.
2. Add it to `main/CMakeLists.txt` `REQUIRES`.
3. Call `<name>_init()` from `app_main` with `ESP_ERROR_CHECK`.

## Logging

Use `ESP_LOGI` / `ESP_LOGW` / `ESP_LOGE` — never `printf`.
The single-tap action controls BLE streaming; CSV capture remains in the
browser dashboard and is not stored in pod flash.

See [BRINGUP.md](BRINGUP.md) for staged hardware bring-up notes.
