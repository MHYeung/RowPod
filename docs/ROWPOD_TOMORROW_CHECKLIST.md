# RowPod — test & code checklist (next session)

Dated **1.4.4** water session (September 2026). Current host is **1.5.6**
(`web/ble_plotter/version.js`, cache `rowpod-1.5.6`). Keep this bench order,
but open `?v=1.5.6`. Expect connect-and-go (first stroke centres the fan;
Zero is measured-only) and **Reconnect pods** for already-paired devices.
Do not treat the 1.4.4 stamps in the checkboxes below as current.

Use this the next time you sit down with the pods. Last bench file
(`rowpod_1.4.1_strokes_2026-09-02T16-36-42`) **passed the clock** and **failed
the sweep**: ~23° of arc, catch on the finish side of 0°, ~22° of Zero offset
between pods. Do not skip to an eight.

Host to use: **1.5.6**. Do **not** flash firmware for a host-only check.

---

## 0. Desk — code / PWA (5 min)

- [ ] `web/ble_plotter/version.js` says `ROWPOD_VERSION = "1.4.4"`.
- [ ] Serve from `web/ble_plotter/`: `python -m http.server 8080`
- [ ] Open `http://localhost:8080/?v=1.4.4` (or the GitHub Pages
      URL). Hard-refresh. Title / header must read **1.4.4**, not 1.4.3.
- [ ] If the phone has the PWA installed: delete it and re-add, or the old
      `rowpod-1.4.3` cache will mix JS. Cache name must be `rowpod-1.4.4`.
- [ ] Headline shows **Arc** / **Blade** and a **catch vs stroke** sentence
      (e.g. “Waiting for another catch vs stroke”).
- [ ] Inboard/outboard cm fields are on the boat strip. Type the real outboard
      (pin → blade tip) before Zero.
- [ ] Do not change `PROFILE_ROWING` / live rate. Stay at **56 Hz**.
- [ ] Optional, if you touched JS:
      `node web/ble_plotter/rowing_angle.test.js`
      `node web/ble_plotter/protocol.test.js`

**Pass:** page is 1.4.4, cue line visible, two pods connect, cards say
**raw gyro** (not mag yaw), clock chips start fitting.

---

## 1. Rigid bar (do this first)

Both pods on **one stick / plane**, LED the **same** way.

- [ ] Boat class can stay `2−`. Set **both** Hands to **Stroke side**
      (do not leave bow on bow-side — that inverts one needle).
- [ ] Seat: one **stroke**, one **bow** (so the cue has a name).
- [ ] Square the “blade”. Hold **perpendicular**. Tap **Zero** on both.
      Needles at 0°. Feather ~0° on both cards.
- [ ] **Start piece.**
- [ ] Sweep **catch → finish** in the stroke plane:
      catch toward bow = **left / negative** on the fan,
      finish toward stern = **right / positive**.
- [ ] Arc about **90°**, not a 20° rock. Faster than **25 deg/s** (a firm
      stroke, not a creep). Keep the plane **level** (do not roll the shaft).
- [ ] ~20 clean strokes, then **Stop → Stroke CSV**.
- [ ] Filename should start `rowpod_1.4.4_strokes_…`.

### Pass (clock + detector)

| Check | Pass | Fail (what it means) |
|-------|------|----------------------|
| Clock ±rms both pods | a few ms (like 4–8) | Tens of ms → do not coach 40 ms in-sync |
| Bow catches most strokes | roughly ≥ 16 / 20 | Still silent → sweep too small/slow (`minArc` 20°, `ω` 25 deg/s) |
| Catch \|Δt\| vs stroke | **median &lt; 15 ms**; several ~ clock rms | 300 ms → matcher, not the bar |
| Live cue | “bow 3 ms late” / “with stroke” | “Waiting…” or “not this stroke” on a real sweep |
| Catch° both **negative** | toward bow | All positive → swept the finish side, or Zero not perpendicular |
| Catch Δ° stroke vs bow | a **few degrees**, not a fixed ~22° | Same Δt but 20°+ Δ° → re-Zero together |
| Headline Arc | about **80–90°**, not ~23° | Tiny rock or Zero offset — do not coach length |
| Length | `outboard × θ_rad` (e.g. 2.61 m × 90° ≈ 4.1 m) | Empty if no finish |
| Feather Δt (no shaft roll) | **blank**, not 0 ms | Numbers here without rolling the shaft → fan leak (`feather?`) |
| Feather at catch | both ~0° | One at 60–90° → bar rolled, or shaft axis (1.5, not today’s job) |
| Finish Δt | tens of ms, not 1000 ms | 1100 ms → extra ω down-cross; ignore finish, trust catch Δt |

**Fail the bar → stop.** Do not go on the water. Re-Zero and sweep bigger/faster.

---

## 2. Water 2− (only if §1 passed)

- [ ] Mount: shaft, **inboard of the gate**, repeatable LED.
- [ ] Boat **2−**. Stroke sits = actual rig. Hands: stroke = stroke-side,
      bow = bow-side (auto-fill is fine).
- [ ] Type **outboard** (pin → blade tip) on the boat strip.
- [ ] Zero together, squared and perpendicular, boat still-ish.
- [ ] Straight piece, **Start → row → Stop → Stroke CSV**.
- [ ] Watch the **cue**, not the needle: “bow 12 ms late” is the call.
      Needles can still walk in degrees; catch **time** is the crew number.
- [ ] In-sync % may stay **—** if a finish is missing. That is honest.
      Catch late/early should still appear as soon as both catch.

### Pass (crew cue)

| Check | Pass |
|-------|------|
| Overlay | Both catches left / negative, both finishes right / positive |
| Cue | Names bow early/late vs stroke in **tens of ms**, not 500 ms |
| `in_sync` empty | When a finish is missing or only one seat caught |
| `in_sync=1` | Only when both have catch **and** finish and catch spread ≤ window |
| Clock | Still a few ms rms |
| Arc / length | ~80–90° and metres that match the typed outboard |
| Feather Δt | Present after a real roll; blank or `feather?` if the tick tracks the fan |
| Do not coach | Catch° if it walked; finish spread of hundreds of ms; “not this stroke”; Feather Δt when `feather?` |

---

## 3. Bring back

Drop the CSVs in chat (bar first, water if you got it). I will score:

1. `rowpod_version=1.4.4` in the header, plus `outboard_m`.
2. `catch_dt_vs_ref_ms` median on paired strokes.
3. How often bow is empty (`single_seat`).
4. Whether catch° is negative and `arc_deg` is ~80–90, not ~23.
5. Whether `blade_arc_m` matches outboard × arc, and `t_feather_ms` is empty on a squared bar.
6. Whether the live cue would have matched the CSV.

Do **not** ask for a firmware bump unless this CSV shows the host cannot
timestamp catches. Host **1.4.4** is the same detector as 1.4.3; the Pages
root is now RowPod. **1.5 connect and go** centres the fan on the first stroke. Next named software slice is **1.6 feather axis**,
only after you say so.

## 4. Fixed-stop bench (1.5.1 catch and finish)

Do this before trusting catch and finish degrees from 1.5.1.

1. Clamp hard end stops. Check them with a protractor, for example catch −60° and finish +35°.
2. Strap the pod so it cannot slip. Keep the LED orientation the same as last time.
3. Row 3 × 20 strokes, about 20, then 30, then 40 spm. Rest between the sets (the per-stroke SPM goes blank on a gap over 6 s).
4. Repeat once on host 1.5.0 and once on 1.5.1 if you still have the old page cached.
5. Also record one run from the IMU lab page so the raw stream can be replayed.

Pass, on the finished strokes of each set:

| Check | Pass |
|-------|------|
| Catch standard deviation | under 2° |
| Finish standard deviation | under 2° |
| Arc standard deviation | under 2° |
| Stub finishes (arc under half the recent median) | none |
| Catches during the rests | none |
| `spm` | matches 60000 / the last catch gap, not a 5-stroke lag |

Firmer mounting matters as much as the detector. A strap that creeps will fail this table on both versions.

