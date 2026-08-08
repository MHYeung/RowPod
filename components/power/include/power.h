#pragma once

#include <stdbool.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Initialize the three-minute BLE idle light-sleep policy.
 *
 * GPIO wake is qualified as a continuous two-second button hold before BLE
 * advertising resumes.
 */
esp_err_t power_init(void);

/** @brief Report BLE link state from the NimBLE GAP callback. */
void power_on_ble_link(bool connected);

/** @brief Reset the idle timer after a local activity (e.g. mode toggle). */
void power_notify_activity(void);

#ifdef __cplusplus
}
#endif
