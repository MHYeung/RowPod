#pragma once

#include <stdint.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Configure LEDs and button; start a small UI task for queued LED cmds.
 *
 * LED mode (Nordic LBS compatible extension):
 * 0=off, 1=green, 2=blue, 3=both
 */
esp_err_t ui_init(void);

/** @brief Queue an LED mode change (safe from BLE callbacks). */
esp_err_t ui_set_led_mode(uint8_t mode);

uint8_t ui_get_led_mode(void);

#ifdef __cplusplus
}
#endif
