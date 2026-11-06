#pragma once

#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Start NimBLE and advertise the motion + config services.
 *
 * Call after device_config_init(), ui_init(), and sensor_stream_init().
 * Streaming starts when a client subscribes to the motion data characteristic.
 *
 * Live notifies pack 2 frames when the ATT payload can carry them (1 frame
 * on a 23-byte link), so a 15–30 ms interval still delivers 56 Hz.
 * Capture at ≥224 Hz waits for BLE_GAP_EVENT_NOTIFY_TX before the next
 * batch (2× v16 or 4× fused) so a dropped packet is a small hole instead
 * of an 8-sample hole.
 * Motion subscribe, PREPARE, and a settled interval slower than 30 ms
 * re-request 15–30 ms. Coach-only summary links are left slow.
 */
esp_err_t ble_tracker_init(void);

typedef void (*ble_tracker_link_cb_t)(bool connected);

/** @brief Register a callback: true means connected, false means advertising. */
esp_err_t ble_tracker_set_link_cb(ble_tracker_link_cb_t cb);

/** @brief Stop advertising and deinitialize NimBLE before deep sleep. */
esp_err_t ble_tracker_stop_advertising(void);

/** @brief Reinitialize NimBLE if deep-sleep entry is aborted. */
esp_err_t ble_tracker_start_advertising(void);

/**
 * @brief Refresh the advertised name from device_config while advertising.
 *
 * No-op while connected. Safe to call after a mode/name change.
 */
esp_err_t ble_tracker_refresh_advertising(void);

bool ble_tracker_is_advertising(void);

bool ble_tracker_is_connected(void);

/**
 * @brief Toggle the connected pod's BLE sensor stream.
 *
 * This is the firmware-side start/stop logging action for a single pod.
 * It does not write samples to flash; the browser records received frames.
 */
esp_err_t ble_tracker_toggle_streaming(bool *out_enabled);

/** @brief Return true when a subscriber and stream request are both active. */
bool ble_tracker_is_streaming(void);

/**
 * @brief Return the host-selected workout profile.
 *
 * SENSOR_PROTO_PROFILE_HYROX requests the high-rate capture policy; rep and
 * station metrics remain host-side because the browser owns the session UI.
 * SENSOR_PROTO_PROFILE_ROWING is a host tag only; live 56 Hz remains the
 * default so a multi-oar crew can share one phone radio.
 */
uint8_t ble_tracker_get_workout_profile(void);

#ifdef __cplusplus
}
#endif
