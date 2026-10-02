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

## Status CSV v3 columns

`web/ble_plotter/status_log.js` (Battery test tab). Default interval 60 s,
ring 20 000 rows. Header comments then:

```
created_iso,elapsed_s,device_id,pod_id,position,connection_state,
sensor_state,health,expected_rate_hz,observed_rate_hz,sequence_gaps,missing_frames,
outlier_rows,total_frames,battery_valid,battery_mV,battery_percent,
battery_read_error,capture_id,firmware_state,rate_epoch,protocol_ver,first_sample,last_produced,
last_sent,final_sample,has_samples,drain_done,queue_depth,queue_high_water,sensor_dropped,
transport_dropped,notify_failures,att_mtu,browser_visibility,interval_s
```

This is not the motion CSV. Motion v7 + reconstruction gates:
[`../TRAJECTORY_CAPTURE.md`](../TRAJECTORY_CAPTURE.md).
