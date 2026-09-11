# C3-Tracker Web Bluetooth Plotter

Chrome/Edge page for single-pod logging and multi-pod overlay monitoring.

## Hosted URL

GitHub Pages on the private Pro repo (static `web/ble_plotter/` only):

`https://mhyeung.github.io/ESP32C3_MotionTracking_Gadget/?v=16.8`

Setup: [`docs/DASHBOARD_PAGES.md`](../../docs/DASHBOARD_PAGES.md).

## Local serve

Web Bluetooth needs a secure context (`https://` or `localhost`):

```sh
cd web/ble_plotter
python -m http.server 8080
```

Open **http://localhost:8080/?v=16.8** (not `file://`). Hard-refresh if UI looks stale.

Rowing catch/finish view (portrait PWA): **http://localhost:8080/rowpod.html?v=1.3.0**

Coach/athlete ecosystem map: [`docs/ROWPOD_ECOSYSTEM.md`](../../docs/ROWPOD_ECOSYSTEM.md).

Protocol unit tests (no browser):

```sh
node web/ble_plotter/protocol.test.js
node web/ble_plotter/rowing_angle.test.js
```

## Steps

1. Flash firmware (`idf.py flash monitor`).
2. Click **Add pod**, pick one nearby tracker, wait until it is connected, then
   repeat for the next tracker. During the second pod's GATT setup, existing
   notification streams are paused briefly, then resumed automatically; pods
   stream concurrently after setup.
3. Notifications start automatically; overlays use one color per pod.
4. Pod cards show battery % (refreshed every 15 s outside an endurance test).
5. Rename a pod to write the position name into device NVS (BLE advertised name).
6. Use **Sync** for a software clock handshake (ms-scale CSV alignment).
7. Calibrate the assembled pod's magnetometer before trajectory capture.
8. Tabs:
   - **Summary** — fleet cards + capture integrity (MTU, missing frames, drops)
   - **Plots** — overlay accel / gyro / mag
   - **Orientation** — selected-pod cube
   - **CSV log** — fused Mahony samples (CSV v7)
   - **Battery test** — low-rate per-pod endurance/status CSV

## Protocol

### Motion

- Service `9b7e1000-2b2f-4f71-9b86-4bb2e6d54f00`
- Notify `…1001`: one or more packed 20-byte LE frames (`seq + 9×int16`) — v1
- Notify `…1003`: one or more packed 22-byte LE frames (`sample_index + 9×int16`) — v16
- Notify `…1004`: packed 24-byte fused frames (Q15 quat + accel + mag; **no gyro**)
- Read `…1002`: scale metadata (`flags` bit0 = multi mode)
- Lab dashboard prefers fused when capabilities advertise it and ATT MTU ≥ 27
- RowPod sets `preferRawGyro` and stays on `…1003` (see [`docs/MAHONY_AHRS.md`](../../docs/MAHONY_AHRS.md))

### Configuration / sync

- Service `9b7e2000-2b2f-4f71-9b86-4bb2e6d54f00`
- Read `…2001`: mode, pod_id, custom-name flag
- Read/Write `…2002`: UTF-8 advertised/position name (≤20 chars)
- Write/Notify `…2003`: software sync request/response
- Read `…2004`: battery `u16 mV LE + u8 percent + u8 flags` (bit0 = valid)
- Read/Write `…2005`: sensor-native rate Hz (`56`, `112`, `224`, or `448`; 448 is wire `255`)
- Read/Write `…2006`: workout profile (`0` general, `1` HYROX, `2` rowing)
- Write `…2007`: legacy 8-byte session command
- Read/Notify `…2008`: legacy 36-byte session status
- Read `…2009`: capabilities (formats, rates, MTU, queue depth)
- Write `…200a`: v16 12-byte session command with command id
- Read/Notify `…200b`: v16 56-byte status with applied rate, drain barrier,
  32-bit sample boundaries, and queue high-water

### Rates

- Connected live monitor: **56 Hz**
- Logging: **448 Hz** (one pod) or **112 Hz** (2+ pods); CSV v7 records
  Mahony quaternions, body accel/mag, stationary phases, and drop counters
- Capture lifecycle (GATT): `PREPARE → START → STOP → DRAIN → FINALIZE`;
  `FINALIZE` requires `drain_done`. Browser CSV phases `bias_start` / `motion` /
  `bias_end` are host-only labels, not extra commands.
- No motion CCCD → sampling off (no IMU broadcast)

The Summary tab provides fleet cards with battery/sensor health, short live
activity plots, and a capture-integrity panel. The HYROX tab estimates station
work/rest, effort, cadence, and candidate repetitions; validate station
thresholds against manual counts.

The Battery test tab logs loaded voltage, state, actual rate, gaps, missing
frames, and outliers. It does not measure mAh; keep the browser visible and pair
the log with an external current trace when assessing energy use.

## Limits

- One browser gesture per newly permitted pod.
- Practical target: 2–4 pods at 112 Hz notify.
- Software sync compensates estimated clock offset/RTT; it is not sample-level IMU sync.
  RowPod stamps samples from a fitted `sample_index → host ms` model instead of
  notify arrival (see `docs/ROWING_SYNC.md`).
- ATT MTU must be ≥25 to carry a single 22-byte v16 frame, ≥27 for 24-byte
  fused; preflight warns otherwise. The pod initiates Exchange MTU because
  Windows/Chrome often do not.
