# ESP32-C3 Motion Tracker

> gstack ESP-IDF project — modular, fast, embedded-first.

Athletic / portable tracker on **ESP32-C3FH4** with QMI8658A IMU, QMC5883P
magnetometer, CA-C03 chip antenna, and a local Web Bluetooth plotter.

## Requirements

- ESP-IDF **6.0.1** (or compatible 6.x)
- Target chip: **esp32c3**
- Chrome or Edge for the Web Bluetooth plotter (`http://localhost`)

## Build & flash

```sh
idf.py set-target esp32c3
idf.py build
idf.py -p COMx flash monitor
```

## Web plotter

```sh
cd web/ble_plotter
python -m http.server 8080
```

Open `http://localhost:8080/?v=5`, click **Add pod**, select a tracker.

## Single / multi-pod modes

- Long-press GPIO10 for ~2 s while advertising toggles Single ↔ Multi.
- Single default name: `C3-Tracker`.
- Multi default name: `C3-T-XXXX` (stable pod id from NVS/MAC).
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
│   ├── device_config/    NVS mode, name, pod id
│   ├── i2c_bus/          Single I2C master owner
│   ├── qmi8658/          IMU driver
│   ├── qmc5883p/         Magnetometer driver
│   ├── sensor_protocol/  BLE wire frame + UUIDs
│   ├── sensor_stream/    100 Hz sampling task
│   ├── ble_tracker/      NimBLE motion + config peripheral
│   ├── ui/               Status LEDs + long-press
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

See [BRINGUP.md](BRINGUP.md) for staged hardware bring-up notes.
