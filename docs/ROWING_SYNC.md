# RowPod — oar angle and crew sync

Host UI version is **1.5.6** (`web/ble_plotter/version.js`). Major bumps (v2)
are a human decision; this file tracks what the current host actually does.

| Version | What changed |
|---------|----------------|
| 1.0.0 | First portrait PWA (oar angle + crew sync). |
| 1.0.1 | Stop integrating Mahony-differentiated gyro; yaw vs Zero. |
| 1.1.0 | Prefer v16 raw gyro · ĝ; stroke-midpoint lock; confidence chip. |
| 1.2.0 | Smooth DC (no finish jump); catch/finish state machine; blade feather in UI + CSV. |
| 1.3.0 | Boat class 2x–8+; per-seat stroke-side / bow-side; overlay sign from “Stroke sits”. |
| 1.4.0 | Honest Crew Clock: forward match; in-sync only with two complete seats and a trusted clock. |
| 1.4.1 | 180° fan (no bottom half); thick per-seat colour bars; larger catch/finish numbers. |
| 1.4.2 | Catch late/early vs stroke on the live page; does not wait for a finish. |
| 1.4.3 | Drive arc + blade metres from outboard; gated feather-on Δt vs stroke after finish. |
| 1.4.4 | Pages root is RowPod (`index.html`); IMU lab parked at `lab.html`. |
| 1.5.0 | Connect and go: first stroke centres the fan. Zero is measured-only. |
| 1.5.1 | Per-stroke SPM; gyro-propagated gravity; bias estimate (clamped ±5 deg/s). Drive index is unitless. |
| 1.5.2–1.5.3 | Live motion uses the host ATT MTU; skip the 2 s MTU poll when the host cannot raise it. |
| 1.5.4–1.5.6 | Reconnect known pods without the chooser. Pause + CCCD rewrite while the next pod subscribes so the second link is not an empty queue. |

RowPod turns the C3-Tracker pod into an **oar-mounted catch/finish angle
sensor**. Coaches and researchers get per-seat catch angle, finish angle, arc,
blade feather, and the timing spread of the crew.

The host UI is a portrait PWA: [`web/ble_plotter/index.html`](../web/ble_plotter/index.html).
Coach/athlete feature map and how we iterate: [`ROWPOD_ECOSYSTEM.md`](ROWPOD_ECOSYSTEM.md).
IMU lab (plots, HYROX, mag-cal CSV) lives at [`lab.html`](../web/ble_plotter/lab.html).
iPhone Safari has no Web Bluetooth; use **Android Chrome** or desktop
**Chrome/Edge**.

## What the number means

The pod straps to the **oar shaft, just inboard of the gate**. Catch and finish
are the usual rowing convention: degrees off perpendicular in the horizontal
plane (catch toward the bow, negative; finish toward the stern, positive).

Typical sculling / sweep targets sit around catch **−55° to −65°** and finish
**+30° to +40°**. **Arc** is finish − catch (the end-to-end drive rotation).
**Blade metres** are `outboard × arc_rad` about the pin — oar arc, not
distance through the water. **Feather-on** is the first |feather| up-cross
through 45° after finish; Δt vs stroke is blank if the blade never rolled or
if feather tracks the fan. Treat RowPod as a coaching aid, not a calibrated
Peach or NK replacement, until you have finished the bench checks below.

## Why not yaw from the magnetometer

The gate, pin, and rigger are steel. Mahony yaw is magnetometer-referenced and
will pull toward that iron. RowPod does **not** use yaw.

It uses the vertical component of angular velocity:

```
omega_vert = omega_body · g_hat_body
theta      = integral(omega_vert) dt
```

`g_hat_body` comes from a low-passed accelerometer (not magnetometer yaw).
The dot product is a scalar invariant to rotation about the shaft, so
feathering and how you clock the enclosure around the loom do not change
the **oar-angle** signal. Blade feather is tracked separately: after Zero,
gravity about the frozen shaft axis is 0° squared and ~90° fully feathered.
It is written to the dashboard and to `feather_catch_deg` /
`feather_finish_deg` in the CSV. A squared-only piece should sit near 0°.

Slow boat heading change sits far below stroke rate. Residual gyro bias is
absorbed by a stroke-midpoint lock (first complete stroke after Zero sets
the arc centre; later strokes leak DC toward that centre **during the drive
only**, so recovery from finish back through perpendicular does not jump).

The fused BLE frame omits raw gyro. RowPod **prefers v16 raw gyro** dotted
with a low-passed gravity estimate (`ω · ĝ`). That signal does not contain
Mahony's magnetometer yaw. A stroke-midpoint lock then holds the first complete
stroke's center (set by Zero + the first catch/finish pair) so residual gyro
bias cannot walk the fan off the diagram.

If the card says **mag yaw**, the browser fell back to fused quaternions —
treat catch degrees as low confidence and re-Zero often. **gyro lock** after
a few strokes is the high-confidence state: raw gyro, Zeroed, midpoint walk
under 8°.

Clock ±rms is a separate confidence for *timing*, not angle.

## Clocking the crew

BLE notify arrival time is batched (up to 8 frames share one `performance.now`)
and jittered by the connection interval. Adding the old `offsetMs` converted
host time *into each pod's device clock*, which pushed seats apart.

Each sync response already latches `(sample_index, device_us)`. The host
repeats that handshake every 4 s and fits

```
hostMs = a * sampleIndex + b
```

weighted by `1/rtt`. Every motion sample is then stamped from its own
`sample_index`. Residual one-sample latch delay is common-mode across pods at
the same ODR and cancels in catch-to-catch deltas.

The UI shows **clock ±rms ms** per seat. If that number is tens of milliseconds,
do not trust a 40 ms in-sync call.

Firmware v17 writes a 32-bit `sample_index` in bytes 16–19 of the sync
response. Older pods wrote a 16-bit seq plus pad zeros; the decoder still
accepts that until wrap (~20 min at 56 Hz).

## Zeroing

Connect and row. The pod has no absolute heading (no magnetometer, and the
pin is nearly vertical), so perpendicular is inferred from the stroke:

1. Mount the pod on the shaft, LED side in a repeatable orientation.
2. Pick **boat class** (2x … 8+) and **Stroke sits**, then assign each pod a
   **seat** and **stroke-side vs bow-side**. Sweep seats auto-fill the hand
   (stroke, 6, 4, 2 on stroke-side; 7, 5, 3, bow on bow-side). Scull defaults
   both blades to stroke-side so two scullers overlay; switch a pod to
   bow-side if it is on the other gunwale. Port/starboard for the gyro sign
   comes from hand + Stroke sits. Catch stays negative toward the **bow of
   the boat** on both hands, so the fan overlays instead of mirroring.
3. The first complete stroke centres that seat's arc on a nominal midpoint
   (sweep −12°, scull −10°) and sets feather 0° from the squared drive.
   Catch and finish **degrees** are estimates (`angle_ref=auto` in the CSV,
   `~` in the table). Timing, in-sync, SPM, and arc do not use this guess.
4. **Zero (measured)** is optional. Square the blade, hold the oar
   **perpendicular**, and tap it when you need degrees from that pose
   (`angle_ref=zero`). It replaces the auto centre for that pod.

Auto-centre puts every seat on the same midpoint. Arc length still shows who
is short. It cannot tell a catch that is short and a finish that is long
from an arc that is merely shifted. That split needs a measured Zero.

Re-zero if a pod is remounted. From 1.5.1 the host estimates gyro bias
(still periods, and stroke-to-stroke walk, clamped to ±5 deg/s) and
propagates gravity with the gyro instead of a fast accelerometer low-pass.
The midpoint lock is gentler (20% of the error per drive) so a real change
in where the arc sits is not pulled back on the next stroke.

**SPM** on the headline and in the `spm` column is one stroke:
60000 / (this reference catch − the previous one). A gap under 600 ms or
over 6 s is blank. `spm_avg5` is the older mean of up to five gaps.

**Drive index** is unitless. 100 means "about like this seat's first strokes
of the piece". It is the sum of ω² over the drive. It is not watts: the pod
never sees pin force, and on a bench the true power is about zero. Tip speed
(`tip_speed_mps`) is |peak ω| × outboard, a kinematic speed.

## Accuracy budget (honest)

| Source | Order of magnitude | Notes |
|--------|--------------------|--------|
| Reconstructed gyro vs raw | unknown until Phase 3 | Mahony corrections can soften ω. Check with a parallel v16 capture. |
| Q15 quantisation | ~0.2 deg/s | Small next to 150 deg/s drive. |
| Event interpolation | ~1–3 ms | Linear zero-crossing of ω between 56 Hz samples. |
| Software timebase | ~5–10 ms after a few fits | Dominates crew timing. Shown as clock ±rms. |
| Boat turning | degrees of arc leak | Judge sync on straight, steady-state pieces. |
| In-sync window | default 40 ms | Coach-set; not a physics constant. |

Catch/finish **timing spread** is the trustworthy crew metric. Absolute catch
**degrees** need the protractor check and a good Zero.

## Phone limits

Android Chrome typically holds **2–4** concurrent GATT connections reliably;
this repo already targeted that. An eight will not fit on one phone. Instrument
a pair, a double, a quad, or sampled seats (stroke + 3-seat + bow).

Live rate stays **56 Hz** in the rowing profile so the radio can serve several
pods. Do not turn on the 448 Hz HYROX capture policy for a crew.

## Bench, then water

Do these in order. Do not skip to an eight.

### 1. Protractor arc

Clamp one pod to a stick. Rotate a known angle (e.g. 0° → 60°) on a protractor
or marked floor. RowPod's live needle and, after a slow move that still exceeds
the 25 deg/s peak guard, the catch/finish pair should agree within a few
degrees. If the sign is wrong, switch Port/Starboard rather than remounting
yet.

### 2. Rigid bar (timebase isolation)

Clamp **two pods to one rigid bar**. Rotate the bar through a stroke-like arc.
Both seats must report nearly the same catch time. Software's synthetic version
of this test (`rowing_angle.test.js`) requires **< 15 ms** spread. On the bench,
expect similar once both clocks show a fitted ±rms of a few milliseconds. Any
large split here is **clock error**, not crew.

Session checklist (PWA version, Zero, pass/fail table):
[`ROWPOD_TOMORROW_CHECKLIST.md`](ROWPOD_TOMORROW_CHECKLIST.md).

### 3. Water

Only after (1) and (2): mount on the looms, Zero at perpendicular, start a
piece on a straight course, export **Stroke CSV**. Columns are long-format
(one row per seat per stroke) for researchers:

`stroke_index, seat, side, hand, pod_id, t_catch_ms, t_finish_ms, t_feather_ms,
catch_deg, finish_deg, arc_deg, blade_arc_m, feather_catch_deg, feather_finish_deg,
catch_dt_vs_ref_ms, finish_dt_vs_ref_ms, feather_dt_vs_ref_ms,
crew_catch_spread_ms, crew_finish_spread_ms, in_sync, match_quality, spm,
timebase_rms_ms, clock_status`

The CSV header also stamps `# rowpod_version=1.5.6`, `# boat_class=`,
`# stroke_sits=`, `# inboard_m=`, and `# outboard_m=`. `blade_arc_m` is
outboard × arc (radians); empty when a finish is missing. `t_feather_ms` is
the first |feather| up-cross through 45° after finish; empty when there is
no roll, the clock is untrusted, or feather tracks the fan. `side` is
port/starboard; `hand` is stroke-side or bow-side. `in_sync` is empty when
the stroke is not rated (single seat, missing finish, or untrusted clock).
`match_quality` and `clock_status` (`ok` or `UNTRUSTED_TIME`) explain why.

## Files

| Path | Role |
|------|------|
| `docs/ROWPOD_NEXT.md` | Next host slice 1.6 feather flags (1.5 connect-and-go shipped) |
| `web/ble_plotter/index.html` | RowPod PWA (site root) |
| `web/ble_plotter/lab.html` | IMU lab (plots, HYROX, mag-cal) |
| `web/ble_plotter/timebase.js` | `sample_index` → host ms |
| `web/ble_plotter/boat_rig.js` | Boat class, stroke/bow hand, port/starboard |
| `web/ble_plotter/rowing_fan.js` | 180° overlay geometry |
| `web/ble_plotter/rowing_crew.js` | matching, in-sync %, CSV |
| `web/ble_plotter/rowing_length.js` | drive arc and blade metres from outboard |
| `web/ble_plotter/version.js` | `ROWPOD_VERSION` |
| `web/ble_plotter/ble_client.js` | GATT, `getDevices` reconnect, CCCD pause/rewrite |
| `web/ble_plotter/pod_registry.js` | multi-pod sessions, `reconnectKnown`, soft hold vs hard pause |
| `components/sensor_protocol` | `PROFILE_ROWING = 2` |

```sh
node web/ble_plotter/protocol.test.js
node web/ble_plotter/rowing_angle.test.js
```
