# RowPod (Web Bluetooth)

Portrait coach UI for oar-mounted C3-Tracker pods. Chrome/Edge only
(`https://` or `localhost`).

## Hosted URL

GitHub Pages on the private Pro repo (static `web/ble_plotter/` only):

`https://mhyeung.github.io/ESP32C3_MotionTracking_Gadget/?v=1.5.6`

Setup: [`docs/DASHBOARD_PAGES.md`](../../docs/DASHBOARD_PAGES.md).
Coach/athlete map: [`docs/ROWPOD_ECOSYSTEM.md`](../../docs/ROWPOD_ECOSYSTEM.md).

## Local serve

```sh
cd web/ble_plotter
python -m http.server 8080
```

Open **http://localhost:8080/?v=1.5.6** (not `file://`). Hard-refresh if the
header is not **1.5.6**. Installed PWAs must be deleted and re-added when
the cache name changes (`rowpod-1.5.6`).

Old `/rowpod.html` bookmarks redirect here.

## Coach flow

1. **Add pod** once per oar (up to 6 links on one phone). After that, a reload
   reconnects those pods with no chooser. If the status line names
   `chrome://flags/#enable-web-bluetooth-new-permissions-backend`, set that
   flag to Enabled and relaunch Chrome. **Reconnect pods** retries any that
   were asleep.
2. Set boat class, Stroke sits, seat, and hand. Type inboard / outboard (cm).
3. Row. The first stroke centres the fan. Tap **Zero (measured)** only when you need degrees from a squared perpendicular pose.
4. **Start piece** → row → **Stop** → **Stroke CSV**.

In-sync % stays empty until two seats have a catch and a finish on a trusted
clock. iPhone Safari cannot use Web Bluetooth.

### Reconnect and stale streams

`navigator.bluetooth.getDevices()` only lists pods this origin already
paired. The page calls it on load; **Reconnect pods** runs the same path.

- The first reconnect may `watchAdvertisements` for 4 s. A timeout means the
  pod is asleep or out of range — wake it (hold GPIO0 ~2 s) and retry. The
  host does **not** watch once any pod is already live: a scan beside a live
  GATT link left the next pod's motion queue empty (1.5.5).
- While the next pod subscribes, live pods pause motion notifies, then the
  host rewrites the CCCD (`stop`/`startNotifications`) and resumes (1.5.6).
  **Add pod** while already connected uses a soft hold instead: CCCD stays
  on so firmware keeps sampling, and gap counters are ignored for that
  window. A hard pause on that path left the first pod **stale** /
  **degraded** forever.
- **stale** / **stale stream** means no motion frame for 1.5 s. Lifetime
  gaps stay in the lab integrity panel. Lab **degraded** uses recent misses
  and clears after about two seconds of clean frames (`rate × 2`).
- Lab **Forget** calls `BluetoothDevice.forget()` so auto-reconnect skips
  that pod until **Add pod** pairs it again. Plain **Remove** / Disconnect
  keeps the permission.

Unit tests (no browser):

```sh
node web/ble_plotter/protocol.test.js
node web/ble_plotter/rowing_angle.test.js
```

## IMU lab

Bring-up, overlay plots, orientation cube, HYROX, Mahony CSV, battery log:

**http://localhost:8080/lab.html?v=16.13**

That page is not the towpath UI. Do not fold HYROX or mag-cal into RowPod.

## Protocol

### Motion

- Service `9b7e1000-2b2f-4f71-9b86-4bb2e6d54f00`
- Notify `…1001`: one or more packed 20-byte LE frames (`seq + 9×int16`) — v1
- Notify `…1003`: one or more packed 22-byte LE frames (`sample_index + 9×int16`) — v16
- Read `…1002`: scale metadata (`flags` bit0 = multi mode)
- RowPod and the IMU lab prefer `…1003` when capabilities advertise it
- Notify `…1005`: 20-byte coach summary, one packet per finished stroke. The phone app does not subscribe. Capability flag `0x40` on `…2009` means it is present. The speed coach uses it instead of the raw stream

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
- Write `…200c`: speed-coach control. `1` zero, `2` + side byte (`0` stroke, `1` bow), `3` clear the in-progress stroke

### Rates

- RowPod live: **56 Hz** (`PROFILE_ROWING = 2`)
- Lab logging (CSV log and HYROX): **448 Hz** (one pod) or **224 Hz** (2+
  pods), 4 frames per notify. After `PREPARE`, the host waits 500 ms for a
  packet of exactly `batch × frame_len`. If any link drops it, capture
  restarts at **112 Hz** with one frame per notify.
- Software sync estimates clock offset for CSV; it is not sample-level IMU
  phase lock. RowPod stamps samples from a fitted `sample_index → host ms`
  model (see `docs/ROWING_SYNC.md`).

## Limits

- One browser gesture per newly permitted pod.
- Practical target: 2–4 pods at 56 Hz live.
- ATT MTU must be ≥25 to carry a single 22-byte v16 frame.
