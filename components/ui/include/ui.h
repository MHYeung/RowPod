#pragma once

#include <stdbool.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/** @brief Configure the blue status LED and the active-low user button. */
esp_err_t ui_init(void);

typedef enum {
    UI_STATE_SLEEP,      /**< Blue LED off. */
    UI_STATE_WAITING,    /**< Blue LED breathes while advertising. */
    UI_STATE_CONNECTED,  /**< Dim blue while linked. */
    UI_STATE_STREAMING,  /**< Same as connected (power-saving link lamp). */
} ui_state_t;

/** @brief Queue a status state change; safe from BLE callbacks. */
esp_err_t ui_set_state(ui_state_t state);

/**
 * @brief Drive the status LED off and wait until the UI task has stopped PWM.
 *
 * Call from the power task before holding the pad for deep sleep.
 */
esp_err_t ui_prepare_sleep(void);

typedef enum {
    UI_BUTTON_SINGLE_TAP,
    UI_BUTTON_LONG_PRESS,
} ui_button_event_t;

typedef void (*ui_button_event_cb_t)(ui_button_event_t event);

/**
 * @brief Register callbacks for debounced button gestures.
 *
 * Single-tap is available while connected for the BLE stream/log toggle. A
 * long press is reported while awake; deep-sleep wake qualification runs at
 * boot in the power component.
 */
esp_err_t ui_set_button_event_cb(ui_button_event_cb_t cb);

/**
 * @brief Enable or disable gesture recognition.
 *
 * Pass true while awake. Wake-from-sleep must leave gestures disarmed until
 * the wake press is released.
 */
void ui_set_gestures_enabled(bool enabled);

#ifdef __cplusplus
}
#endif
