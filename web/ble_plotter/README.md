# C3-Tracker Web Bluetooth Plotter

Local Chrome/Edge page that plots accel / gyro / mag over BLE notifications.

## Serve (required)

Web Bluetooth needs a secure context. Use localhost:

```sh
cd web/ble_plotter
python -m http.server 8080
```

Open **http://localhost:8080** (not `file://`).

## Steps

1. Flash firmware (`idf.py flash monitor`) — device advertises as **C3-Tracker**.
2. Click **Connect**, pick the device.
3. Enabling notifications starts the 100 Hz stream on the MCU.
4. Use LED buttons (`00`–`03`) to exercise Nordic LBS.
5. Tabs:
   - **Plots** — accel / gyro / mag time series
   - **Orientation** — 3D cube from accel tilt + mag yaw (no gyro fusion yet)
   - **CSV log** — Start / Stop / Download live samples with arrival and nominal sample timestamps

## Protocol

- Service `9b7e1000-2b2f-4f71-9b86-4bb2e6d54f00`
- Notify `…1001`: 20-byte LE frame `seq + 9×int16`
- Read `…1002`: scale metadata
- Nordic LBS LED `00001525-1212-efde-1523-785feabcd123`
