#pragma once

#include <stdbool.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/** @brief Configure status LEDs and the active-low user button. */
esp_err_t ui_init(void);

typedef enum {
    UI_STATE_SLEEP,      /**< Both LEDs off. */
    UI_STATE_WAITING,    /**< Blue LED breathes while advertising. */
    UI_STATE_CONNECTED,  /**< Green off; dim blue while linked. */
    UI_STATE_STREAMING,  /**< Same as connected (power-saving link lamp). */
} ui_state_t;

/** @brief Queue a status state change; safe from BLE callbacks. */
esp_err_t ui_set_state(ui_state_t state);

typedef void (*ui_long_press_cb_t)(void);

/**
 * @brief Register a callback for a ~2 s button hold while advertising.
 *
 * The light-sleep wake hold is ignored; call ui_arm_gestures() after wake.
 */
esp_err_t ui_set_long_press_cb(ui_long_press_cb_t cb);

/**
 * @brief Enable or disable gesture recognition.
 *
 * Pass true only while awake and advertising. Wake-from-sleep must leave
 * gestures disarmed until the wake press is released.
 */
void ui_set_gestures_enabled(bool enabled);

/** @brief Flash both LEDs briefly to confirm a mode change. */
esp_err_t ui_flash_mode_ack(void);

#ifdef __cplusplus
}
#endif
