# C3-Tracker Web Bluetooth Plotter

Chrome/Edge page for single-pod logging and multi-pod overlay monitoring.

## Hosted URL

GitHub Pages on the private Pro repo (static `web/ble_plotter/` only):

`https://mhyeung.github.io/ESP32C3_MotionTracking_Gadget/?v=12`

Setup: [`docs/DASHBOARD_PAGES.md`](../../docs/DASHBOARD_PAGES.md).

## Local serve

Web Bluetooth needs a secure context (`https://` or `localhost`):

```sh
cd web/ble_plotter
python -m http.server 8080
```

Open **http://localhost:8080/?v=12** (not `file://`). Hard-refresh if UI looks stale.

## Steps

1. Flash firmware (`idf.py flash monitor`).
2. Click **Add pod**, pick one nearby tracker, wait until it is connected, then
   repeat for the next tracker. During the second pod's GATT setup, existing
   notification streams are paused briefly, then resumed automatically; pods
   stream concurrently after setup.
3. Notifications start automatically; overlays use one color per pod.
4. Pod cards show battery % (refreshed every 15 s).
5. Rename a pod to write the position name into device NVS (BLE advertised name).
6. Use **Sync** for a software clock handshake (ms-scale CSV alignment).
7. Calibrate the assembled pod's magnetometer before trajectory capture.
8. Tabs:
   - **Plots** — overlay accel / gyro / mag
   - **Orientation** — selected-pod cube
   - **CSV log** — tagged multi-pod samples

## Protocol

### Motion

- Service `9b7e1000-2b2f-4f71-9b86-4bb2e6d54f00`
- Notify `…1001`: one or more packed 20-byte LE frames (`seq + 9×int16`)
- Read `…1002`: scale metadata (`flags` bit0 = multi mode)

### Configuration / sync

- Service `9b7e2000-2b2f-4f71-9b86-4bb2e6d54f00`
- Read `…2001`: mode, pod_id, custom-name flag
- Read/Write `…2002`: UTF-8 advertised/position name (≤20 chars)
- Write/Notify `…2003`: software sync request/response
- Read `…2004`: battery `u16 mV LE + u8 percent + u8 flags` (bit0 = valid)
- Read/Write `…2005`: sensor-native rate Hz (`56`, `112`, or `224`)
- Read/Write `…2006`: workout profile (`0` general, `1` HYROX)

### Rates

- Connected live monitor: **56 Hz**
- Logging: **224 Hz** (one pod) or **112 Hz** (2+ pods); CSV v3 records
  calibration, stationary phases, and quality metrics
- No motion CCCD → sampling off (no IMU broadcast)

The Summary tab provides fleet cards with battery/sensor health and short live
activity plots. The HYROX tab estimates station work/rest, effort, cadence, and
candidate repetitions; validate station thresholds against manual counts.

## Limits

- One browser gesture per newly permitted pod.
- Practical target: 2–4 pods at 112 Hz notify.
- Software sync compensates estimated clock offset/RTT; it is not sample-level IMU sync.
