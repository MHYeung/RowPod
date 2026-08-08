#include "power.h"

#include "board_pins.h"
#include "ble_tracker.h"
#include "driver/gpio.h"
#include "esp_sleep.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/timers.h"
#include "ui.h"

static const char *TAG = "power";
enum { IDLE_TIMEOUT_MS = 180000 };
static TaskHandle_t s_power_task;
static TimerHandle_t s_idle_timer;
static volatile bool s_connected;

static void idle_timer_cb(TimerHandle_t timer)
{
    (void)timer;
    /* Keep sleep and BLE calls out of the timer/interrupt-style callback. */
    xTaskNotifyGive(s_power_task);
}

static bool wait_for_wake_hold(void)
{
    const TickType_t start = xTaskGetTickCount();
    const TickType_t required = pdMS_TO_TICKS(BOARD_BUTTON_LONG_PRESS_MS);

    if (gpio_get_level(BOARD_BUTTON_GPIO) != 0) {
        return false;
    }
    while (gpio_get_level(BOARD_BUTTON_GPIO) == 0) {
        if ((xTaskGetTickCount() - start) >= required) {
            break;
        }
        vTaskDelay(pdMS_TO_TICKS(20));
    }
    if ((xTaskGetTickCount() - start) < required) {
        vTaskDelay(pdMS_TO_TICKS(30));
        return false;
    }
    while (gpio_get_level(BOARD_BUTTON_GPIO) == 0) {
        vTaskDelay(pdMS_TO_TICKS(20));
    }
    vTaskDelay(pdMS_TO_TICKS(30));
    return true;
}

static esp_err_t configure_button_wakeup(void)
{
    esp_err_t ret = gpio_wakeup_enable(BOARD_BUTTON_GPIO, GPIO_INTR_LOW_LEVEL);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "button wake GPIO: %s", esp_err_to_name(ret));
        return ret;
    }
    return esp_sleep_enable_gpio_wakeup();
}

static void power_task(void *arg)
{
    (void)arg;
    for (;;) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        if (s_connected) {
            continue;
        }
        ESP_LOGI(TAG, "BLE idle for %d minutes; entering light sleep",
                 IDLE_TIMEOUT_MS / 60000);
        ui_set_gestures_enabled(false);
        if (ble_tracker_stop_advertising() != ESP_OK) {
            ESP_LOGW(TAG, "BLE stop failed; staying awake");
            if (xTimerReset(s_idle_timer, 0) != pdPASS) {
                ESP_LOGW(TAG, "failed to retry idle timer");
            }
            ui_set_gestures_enabled(true);
            continue;
        }
        esp_err_t ui_ret = ui_set_state(UI_STATE_SLEEP);
        if (ui_ret != ESP_OK) {
            ESP_LOGW(TAG, "failed to switch LEDs off: %s",
                     esp_err_to_name(ui_ret));
        }
        vTaskDelay(pdMS_TO_TICKS(50));
        esp_err_t sleep_ret = esp_light_sleep_start();
        if (sleep_ret != ESP_OK) {
            ESP_LOGE(TAG, "light sleep failed: %s", esp_err_to_name(sleep_ret));
            ESP_ERROR_CHECK(ble_tracker_start_advertising());
            continue;
        }
        /* GPIO wakes on the edge; only a complete 2 s hold resumes BLE. */
        if (!wait_for_wake_hold()) {
            ESP_LOGI(TAG, "short button wake ignored; returning to sleep");
            xTaskNotifyGive(s_power_task);
            continue;
        }
        ESP_LOGI(TAG, "two-second button wake; restarting BLE");
        ESP_ERROR_CHECK(ble_tracker_start_advertising());
    }
}

esp_err_t power_init(void)
{
    esp_err_t ret = configure_button_wakeup();
    if (ret != ESP_OK) {
        return ret;
    }
    s_idle_timer = xTimerCreate("ble_idle", pdMS_TO_TICKS(IDLE_TIMEOUT_MS),
                                pdFALSE, NULL, idle_timer_cb);
    if (!s_idle_timer) {
        return ESP_ERR_NO_MEM;
    }
    if (xTaskCreate(power_task, "power", 3072, NULL, 5,
                    &s_power_task) != pdPASS) {
        if (xTimerDelete(s_idle_timer, 0) != pdPASS) {
            ESP_LOGW(TAG, "failed to delete idle timer");
        }
        s_idle_timer = NULL;
        return ESP_ERR_NO_MEM;
    }
    ESP_LOGI(TAG, "light sleep enabled after %d minutes without BLE",
             IDLE_TIMEOUT_MS / 60000);
    return ESP_OK;
}

void power_on_ble_link(bool connected)
{
    s_connected = connected;
    /* Awake gestures are handled by UI; mode/log actions filter by link state. */
    ui_set_gestures_enabled(true);
    if (!s_idle_timer) {
        ESP_LOGW(TAG, "BLE state before power init");
        return;
    }
    BaseType_t ok = connected ? xTimerStop(s_idle_timer, 0)
                             : xTimerReset(s_idle_timer, 0);
    if (ok != pdPASS) {
        ESP_LOGW(TAG, "failed to update BLE idle timer");
    }
}

void power_notify_activity(void)
{
    if (!s_idle_timer || s_connected) {
        return;
    }
    if (xTimerReset(s_idle_timer, 0) != pdPASS) {
        ESP_LOGW(TAG, "failed to reset idle timer");
    }
}
