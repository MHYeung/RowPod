# C3-Tracker Web Bluetooth Plotter

Local Chrome/Edge page for single-pod logging and multi-pod overlay monitoring.

## Serve (required)

Web Bluetooth needs a secure context. Use localhost:

```sh
cd web/ble_plotter
python -m http.server 8080
```

Open **http://localhost:8080/?v=6** (not `file://`). Hard-refresh if UI looks stale.

## Steps

1. Flash firmware (`idf.py flash monitor`).
2. Click **Add pod**, pick a nearby tracker (motion UUID or `C3-Tracker` / `C3-T-` name).
3. Notifications start automatically; overlays use one color per pod.
4. Pod cards show battery % (refreshed every 15 s).
5. Rename a pod to write the position name into device NVS (BLE advertised name).
6. Use **Sync** for a software clock handshake (ms-scale CSV alignment).
7. Tabs:
   - **Plots** — overlay accel / gyro / mag
   - **Orientation** — selected-pod cube
   - **CSV log** — tagged multi-pod samples

## Protocol

### Motion

- Service `9b7e1000-2b2f-4f71-9b86-4bb2e6d54f00`
- Notify `…1001`: 20-byte LE frame `seq + 9×int16`
- Read `…1002`: scale metadata (`flags` bit0 = multi mode)

### Configuration / sync

- Service `9b7e2000-2b2f-4f71-9b86-4bb2e6d54f00`
- Read `…2001`: mode, pod_id, custom-name flag
- Read/Write `…2002`: UTF-8 advertised/position name (≤20 chars)
- Write/Notify `…2003`: software sync request/response
- Read `…2004`: battery `u16 mV LE + u8 percent + u8 flags` (bit0 = valid)

## Limits

- One browser gesture per newly permitted pod.
- Practical target: 2–4 pods at 100 Hz notify.
- Software sync compensates estimated clock offset/RTT; it is not sample-level IMU sync.
