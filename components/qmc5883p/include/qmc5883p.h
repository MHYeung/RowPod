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
    uint16_t lsb_per_gauss; /**< e.g. 1000 for ±30 G */
    uint8_t range_code;
    uint8_t odr_hz;
} qmc5883p_scale_t;

/**
 * @brief Probe CHIPID, soft-reset, set continuous mode + explicit range.
 * Must be called from the I2C-owning task.
 */
esp_err_t qmc5883p_init(void);

esp_err_t qmc5883p_read_raw(qmc5883p_raw_t *out);
esp_err_t qmc5883p_get_scale(qmc5883p_scale_t *out);

#ifdef __cplusplus
}
#endif
