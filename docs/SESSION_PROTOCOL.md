# Session and status protocol

The pod keeps the legacy 20-byte motion frame for v15 clients and adds an
additive v16 path with 32-bit sample indexing, capability negotiation, and a
real drain barrier. The host owns CSV storage; the pod supplies capture
boundaries and diagnostics.

## Protocol versions

| Version | Motion | Session / status | Notes |
|---------|--------|------------------|-------|
| v1 | `…1001` 20 B (`uint16 seq` + 9×int16) | `…2007` 8 B / `…2008` 36 B | Preserved for older dashboards |
| v16 | `…1003` 22 B (`uint32 sample_index` + 9×int16) | `…200a` 12 B / `…200b` 56 B | Raw IMU+mag path |
| fused | `…1004` 24 B (`uint32 sample_index` + Q15 quat + accel + mag) | same v16 session/status | On-device Mahony; gyro stays on the C3 |

Read-only capabilities live at `…2009` (20 B) and advertise supported formats,
rate mask, max batch frames, IMU/MAG ODRs, ATT MTU, and queue depth.

## GATT characteristics (additive)

### Motion

- `9b7e1001-…` — legacy notify/read, 20-byte frames (batched by MTU)
- `9b7e1003-…` — v16 notify/read, 22-byte frames (batched by MTU)
- `9b7e1004-…` — fused notify/read, 24-byte frames (Q15 quaternion + accel + mag)
- When more than one motion CCCD is enabled, firmware prefers fused, then v16,
  then v1, so radio load is not doubled
- Capture at ≥224 Hz packs 4 fused frames (~112 notifies/s at 448 Hz) or 2 v16
  frames, and waits for `NOTIFY_TX` between batches

### Configuration

- `…2007` / `…2008` — legacy session command / status
- `…2009` — capabilities
- `…200a` — v16 session command:
  `ver=2`, `command`, `rate_hz`, `flags`, `capture_id`, `command_id`
- `…200b` — v16 session status (56 B): requested vs applied rate, error reason,
  command id, 32-bit first/produced/sent/final sample indices, queue depth and
  high-water mark, drop counters, ATT MTU, battery, mag rate

Status flags include `has_samples`, `drain_done`, and `rate_applied`.
Notifications are used when the negotiated ATT MTU can carry the full status;
the read path remains canonical on small-MTU links.

## Capture lifecycle

The dashboard executes this sequence for every connected pod:

1. **Preflight**: read capabilities / status MTU and warn before high-rate starts.
2. `PREPARE`: assign one non-zero `capture_id`, choose the sensor-native rate,
   reset per-capture counter baselines, clear the transport queue, enter
   `prepared`.
3. `START`: enter `recording`; the first accepted sample becomes `first_sample`.
4. `BIAS_START` and `MOTION`: browser phases are recorded in the CSV while the
   pod remains in `recording`.
5. `STOP`: enter `stop_requested` while the two-second end-stillness interval
   continues to accept capture samples.
6. `DRAIN`: stop accepting new transport frames, flush the notification/retry
   queue, freeze `final_sample = last_sent`, and set `drain_done`.
7. `FINALIZE`: allowed only when `drain_done` is set and the queue is empty.
   Preserve the final status snapshot, stop CSV capture, and restore the 56 Hz
   live-monitor rate on the host.

If a lifecycle command fails, the host sends `ABORT` best effort and does not
claim that the capture finalized successfully.

## Sample clock

The internal sample index is a monotonic `uint32` advanced for every DRDY slot,
including coalesced DRDY events and failed sensor reads. Legacy v1 frames carry
only the low 16 bits. The v16 dashboard reconstructs logical indices and reports
`missing_frames` separately from gap-event counts.

Requested rate writes are applied asynchronously by the I2C-owning task.
`rate_epoch` increments only after the applied IMU rate changes.

Supported sensor-native rates are 56, 112, 224, and 448 Hz. One-byte GATT
rate fields cannot store 448, so that profile is encoded as wire value `255`
(`rate_mask` bit 3). Hosts must decode `255 → 448` before computing `sample_ms`.

Magnetometer ODR is paired in the I2C task (not independently writable):

| IMU | Mag | Notes |
|-----|-----|-------|
| 56 Hz | 50 Hz | live monitor / RowPod |
| 112 Hz | 100 Hz | multi-pod log |
| 224 Hz | 200 Hz | high-rate |
| 448 Hz | 100 Hz | ~10 ms heading correction; mag I2C is strided |

On-device Mahony (`…1004`) consumes gyro and omits it from the notify. See
[`MAHONY_AHRS.md`](MAHONY_AHRS.md).

## Workout profile (`…2006`)

One-byte read/write. Rejected while a capture is active.

| Value | Name | Firmware rate side-effect |
|-------|------|---------------------------|
| 0 | general | 56 Hz live |
| 1 | HYROX | requests 448 Hz capture policy; reps stay host-side |
| 2 | rowing | stays 56 Hz so several oars can share one phone radio |

RowPod writes `2` after connect. The lab HYROX tab writes `1`. Metrics and UI
remain in the browser (`hyrox.js` / `rowing_angle.js`).

## BLE link and notify batching

On connect the pod:

1. Requests a **7.5–15 ms** connection interval (up to three times if the host
   settles slower than 15 ms). Latency 0; supervision timeout 4 s; CE length
   long enough for a 2-frame notify.
2. Requests DLE `251 / 2120 µs`.
3. **Initiates ATT MTU exchange.** Windows/Chrome often never start it; default
   ATT MTU 23 cannot carry a 22-byte v16 frame (`23 − 3 = 20`).
4. `sdkconfig.defaults` prefers MTU 247; the central may still leave 23.

Batching (`ble_tracker.c`):

| Mode | Max frames / notify | Wait |
|------|---------------------|------|
| Live (typically 56 Hz) | up to 8, limited by `(ATT_MTU − 3) / frame_len` | next batch after `NOTIFY_TX` |
| Capture ≥224 Hz, v16 | 2 | same |
| Capture ≥224 Hz, fused | 4 (~112 notifies/s at 448 Hz) | same |

Transport queue is 96 samples; overflow drops the oldest and increments
`transport_dropped`. Advertising interval is 100 ms.

ESP-IDF 6 NimBLE emits `BLE_GAP_EVENT_NOTIFY_TX` **synchronously** inside
`ble_gatts_notify_custom` (“attempted”), unlike IDF 5 which deferred until the
controller sent the PDU. Firmware must mark notify-inflight *before* that call;
setting it after return deadlocks one notify and fills the 96-deep queue
(browser sees a stale 0 Hz stream).

## CSV provenance

CSV v7 logs on-device Mahony `qw,qx,qy,qz`, body accel, and the mag vector the
filter consumed. `sample_index`, `missing_frames`, `gap_events`, and the three
device drop counters remain for integrity. Raw, clean, cal, reconstructed gyro,
and per-row session snapshots were dropped; those belong in status CSV or
headers. `arrival_ms` remains useful for browser-latency diagnostics;
`sample_ms` is derived from `sample_index` and the rate epoch. v6 files still
reconstruct via host AHRS when gyro columns are present.

## Software sync (`…2003`)

Request: 8-byte `uint64 client_ms`. Response: 20 bytes —
`client_ms`, `device_us` (`esp_timer_get_time`), then a **32-bit
`sample_index`** at offset 16. Older firmware wrote a 16-bit seq plus two pad
zeros; hosts must still accept that. RowPod fits `hostMs = a * sampleIndex + b`
from repeated exchanges instead of timestamping BLE notify arrival.
