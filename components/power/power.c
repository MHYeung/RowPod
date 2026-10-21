#include "power.h"

#include "board_pins.h"
#include "ble_tracker.h"
#include "driver/gpio.h"
#include "driver/usb_serial_jtag.h"
#include "esp_log.h"
#include "esp_sleep.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/timers.h"
#include "sensor_stream.h"
#include "ui.h"

static const char *TAG = "power";
enum { IDLE_TIMEOUT_MS = 180000 };

static TaskHandle_t s_power_task;
static TimerHandle_t s_idle_timer;
static volatile bool s_connected;

static void idle_timer_cb(TimerHandle_t timer)
{
    (void)timer;
    /* Keep sleep and BLE calls out of the timer callback. */
    xTaskNotifyGive(s_power_task);
}

static void config_button_input(void)
{
    gpio_config_t cfg = {
        .pin_bit_mask = 1ULL << BOARD_BUTTON_GPIO,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&cfg));
}

static void release_pad_holds(void)
{
    /* Configure before gpio_hold_dis. A released hold falls back to the
     * pad default, and an output-low default on the button looks like a press. */
    config_button_input();
    gpio_set_direction(BOARD_LED_GPIO, GPIO_MODE_OUTPUT);
    gpio_set_level(BOARD_LED_GPIO, 0);
    gpio_hold_dis(BOARD_BUTTON_GPIO);
    gpio_hold_dis(BOARD_LED_GPIO);
    gpio_deep_sleep_hold_dis();
}

static void hold_led_off(void)
{
    /* GPIO7 is a digital pad. gpio_hold_en alone does not keep it through
     * deep sleep on the C3; the deep-sleep hold does. */
    gpio_set_direction(BOARD_LED_GPIO, GPIO_MODE_OUTPUT);
    gpio_set_level(BOARD_LED_GPIO, 0);
    ESP_ERROR_CHECK(gpio_hold_en(BOARD_LED_GPIO));
    gpio_deep_sleep_hold_en();
}

static void arm_and_sleep(void)
{
    /* Level-low wake fires immediately if the pad is still low. */
    while (gpio_get_level(BOARD_BUTTON_GPIO) == 0) {
        vTaskDelay(pdMS_TO_TICKS(20));
    }
    vTaskDelay(pdMS_TO_TICKS(BOARD_BUTTON_DEBOUNCE_MS));
    hold_led_off();
    /* ESP-IDF 6: GPIO0-5 only. GPIO0 is in that mask. */
    ESP_ERROR_CHECK(esp_sleep_enable_gpio_wakeup_on_hp_periph_powerdown(
        1ULL << BOARD_BUTTON_GPIO, ESP_GPIO_WAKEUP_GPIO_LOW));
    ESP_LOGI(TAG, "deep sleep; hold GPIO%d low for %d ms to boot",
             BOARD_BUTTON_GPIO, BOARD_BUTTON_LONG_PRESS_MS);
    esp_deep_sleep_start();
}

void power_boot_gate(void)
{
    if ((esp_sleep_get_wakeup_causes() & BIT(ESP_SLEEP_WAKEUP_GPIO)) == 0) {
        return;
    }

    release_pad_holds();
    /* esp_timer starts after the bootloader, so a fast deep-sleep boot
     * (skip image validation) is what keeps the physical hold near 2 s. */
    const int64_t need_us = (int64_t)BOARD_BUTTON_LONG_PRESS_MS * 1000;
    while (esp_timer_get_time() < need_us) {
        if (gpio_get_level(BOARD_BUTTON_GPIO) != 0) {
            vTaskDelay(pdMS_TO_TICKS(BOARD_BUTTON_DEBOUNCE_MS));
            if (gpio_get_level(BOARD_BUTTON_GPIO) == 0) {
                continue;
            }
            /* The SOF hook starts "connected" and clears after a few ticks. */
            vTaskDelay(pdMS_TO_TICKS(20));
            if (usb_serial_jtag_is_connected()) {
                ESP_LOGI(TAG, "short wake, USB host present; continuing boot");
                return;
            }
            ESP_LOGI(TAG, "short button wake ignored");
            arm_and_sleep();
        }
        vTaskDelay(pdMS_TO_TICKS(20));
    }
    ESP_LOGI(TAG, "button held through boot");
}

static void stay_awake(const char *why)
{
    ESP_LOGW(TAG, "%s; staying awake", why);
    if (ble_tracker_start_advertising() != ESP_OK) {
        ESP_LOGW(TAG, "BLE restart failed");
    }
    ui_set_gestures_enabled(true);
    if (s_idle_timer && xTimerReset(s_idle_timer, 0) != pdPASS) {
        ESP_LOGW(TAG, "failed to retry idle timer");
    }
}

static void power_task(void *arg)
{
    (void)arg;
    for (;;) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        if (s_connected) {
            continue;
        }
        if (usb_serial_jtag_is_connected()) {
            ESP_LOGI(TAG, "USB host present; deep sleep skipped");
            if (s_idle_timer && xTimerReset(s_idle_timer, 0) != pdPASS) {
                ESP_LOGW(TAG, "failed to retry idle timer");
            }
            continue;
        }
        ESP_LOGI(TAG, "BLE idle for %d minutes; preparing deep sleep",
                 IDLE_TIMEOUT_MS / 60000);
        ui_set_gestures_enabled(false);
        if (ble_tracker_stop_advertising() != ESP_OK) {
            stay_awake("BLE stop failed");
            continue;
        }
        if (ui_prepare_sleep() != ESP_OK) {
            stay_awake("LED off failed");
            continue;
        }
        if (sensor_stream_prepare_sleep(pdMS_TO_TICKS(1000)) != ESP_OK) {
            stay_awake("IMU power-down failed");
            continue;
        }
        arm_and_sleep();
    }
}

esp_err_t power_init(void)
{
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
    ESP_LOGI(TAG, "deep sleep after %d minutes without BLE",
             IDLE_TIMEOUT_MS / 60000);
    return ESP_OK;
}

void power_on_ble_link(bool connected)
{
    s_connected = connected;
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
