#pragma once

#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
#include "sensor_protocol.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef void (*sensor_stream_frame_cb_t)(const sensor_proto_frame_t *frame, void *ctx);

/**
 * @brief Init I2C + sensors and start the sampling task (paused until enable).
 */
esp_err_t sensor_stream_init(void);

/** @brief Start/stop 100 Hz sampling. When disabled, sensors stay powered but idle. */
void sensor_stream_set_enabled(bool enabled);

bool sensor_stream_is_enabled(void);

/**
 * @brief Register callback invoked from the sensor task after each successful sample.
 * Keep the callback short — queue/notify only; no I2C or blocking BLE.
 */
void sensor_stream_set_frame_cb(sensor_stream_frame_cb_t cb, void *ctx);

/** @brief Copy latest frame (non-blocking). Returns ESP_ERR_NOT_FOUND if none yet. */
esp_err_t sensor_stream_get_latest(sensor_proto_frame_t *out);

uint32_t sensor_stream_dropped_count(void);

esp_err_t sensor_stream_get_meta(sensor_proto_meta_t *out);

#ifdef __cplusplus
}
#endif
