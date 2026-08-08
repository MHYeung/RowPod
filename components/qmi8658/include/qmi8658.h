#pragma once

#include <stdint.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    int16_t ax;
    int16_t ay;
    int16_t az;
    int16_t gx;
    int16_t gy;
    int16_t gz;
} qmi8658_raw_t;

typedef struct {
    uint16_t accel_lsb_per_g;   /**< e.g. 4096 for ±8 g */
    uint16_t gyro_lsb_per_dps;  /**< 32 for the hand-turn ±1024 dps profile */
    uint8_t accel_fs_code;
    uint8_t gyro_fs_code;
} qmi8658_scale_t;

/**
 * @brief Probe WHO_AM_I, soft-reset, enable accel+gyro and DRDY on INT2.
 *
 * Must be called from the task that owns the I2C bus.
 */
esp_err_t qmi8658_init(void);

/** @brief Read contiguous accel+gyro raw registers (little-endian int16). */
esp_err_t qmi8658_read_raw(qmi8658_raw_t *out);

/** @brief Scale metadata matching the last successful init configuration. */
esp_err_t qmi8658_get_scale(qmi8658_scale_t *out);

/**
 * @brief Select IMU ODR band for a target host sample rate (50 / 100 / 150 Hz).
 *
 * Must be called from the I2C-owning task (sensor_stream).
 */
esp_err_t qmi8658_set_odr_for_rate(uint8_t rate_hz);

#ifdef __cplusplus
}
#endif
