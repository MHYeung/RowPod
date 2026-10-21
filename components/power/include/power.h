#pragma once

#include <stdbool.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Reject a short button wake before the rest of app_main runs.
 *
 * Deep sleep resets the chip, so the two-second hold is measured here, not in
 * the power task. A press that is already released returns to deep sleep.
 * Call this before NVS, BLE, or sensor init.
 */
void power_boot_gate(void);

/**
 * @brief Arm the three-minute BLE-idle deep-sleep policy.
 *
 * Wake is GPIO0 low. The hold is qualified by power_boot_gate() on the next boot.
 */
esp_err_t power_init(void);

/** @brief Report BLE link state from the NimBLE GAP callback. */
void power_on_ble_link(bool connected);

/** @brief Reset the idle timer after a local activity (e.g. mode toggle). */
void power_notify_activity(void);

#ifdef __cplusplus
}
#endif
