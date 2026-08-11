# Session and status protocol

The pod keeps the legacy 20-byte motion frame for v15 clients and adds an
additive v16 path with 32-bit sample indexing, capability negotiation, and a
real drain barrier. The host owns CSV storage; the pod supplies capture
boundaries and diagnostics.

## Protocol versions

| Version | Motion | Session / status | Notes |
|---------|--------|------------------|-------|
| v1 | `…1001` 20 B (`uint16 seq` + 9×int16) | `…2007` 8 B / `…2008` 36 B | Preserved for older dashboards |
| v16 | `…1003` 22 B (`uint32 sample_index` + 9×int16) | `…200a` 12 B / `…200b` 56 B | Preferred by dashboard v16 |

Read-only capabilities live at `…2009` (20 B) and advertise supported formats,
rate mask, max batch frames, IMU/MAG ODRs, ATT MTU, and queue depth.

## GATT characteristics (additive)

### Motion

- `9b7e1001-…` — legacy notify/read, 20-byte frames (batched by MTU)
- `9b7e1003-…` — v16 notify/read, 22-byte frames (batched by MTU)
- When both CCCDs are enabled, firmware prefers the v16 characteristic to
  avoid doubling radio load

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

## CSV provenance

CSV v6 adds `sample_index`, `missing_frames`, `gap_events`, protocol version,
applied rate, ATT MTU, produced/sent/final sample boundaries, drain completion,
and queue high-water fields. `arrival_ms` remains useful for browser-latency
diagnostics; `sample_ms` is derived from `sample_index` and the rate epoch.
