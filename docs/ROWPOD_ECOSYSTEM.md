# RowPod ecosystem — coaches, athletes, and how we are building it

**Status:** RowPod host **1.4.4** (17 September 2026).  Pages root is RowPod; IMU lab is `lab.html`.  
**Hardware:** C3-Tracker pod (ESP32-C3FH4, QMI8658A IMU, QMC5883P magnetometer).  
**This document** is the product-level map: what the whole stack does for a
rowing coach or athlete, what is trustworthy today, and how development is
actually proceeding. Protocol and accuracy detail lives in
[`ROWING_SYNC.md`](ROWING_SYNC.md).

Treat RowPod as a **coaching aid**, not a calibrated Peach or NK replacement,
until the bench checks in that file are done on your own pods.

---

## 1. What this ecosystem is

One **wearable IMU pod** per instrumented oar, talking over **Bluetooth Low
Energy** to a **browser** (no native iOS/Android app). The same firmware also
feeds a lab dashboard used for bring-up, HYROX-style training experiments, and
raw CSV capture. Rowing coaches live in the portrait **RowPod** page.

```
Oar shaft  →  C3-Tracker pod  →  BLE (56 Hz live)  →  Chrome / Edge
                                                    ├─ RowPod PWA     (towpath)
                                                    └─ Lab dashboard  (debug / HYROX)
```

| Piece | Role for rowing |
|--------|------------------|
| Pod firmware | Samples IMU on a native clock, advertises as `C3-T-XXXX`, streams raw gyro (v16) or fused attitude, battery, and a software sync handshake. |
| Rowing profile (`PROFILE_ROWING = 2`) | Host tag: keep **56 Hz** so several pods can share the radio. Not the 448 Hz HYROX capture policy. |
| RowPod PWA (`index.html`) | Catch/finish angles, crew overlay, in-sync %, stroke CSV. |
| IMU lab (`lab.html`) | Fleet health, raw plots, orientation cube, HYROX, session CSV, battery tests. |

**Not in this product yet:** on-pod flash logging of strokes, an iPhone Safari
client (no Web Bluetooth), eight concurrent GATT links on one phone, or a
claimed replacement for a seat-box / NK / Peach system.

---

## 2. Who it is for

### Coach (primary)

Stand on the bank or in the launch with a phone or laptop. See **whether the
crew is together in time**, and **who is short at catch or hanging at finish**,
without watching eight looms one at a time.

Typical questions RowPod is built to answer:

- Who is late to the catch relative to stroke?
- Who is not reaching as far (shallower catch angle)?
- Who is extracting late (deeper / later finish)?
- Is the crew inside a chosen window (default **40 ms**), and for what fraction
  of the piece?
- After the piece: a CSV a researcher or senior coach can open in Excel.

### Athlete

Same numbers, smaller crew. A pair or double can Zero, row a piece, and see
whether their catches land together and whether one person is giving up length.
Scullers can put a pod on one blade (usually both athletes on the **same
gunwale**) and compare without a coach in the boat.

### Researcher / developer

Long-format per-seat-per-stroke CSV, clock ±rms on every row, boat class and
rig stamped in the header. The lab dashboard still exists for IMU/mag plots and
integrity when something looks wrong on the water.

---

## 3. Features a coach or athlete can use today (RowPod 1.4.4)

### 3.1 Live picture

- **Fan diagram** — 180° overlay (catch −90° left to finish +90° right). **Catch toward the bow
  is left**, finish toward the stern is right, 0° is perpendicular. Port and
  starboard are inverted in software so both hands sweep the **same way**. That
  is a coaching overlay, not a cox’s-eye view of the boat.
- **Colour bars per seat** — thick last-stroke arc with catch° and finish° on the ends.
- **CATCH / FINISH labels** on the fan so “left” means length, not a math sign.
- **Live needle** plus last-stroke arc (catch and finish dots).
- **Blade tick** on the needle: full when squared, edge-on near 90° feather.

### 3.2 Headlines

| KPI | Meaning |
|-----|---------|
| **In sync %** | Share of *rated* strokes (two complete seats + trusted clock) whose catch spread is inside the coach-set window. Shows **—** when nothing is rated. |
| **Catch vs stroke** | Who is early or late to the catch vs the stroke seat, in milliseconds. Shown as soon as two catches land on the same stroke. Hundreds of ms is not a crew miss. |
| **Arc / blade** | Last matched stroke’s drive rotation (finish − catch) and blade arc in metres (outboard × θ_rad). Empty until that stroke has a finish. Not distance through the water. |
| **SPM** | Stroke rate from the reference seat (stroke if assigned). |
| **Catch / finish spread** | Time between earliest and latest seat on that end of the stroke. |
| **Strokes** | Matched stroke count this piece. |
| **Feather** | Live rotation about the shaft after Zero (0° = squared). |

The in-sync **window is a coaching choice** (10–80 ms, default 40). It is not a
physics constant.

### 3.3 Per-seat table

Last stroke vs the reference: catch°, finish°, arc, **length** (blade metres),
**feather Δt** vs stroke (roll after finish), **vs stroke** (catch early/late
ms), Δ finish ms, **clock ±rms**. Feather Δt is blank when there is no 45°
cross, the clock is untrusted, or feather tracks the fan (`feather?`). The
vs-stroke column only uses that matched stroke’s catch — not a leftover
last-catch from another stroke.

### 3.4 Boat and rig (why 5 and 6 stopped looking “backwards”)

Port and starboard oars rotate opposite ways in the world. The fan would look
like two crews fighting unless the host flips one sign.

| Control | What the coach sets |
|---------|---------------------|
| **Boat** | 2x, 2−, 2+, 4x, 4−, 4+, 4x+, 8+ (scull vs sweep is implied). Seat lists shrink to that boat. |
| **Stroke sits** | Port or starboard — which gunwale the stroke’s oar is on (standard vs opposite rig). |
| **Seat** | stroke / 7 / … / bow as allowed by the class. |
| **Sample** | Which connected seats appear on the fan and in the matcher (pair / stroke+3+bow / stroke+4+2). Still 2–4 radios. |
| **Hand** | **Stroke side** or **bow side** (which gunwale this pod is on). |

Sweep seats auto-fill hand: stroke, 6, 4, 2 → stroke-side; 7, 5, 3, bow →
bow-side. Scull defaults **both** pods to stroke-side (same blade side) so two
scullers overlay; switch a pod to bow-side only if it is on the other gunwale.

The UI still shows derived **port/starboard** in small type. Gyro sign uses
that. Catch stays **negative toward the bow** on both hands.

Stroke-side is **not** “catch toward the bow”. One is which rigger; the other
is where the blade is in the stroke.

### 3.5 Session flow

1. Wake pods (hold the button ~2 s from light sleep). Open RowPod on
   **Android Chrome** or desktop **Chrome/Edge** over HTTPS or `localhost`.
2. **Add pod** once per oar (target **2–4** links; an eight will not fit on one
   phone).
3. Set boat class and Stroke sits. Assign seats and hands.
4. Type **inboard / outboard** (cm). Outboard is pin to blade tip; it scales
   blade metres. Changing scull ↔ sweep fills defaults unless you typed spans.
5. Square the blades, hold **perpendicular**, tap **Zero**. That sample is 0°
   oar angle and 0° feather.
6. **Start piece** → row → **Stop**. Watch spread, arc, and who is short.
7. **Stroke CSV** — long format, one row per seat per stroke, filename
   `rowpod_1.4.4_strokes_….csv`.

Re-Zero after remounting or a long piece if absolute catch degrees have walked.
**Arc** (finish − catch) is more robust than the absolute catch number.

### 3.6 What the CSV is for

After the piece, not during it. Columns include seat, port/starboard, hand,
catch/finish time and angle, arc, blade metres, feather at catch and finish,
feather-on time and Δt vs stroke, deltas vs the reference seat, crew spread,
in-sync flag (empty when not rated), match quality, SPM, timebase rms, and
clock status.

Header stamps `rowpod_version`, `boat_class`, `stroke_sits`, `inboard_m`, and
`outboard_m`.

Use it to: plot catch angle over the piece, find who faded, compare two
outings, or hand data to a sports scientist. Do not treat a 600 ms “spread” as
crew truth until you have checked that both seats have a catch **and** a finish
on that stroke (see §6).

### 3.7 Confidence on the pod card

| Chip | Meaning |
|------|---------|
| **Zero first** | Do not coach from degrees yet. |
| **mag yaw** | Browser fell back to fused quaternions. Catch degrees are low confidence near iron (gate, pin, rigger). Re-Zero often. |
| **gyro settling** | Raw gyro, few complete strokes of lock. |
| **gyro lock** | Preferred: raw gyro, Zeroed, midpoint walk under 8°. |
| **clock ±N ms** | Timing confidence, separate from angle. |
| **feather?** | Live feather moved with the fan on the first drives after Zero. Do not coach Feather Δt. |

RowPod **prefers v16 raw gyro · gravity**. It does not integrate magnetometer
yaw for oar angle. Feather is a **separate** gravity-about-shaft signal.

---

## 4. How to instrument a crew (practical limits)

- **Mount:** pod on the **oar shaft, inboard of the gate**, repeatable LED
  orientation.
- **How many pods:** 2–4 on one Android phone or laptop is the design point.
  Sample an eight (stroke + 3-seat + bow, or a pair) rather than all eight.
- **Phone:** Android Chrome, or a laptop in the launch. **iPhone Safari cannot
  connect.** A PWA install on Android still needs Chrome’s Web Bluetooth.
- **Hosted UI:** GitHub Pages  
  `https://mhyeung.github.io/ESP32C3_MotionTracking_Gadget/?v=1.4.4`  
  Local: `http://localhost:8080/?v=1.4.4` after
  `python -m http.server 8080` in `web/ble_plotter/`.
- **Firmware:** flash once with ESP-IDF; most RowPod angle/UI work is
  **host-only** (hard-refresh the page). Profile 2 and 32-bit sync seq need a
  recent firmware image.

Suggested first crews: 2− / 2x on the water, then a four, then sampled seats in
an eight. Do not start with eight pods.

---

## 5. The rest of the ecosystem (not the towpath UI)

The same pod is a general athletic tracker. Coaches who only row can ignore
this section; it matters when a pod “misbehaves” or when the group also trains
HYROX.

| Surface | Athlete / coach value |
|---------|------------------------|
| **Summary** | Battery, rate, gaps, stream health — “is this pod actually on?” |
| **Plots** | Accel / gyro / mag overlay — mount check, clipping, magnetic corruption. |
| **Orientation cube** | On-device Mahony attitude — useful on a bench, **not** the oar angle. |
| **CSV log** | Full motion capture with session lifecycle (prepare / start / drain). |
| **HYROX tab** | Candidate reps and work/rest on body-worn pods. Station estimates are **not** official timing. |
| **Battery test** | Endurance characterisation of the pack. |
| **Button** | Connected: tap pauses/resumes streaming. Sleep: ~2 s hold to wake. |
| **Rename** | Advertised name in NVS (max 20 chars) so “stroke” vs “C3-T-18262” in the picker. |

Trajectory / room-position reconstruction is a **lab** workflow
([`TRAJECTORY_CAPTURE.md`](TRAJECTORY_CAPTURE.md)), not a rowing metric.

---

## 6. What to trust, and what not to

**More trustworthy**

- Catch-to-catch **timing spread** once both clocks show a few milliseconds rms
  and both seats actually have events on that stroke.
- **Arc length** after a clean Zero, even if absolute catch walks slowly.
- Two pods on **one rigid bar** agreeing in time (isolates clock from crew).

**Needs a good Zero and a still-ish boat**

- Absolute catch and finish **degrees**. Targets around catch −55° to −65° and
  finish +30° to +40° are coaching language, not a factory calibration.

**Easy to misread**

- **Opposite needles** with both dropdowns left on starboard: physics, not two
  different strokes. Set boat class + hand (1.3.0) or you will coach a mirror.
- **~500–700 ms catch spread** at ~40 spm: often the matcher pairing the
  *next* stroke of one seat with the *current* stroke of another, or a missed
  finish. Look at the CSV for empty `t_finish_ms` and reused catch times. A
  real crew is not half a second apart.
- **100% in sync** when only one seat has a catch: the other pod was missing;
  that is not a tight crew.
- **Feather** during a squared-only piece should sit near 0°. If it tracks the
  fan angle, Zero picked a poor shaft axis — say so; do not coach blade work
  from it yet.
- **SPM** inflated when extra catches fire (state machine in 1.2.0 reduced
  this; it is not gone if ω chatters).

Honesty on the accuracy budget is in [`ROWING_SYNC.md`](ROWING_SYNC.md)
(event interpolation ~1–3 ms; software timebase often 5–10 ms and dominates
crew timing).

---

## 7. Current development process

This is how the project is actually moving, so a coach or a contributor knows
what “we shipped 1.4.0” means.

### 7.1 Split of labour

| Layer | Change cost | Typical work |
|-------|-------------|--------------|
| **Firmware** (ESP-IDF components under `components/`) | Flash every pod | Radio, sample clock, v16 frames, profile 2, battery, sleep. |
| **RowPod host** (`web/ble_plotter/rowpod*`, `rowing_*.js`) | Refresh the page | Angle, events, crew match, fan, CSV, boat class. |
| **Lab host** (`lab.html`, `app.js`) | Same Pages deploy | Debug and HYROX. |

RowPod v1 was specified as **host-owned angle**: the pod sends IMU; the
browser integrates `ω · ĝ`, finds catch/finish, and matches the crew. That
lets a water test in the afternoon change the detector **without** a firmware
campaign.

Firmware still matters when the host needs **raw gyro** (fused BLE frames omit
it) and a **32-bit sample index** in the sync response so clocks do not wrap
mid-outing.

### 7.2 Versioning (RowPod host)

Defined in `web/ble_plotter/version.js`. **Major (v2) is a human decision** —
platform breaks (native app, new radio, new mount) — not an automatic bump.

| Version | Why it existed |
|---------|----------------|
| 1.0.0 | First portrait PWA: fan, seats, crew sync, CSV. |
| 1.0.1 | Stopped integrating Mahony-differentiated “gyro” (it walked with the mag). |
| 1.1.0 | Prefer v16 raw gyro; stroke-midpoint lock; confidence chip. |
| 1.2.0 | No finish jump (DC leaks on the drive only); catch/finish state machine; blade feather. |
| 1.3.0 | Boat class 2x–8+; stroke-side / bow-side; overlay sign from “Stroke sits”. |
| 1.4.0 | Honest Crew Clock: forward match; in-sync cannot score a single seat or a missing finish. |
| 1.4.1 | 180° fan; thick per-seat colour bars with catch/finish numbers on the overlay. |
| 1.4.2 | Catch late/early vs stroke on the live page; finish not required for that cue. |
| 1.4.3 | Drive arc + blade metres; gated feather-on timing vs stroke after finish. |
| 1.4.4 | Pages root is RowPod; IMU lab parked at `lab.html`. |

Patches (1.0.x) are small detector/UI fixes. Minors (1.1–1.4) are
behaviour a coach will notice. The PWA cache name and `?v=` query follow the
same number so phones do not keep yesterday’s JavaScript.

### 7.3 How a change gets trusted

1. **Unit tests** (no boat):  
   `node web/ble_plotter/rowing_angle.test.js`  
   `node web/ble_plotter/protocol.test.js`  
   Synthetic sine strokes, timebase fit, rigid-bar timing, gyro bias lock,
   feather LP, boat-class mapping.
2. **Bench** — protractor arc, then two pods on one stick (clock vs crew).
3. **Water / tank CSV** — real catch/finish, then we read the file (walk,
   double-catches, opposite needles) before the next minor.
4. **Pages deploy** — push `web/ble_plotter/`; firmware stays in the repo and
   is not the Pages artifact.

We do **not** skip to an eight. Phone radio and matching both fail open if you
do.

### 7.4 Firmware engineering rules (why the pod behaves this way)

gstack / this repo: one I2C owner task (never IMU from a BLE callback),
`ESP_ERROR_CHECK` on SDK calls, `ESP_LOG*` not `printf`, public APIs only
through `components/<name>/include/`. Live notifies batch frames; high-rate
capture waits for TX complete so a drop is a small hole. Those constraints are
why live rowing stays at 56 Hz and why the host reconstructs time from
`sample_index` instead of “when the phone saw the packet.”

### 7.5 What we learned from the first water CSVs (process, not folklore)

- Integrating fused-quat differences **double-counted** Mahony’s mag/accel
  corrections → catch walked tens of degrees in half a minute. **Fix: raw
  gyro.**
- Snapping DC at **finish** made recovery (+45° → 0) jump and drive look fine.
  **Fix: leak DC only while ω > 0.**
- Extra ω up-crossings ~400 ms after catch created CSV rows with no finish.
  **Fix: catch ↔ finish state machine.**
- Two seats tagged starboard on opposite gunwales: CSV still showed negative
  catch on both (each pod names *its* up-cross), but **live needles opposed**.
  **Fix: boat class + hand (1.3.0).**

That loop — **CSV in, hypothesis, host patch, version bump, CSV out** — is the
current development process.

---

## 8. Suggested validation sequence (coach or athlete)

Copy this; it is the same ladder the software is tested against.

1. **One stick, protractor** — 0° → 60°. Needle and a slow catch/finish pair
   should agree within a few degrees. Wrong sign → hand / Stroke sits, not
   glue.
2. **Two pods, one rigid bar** — same motion. Catch times should agree to
   roughly the clock ±rms (software test allows &lt; 15 ms). A large split here
   is **clock**, not crew.
3. **Two people, 2x or 2−**, straight piece, Zero at perpendicular, export CSV.
   Confirm hands overlay, finishes populated, spread is tens of ms not
   hundreds.
4. **Sampled eight** (stroke + middle + bow) only after (3) looks sane.

---

## 9. Open work (honest backlog)

Canonical next-step brief (priority, non-negotiables, done-when tests):
[`ROWPOD_NEXT.md`](ROWPOD_NEXT.md).

**Human gate:** 1.3 overlay confirmed on water. Host 1.4 matcher is in the
tree; confirm on a new CSV (no 500 ms alias, empty `in_sync` without two
finishes). Firmware major / v2 remains an owner decision.

| Slice | Host | Coach question |
|-------|------|----------------|
| **A** | 1.4 Honest Crew Clock **shipped** | Who is late vs stroke, and is the crew inside *my* window? Confirm on water CSV. |
| **B** | 1.5 Feather + blade flags | Square before catch? Wash / lock-delay? Open blade vs short catch? After A. |
| **C** | 1.6 CSV review | Who faded in the last third? Rolling in-sync. Relative drive-rate overlay. No watts. After A. |

Still true from the 1.3.0 CSVs:

- Cox-view diagram only as a **toggle**, never the default overlay.
- PWA cache must not mix a new `rowpod.js` with an old `rowing_crew.js`.
- More than 4 pods needs a different host, not a settings tweak.

Out of scope until A and B are boring: on-device ML, native app, eight GATT
links on one phone, predicted watts.

Major version **2** (new mount, native app, CSV/protocol break) stays with the
project owner.

---

## 10. Where to read next

| Doc | When |
|-----|------|
| [`ROWPOD_NEXT.md`](ROWPOD_NEXT.md) | Next slices (1.4–1.6), gates, what not to build. |
| [`DASHBOARD_PAGES.md`](DASHBOARD_PAGES.md) | Hosting the UI on GitHub Pages. |
| [`SESSION_PROTOCOL.md`](SESSION_PROTOCOL.md) | BLE versions, capture lifecycle, sample index. |
| [`HYROX_TRAINING.md`](HYROX_TRAINING.md) | Body-worn training on the same pod. |
| [`../README.md`](../README.md) | Build/flash, repo layout. |
| [`../web/ble_plotter/README.md`](../web/ble_plotter/README.md) | RowPod serve URL; IMU lab is `lab.html`. |
| [`LAB_DASHBOARD.md`](LAB_DASHBOARD.md) | Lab capture flow, caches, HYROX knobs. |
| [`SENSOR_SAMPLING.md`](SENSOR_SAMPLING.md) | I2C owner, IMU/mag ODR, INT2 DRDY. |

Firmware: ESP-IDF 6.x, target `esp32c3`, `idf.py build flash monitor`.
