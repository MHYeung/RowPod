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
 * Live notifies pack up to 8 frames. Capture at ≥224 Hz waits for
 * BLE_GAP_EVENT_NOTIFY_TX before the next batch (2× v16 or 4× fused) so a
 * dropped packet is a small hole instead of an 8-sample hole.
 * The stack also re-requests a 7.5–15 ms connection interval on connect,
 * PREPARE, and whenever the host settles slower than 15 ms.
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
