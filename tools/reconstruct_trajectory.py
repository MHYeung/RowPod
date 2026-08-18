#!/usr/bin/env python3
"""Quality-gated short-window trajectory reconstruction.

Prefers on-device Mahony quaternions from CSV v7. v6 files without `qw..qz`
fall back to host AHRS from gyro/mag. This does not make unconstrained
inertial position observable.
"""

from __future__ import annotations

import argparse
import csv
import math
import sys
from pathlib import Path

G = 9.80665


def add(a, b):
    return tuple(x + y for x, y in zip(a, b))


def sub(a, b):
    return tuple(x - y for x, y in zip(a, b))


def scale(v, s):
    return tuple(x * s for x in v)


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def cross(a, b):
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def norm(v):
    return math.sqrt(dot(v, v))


def unit(v):
    n = norm(v)
    if n < 1e-12:
        raise ValueError("zero-length vector")
    return scale(v, 1.0 / n)


def qmul(a, b):
    aw, ax, ay, az = a
    bw, bx, by, bz = b
    return (
        aw * bw - ax * bx - ay * by - az * bz,
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
    )


def qnorm(q):
    return scale(q, 1.0 / math.sqrt(dot(q, q)))


def qconj(q):
    return (q[0], -q[1], -q[2], -q[3])


def rotate(q, v):
    return qmul(qmul(q, (0.0, *v)), qconj(q))[1:]


def quat_from_matrix(r):
    trace = r[0][0] + r[1][1] + r[2][2]
    if trace > 0:
        s = math.sqrt(trace + 1.0) * 2
        q = (0.25 * s, (r[2][1] - r[1][2]) / s,
             (r[0][2] - r[2][0]) / s, (r[1][0] - r[0][1]) / s)
    else:
        i = max(range(3), key=lambda k: r[k][k])
        j, k = (i + 1) % 3, (i + 2) % 3
        s = math.sqrt(1 + r[i][i] - r[j][j] - r[k][k]) * 2
        qv = [0.0, 0.0, 0.0]
        qv[i] = 0.25 * s
        qv[j] = (r[j][i] + r[i][j]) / s
        qv[k] = (r[k][i] + r[i][k]) / s
        q = ((r[k][j] - r[j][k]) / s, *qv)
    return qnorm(q)


def initial_attitude(acc, mag):
    z_b = unit(acc)
    x_b = unit(sub(mag, scale(z_b, dot(mag, z_b))))
    y_b = unit(cross(z_b, x_b))
    return quat_from_matrix((x_b, y_b, z_b))


def mean_vec(values):
    return scale(tuple(map(sum, zip(*values))), 1.0 / len(values))


def parse_log(path: Path, device_id: str | None):
    lines = path.read_text(encoding="utf-8-sig").splitlines()
    comments = [line[2:] for line in lines if line.startswith("# ")]
    rows = list(csv.DictReader(line for line in lines if not line.startswith("#")))
    if not rows:
        raise ValueError("CSV has no samples")
    ids = sorted({r["device_id"] for r in rows})
    selected = device_id or ids[0]
    rows = [r for r in rows if r["device_id"] == selected]
    if not rows:
        raise ValueError(f"device {selected!r} is absent; choices: {ids}")
    return comments, rows, selected


def _has(rows, cols):
    return all(c in rows[0] for c in cols)


def firmware_quats(rows):
    """Return on-device Mahony quaternions when the CSV actually logged them."""
    if not _has(rows, ("qw", "qx", "qy", "qz")):
        return None
    parsed = []
    for row in rows:
        try:
            q = tuple(float(row[c]) for c in ("qw", "qx", "qy", "qz"))
        except (TypeError, ValueError):
            parsed.append(None)
            continue
        if not all(math.isfinite(x) for x in q) or norm(q) < 0.5:
            parsed.append(None)
        else:
            parsed.append(qnorm(q))
    valid = sum(q is not None for q in parsed)
    if valid < 0.9 * len(parsed):
        return None
    last = next(q for q in parsed if q is not None)
    out = []
    for q in parsed:
        if q is None:
            out.append(last)
        else:
            last = q
            out.append(q)
    print("using on-device Mahony quaternions")
    return out


def sample_vectors(rows):
    t0 = float(rows[0]["sample_ms"])
    t = [(float(r["sample_ms"]) - t0) / 1000 for r in rows]
    accel_cols = ("ax_clean_g", "ay_clean_g", "az_clean_g")
    if not _has(rows, accel_cols):
        accel_cols = ("ax_g", "ay_g", "az_g")
    else:
        print("using cleaned engineering columns")
    acc = [tuple(float(r[c]) for c in accel_cols) for r in rows]
    gyro = None
    for gyro_cols in (("gx_clean_dps", "gy_clean_dps", "gz_clean_dps"),
                      ("gx_dps", "gy_dps", "gz_dps")):
        if _has(rows, gyro_cols):
            gyro = [tuple(math.radians(float(r[c])) for c in gyro_cols)
                    for r in rows]
            break
    mag = None
    for mag_cols in (("mx_cal_G", "my_cal_G", "mz_cal_G"),
                     ("mx_clean_G", "my_clean_G", "mz_clean_G"),
                     ("mx_G", "my_G", "mz_G")):
        if _has(rows, mag_cols):
            mag = [tuple(float(r[c]) for c in mag_cols) for r in rows]
            break
    return t, acc, gyro, mag


def quality_report(comments, rows, t):
    rate = int(rows[0]["rate_hz"])
    if "sample_index" in rows[0]:
        seq = [int(r["sample_index"]) for r in rows]
        missing = sum(max((b - a) - 1, 0) for a, b in zip(seq, seq[1:]))
    else:
        seq = [int(r["seq"]) for r in rows]
        missing = sum(((b - a) & 0xFFFF) - 1 for a, b in zip(seq, seq[1:]))
    raw_cols = ("ax_raw", "ay_raw", "az_raw", "gx_raw", "gy_raw", "gz_raw")
    if _has(rows, raw_cols):
        rails = sum(any(abs(int(r[c])) >= 32760 for c in raw_cols) for r in rows)
    else:
        rails = 0
    start_still = sum(r.get("capture_phase") == "bias_start" and
                      r.get("stationary") == "1" for r in rows)
    end_still = sum(r.get("capture_phase") == "bias_end" and
                    r.get("stationary") == "1" for r in rows)
    calibrated = any("_mag_cal=" in c for c in comments)
    duration = max(t[-1] - t[0], 1e-6)
    # Short strokes: a few isolated peak clips are OK; dense saturation is not.
    # Absolute floor avoids 2–3 rails failing a 0.1% rule on ~2k-sample logs.
    rail_limit = max(5, int(0.005 * len(rows)))
    checks = {
        "sequence_loss_below_0.5pct": missing / max(len(rows) + missing, 1) < 0.005,
        "imu_rail_sparse_ok": rails <= rail_limit,
        "stationary_start_at_least_1s": start_still >= rate,
        "stationary_end_at_least_1s": end_still >= rate,
        "magnetometer_calibrated": calibrated,
        "capture_under_8s": duration <= 8.0,
    }
    return checks, {"missing": missing, "rails": rails, "rate": rate,
                    "duration": duration}


def stationary_indices(rows, phase):
    return [i for i, r in enumerate(rows)
            if r.get("capture_phase") == phase and r.get("stationary") == "1"]


def estimate_orientation(t, acc, gyro, mag, gyro_bias_start, gyro_bias_end):
    q = initial_attitude(acc[0], mag[0])
    field_world = rotate(q, unit(mag[0]))
    field_norm = norm(mag[0])
    quats = [q]
    total = max(t[-1], 1e-6)
    for i in range(1, len(t)):
        dt = min(max(t[i] - t[i - 1], 1e-5), 0.03)
        alpha = t[i] / total
        bias = add(scale(gyro_bias_start, 1 - alpha), scale(gyro_bias_end, alpha))
        w = sub(gyro[i], bias)
        correction = (0.0, 0.0, 0.0)
        an = norm(acc[i])
        if abs(an - 1.0) < 0.15:
            predicted_up_b = rotate(qconj(q), (0.0, 0.0, 1.0))
            correction = add(correction, scale(cross(unit(acc[i]), predicted_up_b), 1.5))
        mn = norm(mag[i])
        if field_norm > 0 and abs(mn / field_norm - 1) < 0.20:
            predicted_mag_b = rotate(qconj(q), field_world)
            correction = add(correction, scale(cross(unit(mag[i]), unit(predicted_mag_b)), 0.35))
        w = add(w, correction)
        qdot = scale(qmul(q, (0.0, *w)), 0.5)
        q = qnorm(add(q, scale(qdot, dt)))
        quats.append(q)
    return quats


def integrate_trajectory(t, acc, quats, start_idx, end_idx, end_reference):
    linear = [sub(scale(rotate(q, a), G), (0.0, 0.0, G))
              for q, a in zip(quats, acc)]
    bias_start = mean_vec([linear[i] for i in start_idx])
    bias_end = mean_vec([linear[i] for i in end_idx])
    total = max(t[-1], 1e-6)
    corrected = []
    for ti, a in zip(t, linear):
        alpha = ti / total
        bias = add(scale(bias_start, 1 - alpha), scale(bias_end, alpha))
        corrected.append(sub(a, bias))

    velocity = [(0.0, 0.0, 0.0)]
    for i in range(1, len(t)):
        dt = t[i] - t[i - 1]
        velocity.append(add(velocity[-1], scale(add(corrected[i - 1], corrected[i]), dt / 2)))
    vend = velocity[-1]
    velocity = [sub(v, scale(vend, ti / total)) for ti, v in zip(t, velocity)]

    position = [(0.0, 0.0, 0.0)]
    for i in range(1, len(t)):
        dt = t[i] - t[i - 1]
        position.append(add(position[-1], scale(add(velocity[i - 1], velocity[i]), dt / 2)))
    if end_reference is not None:
        delta = sub(end_reference, position[-1])
        position = [add(p, scale(delta, ti / total)) for ti, p in zip(t, position)]
    return position, velocity, corrected


def write_output(path, rows, t, quats, position, velocity, linear):
    fields = ["sample_ms", "seq", "x_m", "y_m", "z_m", "vx_mps", "vy_mps",
              "vz_mps", "lin_ax_mps2", "lin_ay_mps2", "lin_az_mps2",
              "qw", "qx", "qy", "qz"]
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(fields)
        for row, ti, q, p, v, a in zip(rows, t, quats, position, velocity, linear):
            writer.writerow([
                f"{ti * 1000:.3f}",
                row.get("sample_index", row.get("seq", "")),
                *p, *v, *a, *q,
            ])


def parse_vector(text):
    values = tuple(float(v) for v in text.split(","))
    if len(values) != 3:
        raise argparse.ArgumentTypeError("expected x,y,z")
    return values


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("csv_log", type=Path)
    parser.add_argument("--device-id")
    parser.add_argument("--output", type=Path, default=Path("trajectory.csv"))
    parser.add_argument("--clean-outliers", action="store_true",
                        help="repair marked rails and isolated spikes in memory")
    parser.add_argument("--end-displacement-m", type=parse_vector,
                        help="external x,y,z endpoint reference; use 0,0,0 for a closed stroke")
    parser.add_argument("--allow-untrusted", action="store_true")
    args = parser.parse_args()

    comments, rows, selected = parse_log(args.csv_log, args.device_id)
    if args.clean_outliers:
        if "ax_raw" not in rows[0]:
            print("CSV v7 has no raw columns; skipping --clean-outliers")
        else:
            from clean_motion_csv import add_clean_columns
            repaired, rails = add_clean_columns(rows)
            print(f"outlier preprocessing repaired={repaired} rails={rails}")
    t, acc, gyro, mag = sample_vectors(rows)
    checks, stats = quality_report(comments, rows, t)
    print(f"device={selected} samples={len(rows)} rate={stats['rate']}Hz "
          f"duration={stats['duration']:.3f}s missing={stats['missing']} rails={stats['rails']}")
    for name, passed in checks.items():
        print(f"{'PASS' if passed else 'FAIL'} {name}")
    if not all(checks.values()) and not args.allow_untrusted:
        print("Refusing trajectory: capture failed quality gates.", file=sys.stderr)
        return 2

    start_idx = stationary_indices(rows, "bias_start")
    end_idx = stationary_indices(rows, "bias_end")
    if not start_idx or not end_idx:
        print("Stationary bias windows are required.", file=sys.stderr)
        return 2
    quats = firmware_quats(rows)
    if quats is None:
        if gyro is None or mag is None:
            print("CSV has neither Mahony quaternions nor gyro/mag for host AHRS.",
                  file=sys.stderr)
            return 2
        gyro_bias_start = mean_vec([gyro[i] for i in start_idx])
        gyro_bias_end = mean_vec([gyro[i] for i in end_idx])
        quats = estimate_orientation(
            t, acc, gyro, mag, gyro_bias_start, gyro_bias_end
        )
    position, velocity, linear = integrate_trajectory(
        t, acc, quats, start_idx, end_idx, args.end_displacement_m
    )
    write_output(args.output, rows, t, quats, position, velocity, linear)
    print(f"wrote={args.output} endpoint_m={position[-1]} "
          f"peak_displacement_m={max(map(norm, position)):.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
