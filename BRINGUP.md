# ESP32-C3 Motion Tracker Bring-Up

Firmware is modular under `components/`. Prefer one concern per image while
debugging hardware; the production app wires UI + sensors + BLE together.

## Hardware safety before power

1. Inspect the board for solder bridges and confirm battery polarity.
2. With power removed, measure resistance from `3V3` to `GND`.
3. Power from USB first; verify `VBUS`, `V_SYS`, and `3V3` at the test pads.
4. Connect the LiPo only after the 3V3 rail is confirmed.

## Verified pin map (`components/board/include/board_pins.h`)

| Function | GPIO |
|----------|------|
| Blue LED (active high) | 7 |
| User button (active-low, deep-sleep wake) | 0 |
| Battery ADC | 2 |
| I²C SDA / SCL | 4 / 5 |
| IMU INT1 / INT2 | 8 / 3 |

QMI8658A @ `0x6A` (WHO_AM_I `0x05`). RowPod v2 does not fit a magnetometer.
I²C is Fast-mode **400 kHz**. Pack voltage is ADC × 2 (470 kΩ / 470 kΩ on
GPIO2). Button debounce is 30 ms; a long press is 2 s. GPIO0 is an RTC pad
(no 32 kHz crystal is fitted). The orange LED is the TP4056 charge indicator
and is not driven by the MCU.

## Status LED

| State | Blue (GPIO7) |
|-------|----------------|
| Advertising / waiting | LEDC breathing, 2 s period |
| Connected | Dim |
| Streaming notifications | Dim |
| Deep sleep | Held off |

## Application flow (current)

Matches `main/main.c`:

1. `power_boot_gate` — on a GPIO wake, a pad still held (or USB) continues;
   a released short press returns to deep sleep. Runs before NVS / BLE / sensors.
2. `nvs_flash_init` + default event loop
3. `device_config_init` — load name / pod id from NVS
4. `ui_init` + button callback — blue LED + debounced GPIO0 gestures
5. `battery_init` — ADC oneshot on GPIO2 (pack = ADC × 2)
6. `power_init` — 180 s disconnected idle → deep sleep
7. `sensor_stream_init` — I²C bus, IMU init, INT2 DRDY task, Mahony
8. `ble_tracker_set_link_cb(power_on_ble_link)` then `ble_tracker_init`
9. Client enables notifications on one motion characteristic → streaming starts
10. Dashboard may write position name / request software sync
11. Every pod advertises as a fixed single-node peripheral with a unique pod name
12. The host may connect one or multiple pods using repeated **Add pod** actions
13. In a connected pod, single-tap pauses/resumes the BLE sensor stream

Console is the C3 **USB Serial/JTAG** port on the same USB-C socket
(`CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG`). A UART-only cable on GPIO20/21 will
not show firmware logs.

## Power / deep sleep

`power.c` uses a one-shot **180 s** idle timer. Connect stops it; disconnect
resets it. `power_notify_activity` only matters while disconnected. The timer
callback only `xTaskNotifyGive`s the power task — do not call BLE or
`esp_deep_sleep_start` from that callback.

On timeout, if `usb_serial_jtag_is_connected()` is true, sleep is skipped and
the timer is reset. Otherwise the power task:

1. Disables button gestures
2. Stops BLE advertising
3. Turns the LED off (`ui_prepare_sleep`)
4. Powers down the IMU from the I²C task (`qmi8658_power_down`)
5. Waits until GPIO0 is released, holds GPIO7 off through sleep, arms
   GPIO0-low wake, then `esp_deep_sleep_start`

Deep sleep resets the chip. `sample_index` starts at 0. Capture state does
not survive. Hosts must treat the next connection as a new clock.

| Situation | What happens |
|-----------|----------------|
| Battery, short GPIO0 press | Chip boots, `power_boot_gate` sees a released pad, sleeps again |
| Battery, hold GPIO0 ~2 s | Pad still low at the gate; advertising starts |
| USB plugged into a computer | Short press **continues** boot; idle policy will not sleep |
| Awake 2 s hold | Logged and ignored. There is no button command to enter deep sleep |
| Connected single-tap | Pauses / resumes the motion stream |

Unplug USB before testing the 3-minute idle or the short-press reject.
GPIO7 is a digital pad: `gpio_hold_en` alone does not keep it off through C3
deep sleep; `gpio_deep_sleep_hold_en` does. Configure the button as an input
before releasing the hold, or the pad default looks like a press.

## Multi-pod validation checklist

1. Boot one pod; confirm blue breath and advertised name.
2. Confirm the pod advertises with a unique `C3-T-XXXX` name.
3. Power-cycle; confirm pod id/name persist from NVS.
4. Enter deep sleep; short-tap and confirm it stays asleep; hold GPIO0 for 2 s and confirm it advertises. Unplug USB before this check, or the idle policy stays awake.
5. Web: Add pod → enable notify → single-tap and verify frames stop/resume.
6. Two pods: overlay traces, per-pod rates/gaps, CSV includes `position`/`synced_ms`.
7. Optional four-pod stress: watch for rising seq gaps / UI lag.

## Web plotter

```text
cd web/ble_plotter
python -m http.server 8080
```

Open `http://localhost:8080/lab.html?v=16.9` in Chrome/Edge (not `file://`). Hard-refresh if Add pod looks dead. RowPod (rowing) is `http://localhost:8080/?v=1.4.4`.

## Developer pitfalls

| Symptom | Likely cause |
|---------|----------------|
| Never enters deep sleep on the bench | USB-Serial/JTAG host is connected; unplug USB |
| Short press wakes the pod | Same USB exception in `power_boot_gate` |
| Short press on battery: LED blinks, then off | Expected. Hold GPIO0 ~2 s |
| 2 s hold while advertising does nothing | Sleep is the idle timer after disconnect, not a gesture |
| `i2c_bus: not idle` at boot | Missing external 4.7 kΩ pull-ups, or SCL stuck low (TP5) |
| Monitor shows nothing | Wrong port; firmware uses USB Serial/JTAG, not GPIO20/21 UART |
| `file://` Web Bluetooth | Serve `localhost` or the Pages HTTPS URL |

## Known hardware notes

- SCL (GPIO5 / TP5) has been intermittent; idle-high must be ~3.3 V before trusting I²C.
- External 4.7 kΩ pull-ups required; do not rely on internal weak pull-ups alone.
- IMU INT2 (GPIO3) is the DRDY input; verify it is wired and toggles at the
  selected ODR. The ISR only notifies the sensor task; it never performs I²C.

## Documentation checkpoints

- ESP-IDF I2C master + NimBLE GATT notify / NVS / deep-sleep GPIO wake (`esp_sleep_enable_gpio_wakeup_on_hp_periph_powerdown`, GPIO0–5 on the C3)
- QMI8658A datasheet (WHO_AM_I, CTRL1 SensorDisable, CTRL7, supply-current table)
- ESP32-C3 datasheet "Strapping Pins": GPIO2 (battery divider) and GPIO8 (IMU INT1) must still allow GPIO9+RST download mode with a battery fitted
- Chrome Web Bluetooth secure context (`localhost` or HTTPS)
- Software sync accuracy is visual/ms-scale only
