#include "battery.h"
#include "ble_tracker.h"
#include "device_config.h"
#include "esp_event.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"
#include "power.h"
#include "sensor_stream.h"
#include "ui.h"

static const char *TAG = "main";

static void on_button_event(ui_button_event_t event)
{
    if (event == UI_BUTTON_SINGLE_TAP) {
        if (!ble_tracker_is_connected()) {
            ESP_LOGI(TAG, "single tap ignored while not connected");
            return;
        }
        bool enabled = false;
        esp_err_t ret = ble_tracker_toggle_streaming(&enabled);
        if (ret != ESP_OK) {
            ESP_LOGW(TAG, "stream toggle failed: %s", esp_err_to_name(ret));
            return;
        }
        ESP_LOGI(TAG, "single tap: logging stream %s",
                 enabled ? "started" : "stopped");
        return;
    }

    /* Deep-sleep wake is qualified in power_boot_gate(); no awake action. */
    ESP_LOGI(TAG, "long press handled as sleep-wake gesture");
}

void app_main(void)
{
    power_boot_gate(); /* may deep-sleep again; returns only for a real boot */
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);
    ESP_ERROR_CHECK(esp_event_loop_create_default());

    ESP_ERROR_CHECK(device_config_init());
    ESP_ERROR_CHECK(ui_init());
    ESP_ERROR_CHECK(ui_set_button_event_cb(on_button_event));
    ESP_ERROR_CHECK(battery_init());
    ESP_ERROR_CHECK(power_init());
    ESP_ERROR_CHECK(sensor_stream_init());
    ESP_ERROR_CHECK(ble_tracker_set_link_cb(power_on_ble_link));
    ESP_ERROR_CHECK(ble_tracker_init());

    char name[DEVICE_CONFIG_NAME_MAX + 1] = {0};
    (void)device_config_get_adv_name(name, sizeof(name));
    ESP_LOGI(TAG, "ready as \"%s\" — host selects multiple pods; profile=%u",
             name, ble_tracker_get_workout_profile());
}
