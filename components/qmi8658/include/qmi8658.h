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
    uint16_t accel_lsb_per_g;   /**< 2048 for the trajectory ±16 g profile */
    uint16_t gyro_lsb_per_dps;  /**< 16 for the trajectory ±2048 dps profile */
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
 * @brief Select an exact 6-DoF ODR (56 / 112 / 224 / 448 Hz).
 *
 * 448 Hz is CTRL2/CTRL3 ODR code 0x4 (datasheet 448.4 Hz). Accel-only 500 Hz
 * is not a 6-DoF rate. Must be called from the I2C-owning task.
 */
esp_err_t qmi8658_set_odr_for_rate(uint16_t rate_hz);

#ifdef __cplusplus
}
#endif
