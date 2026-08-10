#!/usr/bin/env python3
"""Mark and repair isolated IMU outliers before trajectory reconstruction.

Raw columns are preserved. Corrected engineering columns are added so the
operation remains auditable; clipped or isolated samples are never silently
deleted.
"""

from __future__ import annotations

import argparse
import csv
import math
import statistics
from pathlib import Path

ACCEL = ("ax_g", "ay_g", "az_g")
GYRO = ("gx_dps", "gy_dps", "gz_dps")
MAG = ("mx_G", "my_G", "mz_G")
GROUPS = ((ACCEL, 1, "accel"), (GYRO, 2, "gyro"), (MAG, 4, "mag"))
RAW = ("ax_raw", "ay_raw", "az_raw", "gx_raw", "gy_raw", "gz_raw")


def finite(value):
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


def is_rail(row, name):
    try:
        return abs(int(row.get(name, ""))) >= 32760
    except (TypeError, ValueError):
        return False


def local_mad(values):
    med = statistics.median(values)
    return statistics.median(abs(value - med) for value in values)


def add_clean_columns(rows):
    n = len(rows)
    values = {
        name: [float(row[name]) if finite(row.get(name)) else math.nan
               for row in rows]
        for group, _, _ in GROUPS
        for name in group
    }
    bad = [0] * n
    reasons = [[] for _ in rows]

    for i, row in enumerate(rows):
        if any(not finite(row.get(name)) for name in (*ACCEL, *GYRO, *MAG)):
            bad[i] |= 8
            reasons[i].append("nonfinite")
        if any(is_rail(row, name) for name in RAW):
            bad[i] |= 16
            if any(is_rail(row, name) for name in
                   ("ax_raw", "ay_raw", "az_raw")):
                bad[i] |= 1
            if any(is_rail(row, name) for name in
                   ("gx_raw", "gy_raw", "gz_raw")):
                bad[i] |= 2
            reasons[i].append("rail")

    # A one-sample innovation is suspicious only when it exceeds both a
    # physical floor and the local robust noise estimate. This preserves
    # legitimate fast changes while catching communication spikes.
    for group, bit, label in GROUPS:
        for name in group:
            series = values[name]
            for i in range(1, n - 1):
                if not (finite(series[i - 1]) and finite(series[i]) and
                        finite(series[i + 1])):
                    continue
                lo = max(0, i - 3)
                hi = min(n, i + 4)
                neighborhood = [
                    series[j] for j in range(lo, hi)
                    if j != i and finite(series[j])
                ]
                if len(neighborhood) < 3:
                    continue
                prediction = (series[i - 1] + series[i + 1]) / 2
                residual = abs(series[i] - prediction)
                mad = local_mad(neighborhood)
                floor = {"accel": 0.35, "gyro": 80.0, "mag": 0.08}[label]
                if residual > max(floor, 8.0 * max(mad, 1e-6)):
                    bad[i] |= bit
                    reason = f"{label}_spike"
                    if reason not in reasons[i]:
                        reasons[i].append(reason)

    for i, row in enumerate(rows):
        row["outlier_mask"] = str(bad[i])
        row["outlier_reason"] = ";".join(reasons[i]) or ""

    # Repair contiguous flagged runs by linear interpolation. A run at a
    # capture edge holds the nearest valid value; the mask retains provenance.
    for group, bit, _ in GROUPS:
        for name in group:
            series = values[name]
            i = 0
            while i < n:
                if not (bad[i] & bit):
                    i += 1
                    continue
                start = i
                while i < n and (bad[i] & bit):
                    i += 1
                end = i - 1
                left = series[start - 1] if start > 0 else math.nan
                right = series[i] if i < n else math.nan
                for j in range(start, end + 1):
                    if finite(left) and finite(right):
                        alpha = (j - start + 1) / (end - start + 2)
                        value = left + alpha * (right - left)
                    elif finite(left):
                        value = left
                    elif finite(right):
                        value = right
                    else:
                        value = 0.0
                    series[j] = value
            clean_name = name.replace("_g", "_clean_g").replace(
                "_dps", "_clean_dps").replace("_G", "_clean_G")
            for j, row in enumerate(rows):
                row[clean_name] = f"{series[j]:.9g}"

    return sum(mask != 0 for mask in bad), sum(mask & 16 != 0 for mask in bad)


def read_csv(path):
    lines = path.read_text(encoding="utf-8-sig").splitlines()
    comments = [line for line in lines if line.startswith("#")]
    rows = list(csv.DictReader(line for line in lines if not line.startswith("#")))
    if not rows:
        raise ValueError("CSV has no samples")
    return comments, rows


def write_csv(path, comments, rows):
    fields = list(rows[0].keys())
    updated = []
    updated.extend(comments)
    updated.extend([
        "# cleaned_by=clean_motion_csv.py",
        "# outlier_mask=1 accel, 2 gyro, 4 mag, 8 nonfinite, 16 raw rail",
        "# clean_policy=rail_or_robust_local_innovation; raw columns preserved",
    ])
    with path.open("w", newline="", encoding="utf-8") as stream:
        stream.write("\n".join(updated) + "\n")
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    comments, rows = read_csv(args.input)
    repaired, rails = add_clean_columns(rows)
    output = args.output or args.input.with_name(
        f"{args.input.stem}_cleaned{args.input.suffix}"
    )
    write_csv(output, comments, rows)
    print(f"wrote={output} rows={len(rows)} repaired={repaired} rails={rails}")


if __name__ == "__main__":
    raise SystemExit(main())
