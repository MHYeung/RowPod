# RowPod — oar angle and crew sync

Host UI version is **1.3.0** (`web/ble_plotter/version.js`). Major bumps (v2)
are a human decision; this file tracks what the current host actually does.

| Version | What changed |
|---------|----------------|
| 1.0.0 | First portrait PWA (oar angle + crew sync). |
| 1.0.1 | Stop integrating Mahony-differentiated gyro; yaw vs Zero. |
| 1.1.0 | Prefer v16 raw gyro · ĝ; stroke-midpoint lock; confidence chip. |
| 1.2.0 | Smooth DC (no finish jump); catch/finish state machine; blade feather in UI + CSV. |
| 1.3.0 | Boat class 2x–8+; per-seat stroke-side / bow-side; overlay sign from “Stroke sits”. |

RowPod turns the C3-Tracker pod into an **oar-mounted catch/finish angle
sensor**. Coaches and researchers get per-seat catch angle, finish angle, arc,
blade feather, and the timing spread of the crew.

The host UI is a portrait PWA: [`web/ble_plotter/rowpod.html`](../web/ble_plotter/rowpod.html).
Coach/athlete feature map and how we iterate: [`ROWPOD_ECOSYSTEM.md`](ROWPOD_ECOSYSTEM.md).
The existing lab dashboard is unchanged. iPhone Safari has no Web Bluetooth;
use **Android Chrome** or desktop **Chrome/Edge**.

## What the number means

The pod straps to the **oar shaft, just inboard of the gate**. Catch and finish
are the usual rowing convention: degrees off perpendicular in the horizontal
plane (catch toward the bow, negative; finish toward the stern, positive).

Typical sculling / sweep targets sit around catch **−55° to −65°** and finish
**+30° to +40°**. Treat RowPod as a coaching aid, not a calibrated Peach or NK
replacement, until you have finished the bench checks below.

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

1. Mount the pod on the shaft, LED side in a repeatable orientation.
2. Square the blade. Hold the oar **perpendicular** to the boat.
3. Tap **Zero**. That sample becomes 0° oar angle and 0° feather (squared).
4. Pick **boat class** (2x … 8+) and **Stroke sits** (port or starboard).
   Assign each pod a **seat** and **stroke-side vs bow-side**. Sweep seats
   auto-fill the hand (stroke, 6, 4, 2 on stroke-side; 7, 5, 3, bow on
   bow-side). Scull defaults both blades to stroke-side so two scullers
   overlay; switch a pod to bow-side if it is on the other gunwale.
   Port/starboard for the gyro sign is derived from hand + Stroke sits.
   Catch is still negative toward the **bow of the boat**, on both hands,
   so the fan overlays instead of mirroring.

Re-zero if a pod is remounted or the piece is long enough that residual gyro
bias (clamped to ±5 deg/s, estimated from catch-to-catch walk) has eaten the
absolute scale. Arc length (finish − catch) is robust to a slow walk; the
absolute catch number is not.

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

### 3. Water

Only after (1) and (2): mount on the looms, Zero at perpendicular, start a
piece on a straight course, export **Stroke CSV**. Columns are long-format
(one row per seat per stroke) for researchers:

`stroke_index, seat, side, hand, pod_id, t_catch_ms, t_finish_ms, catch_deg,
finish_deg, arc_deg, feather_catch_deg, feather_finish_deg,
catch_dt_vs_ref_ms, finish_dt_vs_ref_ms,
crew_catch_spread_ms, crew_finish_spread_ms, in_sync, spm, timebase_rms_ms`

The CSV header also stamps `# rowpod_version=1.3.0`, `# boat_class=`, and
`# stroke_sits=`. `side` is port/starboard; `hand` is stroke-side or bow-side.

## Files

| Path | Role |
|------|------|
| `docs/ROWPOD_NEXT.md` | Next host slices 1.4–1.6 (gated) |
| `web/ble_plotter/timebase.js` | `sample_index` → host ms |
| `web/ble_plotter/boat_rig.js` | Boat class, stroke/bow hand, port/starboard |
| `web/ble_plotter/rowing_crew.js` | matching, in-sync %, CSV |
| `web/ble_plotter/version.js` | `ROWPOD_VERSION` |
| `components/sensor_protocol` | `PROFILE_ROWING = 2` |

```sh
node web/ble_plotter/protocol.test.js
node web/ble_plotter/rowing_angle.test.js
```
