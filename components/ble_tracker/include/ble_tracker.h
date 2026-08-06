#pragma once

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Start NimBLE: advertise C3-Tracker, Nordic LBS LEDs, motion notify.
 *
 * Call after ui_init() and sensor_stream_init(). Streaming starts when a
 * client subscribes to the motion data characteristic.
 */
esp_err_t ble_tracker_init(void);

#ifdef __cplusplus
}
#endif
