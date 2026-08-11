# Test protocols

This folder contains repeatable procedures for characterizing the tracker before
changing its power policy, BLE rates, firmware fusion, or mobile application.

Current protocols:

- [Battery runtime test](BATTERY_RUNTIME_TEST.md) — connected-mode runtime and
  BLE/sensor-health capture.
- [V16 throughput / drain test](V16_THROUGHPUT_DRAIN_TEST.md) — long-capture
  sequencing, MTU preflight, and finalize-after-drain integrity.

## What a dashboard status log can and cannot measure

The Battery test dashboard tab records a low-rate snapshot for each connected
pod:

- loaded pack voltage and voltage-derived percentage;
- link and sensor state;
- configured and observed sample rate;
- sequence gaps, missing-frame count, live outlier count, and received-frame count;
- browser visibility and battery-read errors.

It does **not** measure current, consumed mAh, or open-circuit state-of-charge.
Use an external current logger or power analyser for those measurements. Keep
the dashboard tab visible throughout a browser-based test; background timer
throttling is itself logged but invalidates precise sample timing.
