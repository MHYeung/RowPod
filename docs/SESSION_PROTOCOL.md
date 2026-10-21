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

Byte 6 `mag_rate_hz` is 50, 100, or 200 on v1 pods and **0 on RowPod v2**
(no magnetometer). Hosts use `mag_rate_hz > 0` as `hasMag`. Do not add a
capability flag for this: v1 pods that are never reflashed would not set it.
Byte 7 `hw_rev` was reserved and is 0 on v1 firmware; hosts read 0 as hardware
v1. v2 firmware writes 2. Motion frames stay the same size; v2 mag fields are
zero. A v2 deep-sleep wake resets the chip, so `sample_index` starts again at 0
and capture state does not survive sleep. Hosts treat every connection as a
new clock.

## GATT characteristics (additive)

### Motion

- `9b7e1001-…` — legacy notify/read, 20-byte frames (batched by MTU)
- `9b7e1003-…` — v16 notify/read, 22-byte frames (batched by MTU)
- `9b7e1004-…` — fused notify/read, 24-byte frames (Q15 quaternion + accel + mag)
- `9b7e1005-…` — coach summary notify/read, 20 bytes, one packet per finished stroke (not batched). Layout is in the speed-coach `docs/ble_sensors.md`. Capability bit `0x40`
- `9b7e200c-…` — coach control write: zero / set side / clear. The phone app does not use it
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
