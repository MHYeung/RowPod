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

Open `http://localhost:8080`, click **Connect**, select **C3-Tracker**.

## Project structure

```
.
├── main/                 Orchestration only (app_main)
├── components/
│   ├── board/            Pin / address map
│   ├── i2c_bus/          Single I2C master owner
│   ├── qmi8658/          IMU driver
│   ├── qmc5883p/         Magnetometer driver
│   ├── sensor_protocol/  BLE wire frame + UUIDs
│   ├── sensor_stream/    100 Hz sampling task
│   ├── ble_tracker/      NimBLE peripheral (LBS + motion)
│   ├── ui/               LEDs + button
│   ├── battery/          ADC (scaffold)
│   └── power/            Sleep policy (scaffold)
└── web/ble_plotter/      Local Web Bluetooth UI
```

## Adding a component

1. Create `components/<name>/` with `include/`, `<name>.c`, `CMakeLists.txt`.
2. Add it to `main/CMakeLists.txt` `REQUIRES`.
3. Call `<name>_init()` from `app_main` with `ESP_ERROR_CHECK`.

## Logging

Use `ESP_LOGI` / `ESP_LOGW` / `ESP_LOGE` — never `printf`.

See [BRINGUP.md](BRINGUP.md) for staged hardware bring-up notes.
