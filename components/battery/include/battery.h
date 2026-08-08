#pragma once

#include <stdint.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Initialize ADC oneshot on BOARD_BATTERY_ADC_GPIO.
 *
 * Assumes a 1:1 resistor divider (ADC sees Vbat/2). Calibrate
 * BOARD_BATTERY_DIVIDER_RATIO in board_pins.h if the schematic differs.
 */
esp_err_t battery_init(void);

/**
 * @brief Read pack voltage after divider compensation.
 * @param[out] millivolts Pack voltage in mV (e.g. 3700).
 */
esp_err_t battery_read_mv(uint16_t *millivolts);

/**
 * @brief Approximate LiPo state-of-charge from pack voltage.
 * @param[out] percent 0–100
 */
esp_err_t battery_read_percent(uint8_t *percent);

/**
 * @brief Read both millivolts and percent in one ADC sample.
 */
esp_err_t battery_read(uint16_t *millivolts, uint8_t *percent);

#ifdef __cplusplus
}
#endif
