# RowPod

<img src="download/images/thumbnail.png" alt="Fulcrum RowPod. The pod sits in a printed oar clamp with the blue LED lit." width="480">

RowPod is a set of oar-mounted pods and a tablet page for the crew. Each pod measures oar angle with an **ESP32-C3FH4** and a QMI8658A, and sends it over Bluetooth. The tablet draws every connected oar from catch to finish. RowPod v2 has no magnetometer.

The Record page is the one used on the water. This piece has four pods. The fan is the live angle, the graph is the last few seconds, and catch spread is how far apart the catches are.

<img src="download/images/app_record_page.png" alt="Record page during a piece. Four pods, fan from catch to finish, angle graph, catch spread 121 ms." width="680">

The current tablet build is **1.5.4** (version code 7), package `org.rowpod.app`:

[download/rowpod_1.5.4.apk](download/rowpod_1.5.4.apk)

How to install it and use the six screens: [download/README.md](download/README.md). Allow “install unknown apps” on the tablet. The web dashboard below is the other host.

A pod is a board, a lithium-polymer cell, and a printed shell. The cell sits on two foam strips. The blue LED shows the pod is awake.

<img src="download/images/IMG_3364.jpg" alt="Parts of a pod: lithium cell, board, and the two halves of the white shell." width="440">
<img src="download/images/IMG_3363.jpg" alt="Board on the cell with the blue LED lit, next to the open shell." width="260">

The enclosure, the battery connector, and the oar clamp are print files on MakerWorld, linked under Hardware. They are not an official Concept2 product.

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

## Web dashboard

**Hosted (recommended, GitHub Pro):** after the one-time Pages setup in
[`docs/DASHBOARD_PAGES.md`](docs/DASHBOARD_PAGES.md), open:

`https://mhyeung.github.io/RowPod/?v=1.4.4`

That URL is **RowPod**. IMU lab (plots, HYROX, mag-cal CSV) is
`…/lab.html?v=16.9`. Actions deploys only `web/ble_plotter/` as the Pages
site; firmware stays on `main`. The site URL is still publicly reachable.

**Local fallback:**

```sh
cd web/ble_plotter
python -m http.server 8080
```

Open `http://localhost:8080/?v=1.4.4`, click **Add pod**, select a tracker.

Rowing detail: [`docs/ROWING_SYNC.md`](docs/ROWING_SYNC.md) and
[`docs/ROWPOD_ECOSYSTEM.md`](docs/ROWPOD_ECOSYSTEM.md). Next slices:
[`docs/ROWPOD_NEXT.md`](docs/ROWPOD_NEXT.md).

## Pod identity and host selection

- Every firmware pod is permanently a single-node BLE peripheral.
- The default advertised name is unique: `C3-T-XXXX` (stable pod id from NVS/MAC).
- The dashboard host selects one or multiple pods by using **Add pod** for each
  device; no device-side mode switch is required.
- After three minutes with no BLE link the pod enters deep sleep. Hold GPIO0
  for ~2 s to boot again; a shorter press is ignored and the pod stays asleep.
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
│   ├── device_config/    NVS name, pod id, oar side/zero, fixed single-node identity
│   ├── i2c_bus/          Single I2C master owner
│   ├── qmi8658/          IMU driver
│   ├── mahony/           On-device AHRS (gyro + accel; yaw is not mag-corrected)
│   ├── sensor_protocol/  BLE wire frames (v1 / v16 / fused / coach summary) + UUIDs
│   ├── rowing_metrics/   On-pod catch/finish/arc (port of the browser tracker)
│   ├── sensor_stream/    Native-clock 56/112/224/448 Hz DRDY stream + Mahony
│   ├── ble_tracker/      NimBLE peripheral + queued packet batching / drain
│   ├── ui/               Blue status LED + button gestures
│   ├── battery/          ADC oneshot on GPIO2 → pack mV / %
│   └── power/            Three-minute deep-sleep policy (GPIO0 wake)
└── web/ble_plotter/      Local Web Bluetooth UI
```

## Hardware

The enclosure, battery connector, and oar mount are not in this repo. Print files are published on MakerWorld:

- Pod housing: MakerWorld link to be added
- Battery connector: MakerWorld link to be added
- Mount for a Concept2 oar: MakerWorld link to be added

Board files, revision RowPod2 V1.0. Order the Gerber zip as a 4-layer board.

- Schematic: [pcb/SCH_rowpod_SCH_2026-11-05.pdf](pcb/SCH_rowpod_SCH_2026-11-05.pdf)
- Board drawing and bill of materials: [pcb/PCB_rowpod_2026-11-05.pdf](pcb/PCB_rowpod_2026-11-05.pdf)
- Gerbers: [pcb/rowpod_gerber.zip](pcb/rowpod_gerber.zip)
- 3D board: [pcb/rowpod_PCB.step](pcb/rowpod_PCB.step)
- Render: [pcb/rowpod_pcb_render.png](pcb/rowpod_pcb_render.png)

Firmware stays in this repository. The printed parts are not an official Concept2 product.

## Adding a component

1. Create `components/<name>/` with `include/`, `<name>.c`, `CMakeLists.txt`.
2. Add it to `main/CMakeLists.txt` `REQUIRES`.
3. Call `<name>_init()` from `app_main` with `ESP_ERROR_CHECK`.

## Logging

Use `ESP_LOGI` / `ESP_LOGW` / `ESP_LOGE` — never `printf`.
The single-tap action controls BLE streaming; CSV capture remains in the
browser dashboard and is not stored in pod flash.
The session/status lifecycle and CSV provenance fields are documented in
[docs/SESSION_PROTOCOL.md](docs/SESSION_PROTOCOL.md).

For calibrated, quality-gated short arm-stroke capture and reconstruction, see
[docs/TRAJECTORY_CAPTURE.md](docs/TRAJECTORY_CAPTURE.md).
For station-aware training metrics, see
[docs/HYROX_TRAINING.md](docs/HYROX_TRAINING.md).
For repeatable runtime and battery-power characterization, see
[docs/test_protocols/BATTERY_RUNTIME_TEST.md](docs/test_protocols/BATTERY_RUNTIME_TEST.md).
For v16 throughput / drain integrity, see
[docs/test_protocols/V16_THROUGHPUT_DRAIN_TEST.md](docs/test_protocols/V16_THROUGHPUT_DRAIN_TEST.md).

See [BRINGUP.md](BRINGUP.md) for staged hardware bring-up notes.
