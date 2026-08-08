#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/** Max complete local name length for the scan-response AD structure. */
#define DEVICE_CONFIG_NAME_MAX 20

typedef enum {
    DEVICE_MODE_SINGLE = 0,
    DEVICE_MODE_MULTI = 1,
} device_mode_t;

/**
 * @brief Load persisted mode/name/pod_id from NVS (or create defaults).
 *
 * Call after nvs_flash_init() and before ble_tracker_init().
 */
esp_err_t device_config_init(void);

device_mode_t device_config_get_mode(void);

/** @brief Toggle single/multi and persist. Returns the new mode. */
esp_err_t device_config_toggle_mode(device_mode_t *out_mode);

/** @brief Stable 16-bit pod identifier derived once and stored in NVS. */
uint16_t device_config_get_pod_id(void);

/**
 * @brief Copy the active advertised name (custom or mode default).
 *
 * @param out Buffer of at least DEVICE_CONFIG_NAME_MAX + 1 bytes.
 */
esp_err_t device_config_get_adv_name(char *out, size_t out_len);

/** @brief True when a custom position/name has been stored. */
bool device_config_has_custom_name(void);

/**
 * @brief Persist a custom position/name used as the BLE advertised name.
 *
 * Empty string clears the custom name and restores the mode default.
 */
esp_err_t device_config_set_name(const char *name);

#ifdef __cplusplus
}
#endif
