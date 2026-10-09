# Semi-pro HYROX training use

The pod is most useful as a **movement-quality and session-load assistant**,
not as a replacement for a track timer or official timing chip.

## What the pod can estimate

- Work/rest transitions from gyro and acceleration intensity.
- Candidate repetitions for SkiErg, sled pull, row, lunges, burpees, and wall
  balls.
- Cadence, effort score, set duration, sensor gaps, battery state, and clipped
  samples.
- Multi-pod comparison when pods are mounted at consistent body locations.

The dashboard labels repetitions as candidates because a single IMU cannot
reliably distinguish every partial rep, pause, or technical fault without
station-specific validation. The HYROX tab lives on the IMU lab
(`web/ble_plotter/lab.html`), not on RowPod.

## Recommended pod placement

- One pod on the dominant forearm for erg, carry, and wall-ball cadence.
- One pod on the torso or non-dominant forearm for asymmetry and trunk motion.
- Use the same mount orientation every session; record the location in the pod
  card.
- Do not infer exact running distance from inertial double integration.

## Dashboard workflow

1. Connect the required pods and verify the Summary cards show healthy streams,
   acceptable gaps, and adequate battery.
2. Select **HYROX**, choose the station, and start a set.
3. Keep still during the two-second opening bias period.
4. Perform the set. The dashboard shows elapsed time, work time, candidate
   reps, cadence, and effort.
5. Stop and remain still for the closing bias period.
6. Download the CSV. It includes the selected profile, station, candidate rep
   count, outlier flags, and cleaned engineering columns.

## Validate before using for training decisions

For each station, record at least 10 manually counted sets. Compare:

- rep-count error and missed/extra rep rate;
- work-time and rest-time error against a stopwatch;
- cadence error against a metronome or erg display;
- sensor dropout, battery, and outlier rate;
- left/right or torso/forearm differences only after mounts are repeatable.

Use the results to tune station thresholds and refractory times in
`web/ble_plotter/hyrox.js`. Do not treat the default thresholds as medically
or competitively validated.

The firmware exposes a host-selected workout profile characteristic. Selecting
HYROX requests the high-rate capture policy; the browser remains responsible
for station state and rep estimation because it has the session context and
can show uncertainty to the athlete.

## Default station knobs (`hyrox.js`)

Signal (0–1.5):

`clamp((‖gyro_dps‖ / 180 + |‖accel_g‖ − 1| / 0.6) / 2)`

A candidate rep is a rising edge through `threshold` after `refractoryMs`.
`rep: false` stations only accumulate work time.

| Key | Label | Rep? | Threshold | Refractory |
|-----|-------|------|-----------|------------|
| `run` | Run | no | 0.55 | 0 |
| `ski` | SkiErg | yes | 0.75 | 450 ms |
| `sled_push` | Sled push | no | 0.65 | 0 |
| `sled_pull` | Sled pull | yes | 0.75 | 500 ms |
| `burpee` | Burpee broad jump | yes | 0.80 | 900 ms |
| `row` | Row | yes | 0.65 | 650 ms |
| `carry` | Farmers carry | no | 0.45 | 0 |
| `lunge` | Sandbag lunges | yes | 0.60 | 650 ms |
| `wall_ball` | Wall balls | yes | 0.65 | 550 ms |

Capture plumbing (448/112 Hz, same v7 logger, header `training_profile` /
`station`): [`LAB_DASHBOARD.md`](LAB_DASHBOARD.md).
