#pragma once

#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
#include "sensor_protocol.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef void (*sensor_stream_sample_cb_t)(const sensor_proto_sample_t *sample, void *ctx);

/**
 * @brief Init I2C + sensors and start the sampling task (paused until enable).
 *
 * Default rate is SENSOR_PROTO_RATE_LIVE_HZ. Samples are clocked from the
 * QMI8658 INT2 DRDY GPIO and emitted only while enabled (typically when a
 * peer has motion CCCD notify on).
 */
esp_err_t sensor_stream_init(void);

/** @brief Start/stop sampling. When disabled, sensors stay powered but idle. */
void sensor_stream_set_enabled(bool enabled);

bool sensor_stream_is_enabled(void);

/**
 * @brief Request a sensor-native sample rate (56, 112, or 224 Hz).
 *
 * The I2C-owning task applies the change asynchronously. Query
 * sensor_stream_get_applied_rate_hz() / is_rate_applied() for confirmation.
 * No host-side decimation is used, so sample_index remains a uniform clock.
 * Safe from BLE callbacks.
 */
esp_err_t sensor_stream_set_rate_hz(uint8_t rate_hz);

/** @brief Last requested rate (may not yet be applied by hardware). */
uint8_t sensor_stream_get_rate_hz(void);

/** @brief Rate confirmed by the last successful IMU+MAG ODR update. */
uint8_t sensor_stream_get_applied_rate_hz(void);

/** @brief True when requested and applied rates match and no dirty request is pending. */
bool sensor_stream_is_rate_applied(void);

/** @brief Magnetometer ODR corresponding to the applied IMU profile. */
uint8_t sensor_stream_get_mag_rate_hz(void);

/**
 * @brief Register callback invoked after each DRDY-qualified sample.
 * Keep the callback short — queue/notify only; no I2C or blocking BLE.
 */
void sensor_stream_set_sample_cb(sensor_stream_sample_cb_t cb, void *ctx);

/** @brief Copy latest sample (non-blocking). Returns ESP_ERR_NOT_FOUND if none yet. */
esp_err_t sensor_stream_get_latest(sensor_proto_sample_t *out);

/**
 * @brief Copy latest sample packed as a legacy v1 20-byte frame.
 * Returns ESP_ERR_NOT_FOUND if none yet.
 */
esp_err_t sensor_stream_get_latest_frame_v1(sensor_proto_frame_t *out);

uint32_t sensor_stream_dropped_count(void);

/** @brief Current monotonic sample index (next value to be assigned). */
uint32_t sensor_stream_sample_index(void);

esp_err_t sensor_stream_get_meta(sensor_proto_meta_t *out);

#ifdef __cplusplus
}
#endif
