# RowPod — next development (ingested brief)

**Ingested:** 1 September 2026 from `AGENT_PROMPT_ROWPOD_NEXT.md`.  
**Current ship:** host **1.4.4** (RowPod is the Pages root; IMU lab at `lab.html`).
Angle, arc, blade metres, and gated feather-on are unchanged from 1.4.3.
1.4.4 is not the full 1.5 shaft-axis / wash slice. Do not flash firmware for
this minor. Next named slice is **1.5** only when the human names the rest of
blade-work.

## Human gate (this repo)

| Gate | Status |
|------|--------|
| 1.3.0 boat class + **Stroke sits** + per-seat **hand** | Shipped. Overlay confirmed on water (2 September 2026 2x CSVs: both catches negative / finishes positive). |
| Host **1.4 Honest Crew Clock** | Shipped in `version.js` 1.4.0. Water CSV still needed to confirm the matcher (no 500 ms alias, empty `in_sync` when a finish is missing). |
| Host **1.5 Feather + blade flags** | Next *software* slice. Do not start until the human says so. |
| Firmware **major / v2** | **Owner decision only.** This 1.4 host slice does **not** start a firmware major. |

**Product bet (do not dilute):** a crew that is 40 ms apart at the catch is
leaking speed no force curve will save. Make that 40 ms number true on 2–4
pods at 56 Hz. Then leftover shaft axes for square/wash. Then remember pieces
in the CSV.

The remainder of this file is the agent prompt, kept as ingested so the next
session can execute it without hunting Downloads.

---

# Agent prompt — RowPod next development slice

You are implementing the **next development step** of RowPod, a coaching-aid IMU system for sweep and scull crews. You are not inventing a new product. You are extending an existing host-owned stack.

Read this entire prompt before touching code. If a requested change fights a non-negotiable below, stop and say so.

---

## 0. Mission for this agent

Take RowPod from **1.3.0 (honest-enough live fan + brittle matcher)** to the next shippable host minor(s) in this exact order:

1. **Honest Crew Clock** — stroke matching and in-sync % that cannot lie.
2. **Blade-work the shaft IMU can see** — feather axis at Zero, then wash / late-square flags.
3. **Post-piece CSV intelligence** — fade, rolling in-sync, relative drive-rate overlay. No watts.

Do **one slice at a time**. Default first slice = **1.4 Honest Crew Clock**, unless the human explicitly names another slice.

Deep learning is **out of scope** until slices 1 and 2 are boringly correct. If you reach for a network before that, you are off-brief.

---

## 1. Source of truth (read these first)

| Doc | Use it for |
|-----|------------|
| `ROWPOD_ECOSYSTEM.md` | Product map, who it is for, 1.3.0 behaviour, trust rules, process, open backlog. |
| `ROWING_SYNC.md` | Zeroing, `ω · g`, timebase math, accuracy budget, file map. |
| `SESSION_PROTOCOL.md` | BLE versions, capture lifecycle, sample index. |
| This prompt | What to build next, what not to build, done-when tests. |

Hardware / schematic context (do not redesign):

- Pod: ESP32-C3FH4, QMI8658A IMU, QMC5883P mag, USB-C + TP4056, XC6220 3.3 V LDO.
- Mount: oar shaft, **inboard of the gate**, repeatable LED orientation.
- No strain / force sensor on V1. Never label a Y-axis in watts or newtons.

Live hosted UI (reference only; implement in the repo):

- `https://mhyeung.github.io/ESP32C3_MotionTracking_Gadget/?v=1.4.4`

---

## 2. Current product (do not regress)

**Stack**

```
Oar shaft → C3-Tracker pod → BLE (PROFILE_ROWING = 2, 56 Hz live)
                              → Chrome / Edge
                                 ├─ RowPod PWA   (towpath; coach primary)
                                 └─ Lab dashboard (debug / HYROX / high-rate CSV)
```

**Already shipping in host 1.3.0**

- Fan diagram: catch toward bow = left, finish toward stern = right, 0° = perpendicular. Port/starboard inverted in software so both hands sweep the same way on the overlay.
- Headlines: in-sync % (coach window 10–80 ms, default **40 ms**), SPM from reference seat, catch/finish spread, stroke count, live feather.
- Per-seat table: catch°, finish°, arc, live feather, Δ catch ms, Δ finish ms, clock ±rms.
- Boat class 2x–8+, Stroke sits port/starboard, seat, hand (stroke-side / bow-side). Sweep auto-fills hand. Scull defaults both pods to stroke-side.
- Session: Add pod → boat/seats/hands → Zero at squared + perpendicular → Start / Stop → stroke CSV `rowpod_<ver>_strokes_….csv`.
- Confidence chips: Zero first, mag yaw (low confidence), gyro settling, gyro lock, clock ±N ms.
- Angle source of truth: **v16 raw gyro · gravity**. Not magnetometer yaw. Not Mahony-differentiated “gyro.”
- Feather: separate gravity-about-shaft signal. Known-broken: shaft axis at Zero is ambiguous (two horizontal IMU axes).
- Design point: **2–4 BLE links** on one Android Chrome or desktop Chrome/Edge. iPhone Safari cannot connect. An eight does not fit one phone — sample seats.

**Split of labour (do not invert)**

| Layer | When you touch it |
|-------|-------------------|
| Firmware (ESP-IDF `components/`) | Only if the host is blocked (radio, sample clock, v16 frames, 32-bit sync seq, battery, sleep). Flash every pod. |
| RowPod host (`web/ble_plotter/rowpod*`, `rowing_*.js`) | Default workplace. Angle, events, crew match, fan, CSV, boat class. Refresh the page. |
| Lab host (`lab.html`, `app.js`) | Debug / high-rate capture for later labelling. Not the towpath UI. |

RowPod v1 is **host-owned angle**: the pod sends IMU + `sample_index`; the browser integrates, detects catch/finish, matches the crew. A water test in the afternoon must still be able to change the detector **without** a firmware campaign.

**Versioning** (`web/ble_plotter/version.js`)

- 1.0.0 fan + seats + sync + CSV
- 1.0.1 stopped integrating Mahony-as-gyro
- 1.1.0 prefer v16 raw gyro; midpoint lock; confidence chip
- 1.2.0 no finish-jump DC leak; catch/finish state machine; blade feather
- 1.3.0 boat class; stroke-side / bow-side; overlay sign from Stroke sits
- 1.4.4 Pages root is RowPod; IMU lab at `lab.html`

Patches = small detector/UI fixes. Minors = behaviour a coach notices. PWA cache name and `?v=` follow the same number.

**Lessons already paid for (do not reintroduce)**

- Integrating fused-quat differences double-counted Mahony mag/accel corrections → catch walked. **Raw gyro only.**
- Snapping DC at finish made recovery jump. **Leak DC only while ω > 0.**
- Extra ω up-crossings ~400 ms after catch → CSV rows with no finish. **Keep catch ↔ finish state machine.**
- Two seats tagged same hand on opposite gunwales → live needles opposed. **Boat class + hand required.**
- ~500–700 ms “catch spread” at ~40 spm is usually matcher aliasing or a missed finish, not a crew. **A real crew is not half a second apart.**
- 100% in-sync with one seat catching is not a tight crew.

---

## 3. Non-negotiables

1. Live rowing profile stays **56 Hz**. Do not raise ODR on the towpath to “get more timing.” Event interpolation is ~1–3 ms; software timebase (often 5–10 ms) already dominates the 40 ms window. Timing gains come from `sample_index` + matcher hygiene.
2. Do not integrate magnetometer yaw for oar angle.
3. Do not claim Peach / NK / seat-box replacement. Treat RowPod as a coaching aid.
4. Do not label force, power, or work in watts or newtons. Relative “drive rate” only, and only in slice 3.
5. Do not build a native iOS/Android app, an 8-pod-on-one-phone mode, on-pod flash stroke logs, or on-device TinyML as part of 1.4–1.6.
6. Do not skip the validation ladder: protractor → two pods on one rigid bar → 2x/2− water CSV → sampled eight.
7. Never mark a stroke “in sync” unless **at least two seats** have a catch **and** a finish on that matched stroke **and** clock rms on those pods is trustworthy.
8. One coaching cue per athlete surface. Coach table may show more columns; athlete-facing copy stays one sentence.
9. Public firmware APIs only through `components/<name>/include/`. One I2C owner task. No IMU reads from a BLE callback. `ESP_ERROR_CHECK` + `ESP_LOG*`.
10. Unit tests stay green:  
    `node web/ble_plotter/rowing_angle.test.js`  
    `node web/ble_plotter/protocol.test.js`

---

## 4. Accuracy and coaching language (use these numbers)

- In-sync window is a **coach choice**, default 40 ms, range 10–80 ms. Not a physics constant.
- Software test allowance, two pods on one stick: catch times agree to roughly clock ±rms, target **< 15 ms**.
- Coaching ballparks after a clean Zero (not factory cal): catch about −55° to −65°, finish about +30° to +40°. **Arc (finish − catch) is more robust than absolute catch** if the integrator walks.
- Catch slip / cover in the literature is ~6° / ~60–70 ms. At 56 Hz that is 3–4 samples. Enough for a **flag**, not for a 10 ms “first kiss of water” claim.
- Feather during a squared-only piece should sit near 0°. If it tracks the fan angle, Zero picked a poor shaft axis — chip it, do not coach blade work.

---

## 5. What to build (priority order)

### Slice A — Host 1.4: Honest Crew Clock  ← DEFAULT FIRST SLICE

**Coach question:** “Who is late to the catch vs stroke, and is this crew inside *my* window?”

**Implement**

1. **Forward stroke match** from the reference seat’s catch. Do not use nearest-in-half-window. Drop the row if the other seat has no finish. Never pair stroke N of seat A with stroke N+1 of seat B.
2. **Hard gate in-sync %**
   - Undefined / greyed / `—` if fewer than two seats have complete catch+finish on that stroke.
   - Undefined if any participating pod’s clock ±rms is not a few milliseconds (use the existing chip; persist `UNTRUSTED_TIME` in CSV).
   - Window remains coach-set (default 40 ms).
3. **Sampled-eight presets** (UI only; still 2–4 live links): e.g. `stroke + 3 + bow`, `stroke + 2 + 4`, `pair`. Fan and table show connected seats only. Do not imply a full eight.
4. CSV: keep long format one row per seat per stroke. Add or keep columns the review page will need. Header already stamps `rowpod_version`, `boat_class`, `stroke_sits`. If you add columns, document them in the CSV header comment and in tests.
5. Guardrails in the live table: if spread is hundreds of ms, surface “check matcher / missing finish” rather than coaching it as crew.

**Do not** change angle integration, Zero math, or BLE profile in this slice unless a test proves they are the matcher’s cause.

**Done when**

- Unit tests: synthetic sines at ~20 and ~40 spm cannot alias by half a period; single-seat pieces cannot score 100% in-sync; missing `t_finish_ms` cannot enter an in-sync numerator.
- Bench: two pods on one rigid bar, catch Δt ≈ clock rms, not tens of ms of extra matcher error.
- Water/tank CSV from a 2x or 2−: no 500–700 ms spreads that are actually period-aliasing; every in-sync row has finishes on ≥2 seats.

**Tests to add (names are suggestions)**

- `match_forward_no_half_period_alias`
- `in_sync_undefined_when_single_seat`
- `in_sync_undefined_when_clock_untrusted`
- `in_sync_undefined_when_finish_missing`
- existing rigid-bar timing still < 15 ms

---

### Slice B — Host 1.5: Feather axis + blade-work flags

Start only after Slice A tests pass.

**Coach question:** “Did they square before the catch? Are they hanging / washing? Is this short catch actually an open blade?”

**Implement**

1. **Shaft-axis Zero (host).** At Zero the blade is squared and the loom is perpendicular. Resolve feather as the IMU axis that (a) is the best shaft candidate in the still pose, and (b) does **not** move with the subsequent perpendicular sweep on the first two strokes. If still ambiguous, confidence chip stays `feather?` and blade-work columns are suppressed.
2. **Optional |feather| gate** on catch/finish: large |feather| at the ω extremum tags `open-blade` instead of extra length.
3. New table/CSV columns (only when feather chip is trusted):
   - feather at catch, at finish, and ~100 ms before catch
   - time-to-square (last crossing through a small threshold before catch)
   - wash proxy: degrees of arc after ω falls through a small drive threshold until finish extremum
   - lock-delay proxy: degrees of arc from catch extremum until |ω| is clearly on the drive — label **lock delay**, not Peach “slip”

**Do not** raise live ODR. Do not claim water-contact millisecond timing on the 56 Hz stream. If you need contact/extract labels later, use the **lab high-rate capture path + 240 fps video**, train offline, write optional CSV columns after Stop.

**Done when**

- Squared-only piece: feather stays near 0° through the drive; chip is not `feather?`.
- Deliberate early-open piece: flagged `open-blade`, arc not inflated.
- Unit tests for axis choice on synthetic still+sweep; wash/lock-delay defined on synthetic strokes.

---

### Slice C — Host 1.6: Post-piece CSV review

Start only after Slice A is shipped. Slice B columns are nice-to-have here, not required.

**Coach question after Stop:** “Who faded? Who was late for the whole piece vs only the last 500 m? Did Tuesday’s technical change stick?”

**Implement a review surface that reads the stroke CSV** (same file the live page already writes). Do not invent a new radio.

Minimum views:

1. Per seat: catch°, arc, Δt vs reference, vs stroke index.
2. Fade: last-third minus first-third for arc and catch Δt.
3. Rolling in-sync % on a 20-stroke window.
4. Relative drive-rate overlay: resample ω (or arc rate) catch→finish onto 0–100% of arc; overlay connected seats; Y-axis labelled **drive rate (relative)**. Angle-at-peak-ω is the front-loaded / back-loaded sentence.

**Do not** draw a Peach force-angle plot. Do not add a hull-pod requirement to ship 1.6.

**Done when** a coach can open one CSV and in one minute name which seat lost length in the last third of the piece.

---

## 6. Explicitly out of scope (say no)

- Native app, iOS Safari client, eight concurrent GATT links on one phone.
- On-pod flash logging of strokes.
- On-device TinyML / TCN / transformer on the C3.
- Generative “AI coach comments.”
- Body-pose, wrist IMUs, video-only models as the primary metric.
- Predicted watts, pin force, calibrated hydro force.
- Changing PROFILE_ROWING live rate to 448 Hz (that is the HYROX/lab capture policy).
- Cox-view diagram as the new default (a toggle is listed in the ecosystem backlog; do not make it the default overlay).
- Major version 2 (new mount, native app, CSV/protocol break) — owner decision only.

---

## 7. How to work (this repo’s process)

1. Write or extend **unit tests first** with synthetic strokes (sine at two ratings, missing finish, single seat, rigid-bar identical motion, gyro bias lock).
2. Implement the smallest host change that makes those tests pass.
3. Bump host version in `version.js` only when behaviour a coach would notice has landed. Keep PWA cache name and `?v=` in lockstep so phones do not mix `rowpod.js` with an old `rowing_crew.js`.
4. Do not flash firmware unless a test demonstrates the host cannot proceed.
5. After a water CSV exists: read the file for walk, double-catches, opposite needles, empty `t_finish_ms`, 500–700 ms spreads — then patch. Do not argue with the CSV.

Code style for host JS: match existing `rowing_*.js` structure. Do not rewrite the fan or BLE layer “while you are here.”

---

## 8. Suggested first commit series for Slice A

1. Tests that encode current matcher failure modes (half-period alias, single-seat 100%, missing finish counted as in-sync).
2. Forward matcher + in-sync gates.
3. CSV / UI copy so untrusted time and incomplete strokes cannot look like a tight crew.
4. Sampled-crew presets (can be a follow-up commit in the same minor).
5. Version bump to 1.4.0 when 1–3 are done and tests pass.

Stop after Slice A unless the human says continue.

---

## 9. Reply format while you work

For every change set, report:

1. **Slice** you are on (A/B/C).
2. **Files** touched.
3. **Behaviour a coach will notice.**
4. **Tests** added or updated, and the command to run them.
5. **What you refused to do** because it violated a non-negotiable.
6. **Open questions** that need a water CSV or an owner decision.

If the repo layout you find disagrees with names in this prompt, trust the repo and `ROWPOD_ECOSYSTEM.md`, then name the mismatch.

---

## 10. One-sentence product bet (do not dilute)

A crew that is 40 ms apart at the catch is leaking speed no force curve will save. Make that 40 ms number true on 2–4 pods at 56 Hz. Then use the leftover shaft axes for square/wash. Then remember pieces in the CSV. That is the work.
