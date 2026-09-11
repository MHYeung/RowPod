# Battery runtime test

## Purpose

Measure repeatable runtime and data-quality behavior for each operating mode.
This is a runtime characterization, not an accelerated battery-aging test.

The dashboard log supplies loaded pack voltage, connection state, observed
sample rate, sequence gaps, and outlier counts. Measure current and consumed
capacity externally if mAh or energy is required.

## Safety and documentation to read first

Before discharging any LiPo:

1. Read the cell datasheet sections covering maximum charge voltage, minimum
   discharge voltage, continuous discharge current, and temperature limits.
2. Read the protection-circuit datasheet if the pack includes one.
3. Read the TP4056 datasheet charging-termination section. A TP4056 charges a
   cell; it does not by itself prove the product has a safe discharge cutoff.
4. Stop the test at the cell manufacturer's conservative loaded-voltage limit,
   or earlier if the enclosure/cell becomes warm, swollen, or behaves
   unexpectedly.

Do not deliberately discharge to an ESP32 brownout. Stop manually at the
defined cutoff and recharge under supervision.

## Equipment

- The same known-good tracker and LiPo pack for each repeat.
- Inline battery-capable power analyser (for example Joulescope/Otii) or a
  regulated bench supply with current logging when measuring mA/mAh. A USB
  meter is only useful if the product is deliberately powered through that USB
  path; it does not characterize normal LiPo discharge.
- Stable room temperature; record it in the test notes.
- Chrome or Edge running the dashboard v16.8 (`/?v=16.8`).
- A reliable charging supply and a timer.

## Test matrix

Run every mode at least three times:

1. Advertising idle, disconnected, until its light-sleep policy engages.
2. Connected live monitor at 56 Hz.
3. One connected pod, continuous 224 Hz logging.
4. Two connected pods, continuous 112 Hz logging per pod.

The browser status logger only covers connected modes. Use the external meter
and manual timestamps for advertising/light-sleep testing.

## Pre-test controls

1. Use the same firmware revision, enclosure, antenna position, and LiPo pack
   orientation for all repetitions.
2. Charge to the cell's specified termination voltage. Let the pack rest for
   20–30 minutes before beginning the test.
3. Record pack ID, estimated age/cycle count, room temperature, firmware hash,
   dashboard version, and chosen test mode.
4. Confirm the Summary card shows a healthy stream, zero unexpected gaps, and a
   sensible pack voltage.
5. For logging modes, keep pod placement fixed and use a repeatable motion
   source or leave the pod still. Different movements change BLE traffic and
   LED/sensor behavior.

## Connected-mode procedure

1. Connect the required pod(s).
2. Set the intended mode: live 56 Hz, one-pod 224 Hz logging, or two-pod
   112 Hz logging.
3. Open **Battery test** and enter an unambiguous label, for example
   `run01-one-pod-224Hz-22C`.
4. Select a 60-second status interval. Use 30 seconds only when diagnosing a
   fast failure or voltage sag.
5. Start the status log. Confirm an immediate row appears for every pod.
6. Keep the dashboard tab visible and the host awake. Record any test
   interruption, reconnect, or browser warning.
7. Stop at the predefined conservative loaded-voltage limit, loss of reliable
   service, or the target duration. Do not wait for a brownout.
8. Stop and download the status CSV. Save the external current trace with the
   same base filename.
9. Let the cell cool before charging or repeating a high-load test.

## Record these outcomes

- Start/end time and runtime.
- First/last loaded pack mV and voltage-derived percentage.
- External average current, peak current, and integrated mAh if available.
- Observed rate, sequence gaps, disconnects, and outlier count.
- Enclosure/cell temperature observations.
- Reason the test ended.

## Pass criteria for a comparable run

- The intended rate is maintained within a practical tolerance after the first
  30 seconds.
- No unexpected disconnect.
- No unexplained sequence-gap increase.
- No sustained rail/outlier increase.
- The ending condition is logged explicitly rather than inferred from a
  percentage value.

## Interpreting results

Do not compare voltage-derived percentage curves across modes as though they
were capacity curves. The higher-load mode can show a lower voltage from
internal resistance even at the same remaining charge. Use runtime and
externally integrated current for power decisions; use the dashboard CSV to
explain whether a runtime change coincides with BLE or sensor degradation.

Firmware percent (`battery.c`) is a **loaded-voltage** piecewise map, not OCV
SoC: 3.30 V → 0 %, 3.50 V → 10 %, 3.60 V → 25 %, 3.70 V → 45 %, 3.80 V → 60 %,
3.90 V → 75 %, 4.00 V → 88 %, 4.10 V → 96 %, 4.20 V → 100 %. Linear 3.3–4.2 V
made a rested ~3.9 V pack look emptier than it is. ADC is GPIO2 (ADC1 CH2),
12 dB atten, 1:1 divider (`BOARD_BATTERY_DIVIDER_RATIO = 2`).
