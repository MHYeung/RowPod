#pragma once

#include <stdint.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    int16_t mx;
    int16_t my;
    int16_t mz;
} qmc5883p_raw_t;

typedef struct {
    uint16_t lsb_per_gauss; /**< 3750 for the trajectory ±8 G profile */
    uint8_t range_code;
    uint8_t odr_hz;
} qmc5883p_scale_t;

/**
 * @brief Probe, reset, and configure 200 Hz normal mode at ±8 G.
 *
 * The assembled-board XYZ sign register and set/reset excitation are also
 * configured before sampling.
 * Must be called from the I2C-owning task.
 */
esp_err_t qmc5883p_init(void);

/**
 * @brief Match magnetometer ODR to an IMU capture profile.
 *
 * Maps 56/112/224 Hz IMU profiles to 50/100/200 Hz magnetometer ODR.
 * Must be called from the I2C-owning task.
 */
esp_err_t qmc5883p_set_odr_for_rate(uint8_t imu_rate_hz);

esp_err_t qmc5883p_read_raw(qmc5883p_raw_t *out);
esp_err_t qmc5883p_get_scale(qmc5883p_scale_t *out);

#ifdef __cplusplus
}
#endif
