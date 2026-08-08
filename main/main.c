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

static void on_long_press(void)
{
    device_mode_t mode = DEVICE_MODE_SINGLE;
    if (device_config_toggle_mode(&mode) != ESP_OK) {
        ESP_LOGW(TAG, "mode toggle failed");
        return;
    }
    power_notify_activity();
    (void)ui_flash_mode_ack();
    esp_err_t ret = ble_tracker_refresh_advertising();
    if (ret != ESP_OK) {
        ESP_LOGW(TAG, "advertising refresh: %s", esp_err_to_name(ret));
    }
    ESP_LOGI(TAG, "mode is now %s",
             mode == DEVICE_MODE_MULTI ? "multi-pod" : "single-pod");
}

void app_main(void)
{
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);
    ESP_ERROR_CHECK(esp_event_loop_create_default());

    ESP_ERROR_CHECK(device_config_init());
    ESP_ERROR_CHECK(ui_init());
    ESP_ERROR_CHECK(ui_set_long_press_cb(on_long_press));
    ESP_ERROR_CHECK(battery_init());
    ESP_ERROR_CHECK(power_init());
    ESP_ERROR_CHECK(sensor_stream_init());
    ESP_ERROR_CHECK(ble_tracker_set_link_cb(power_on_ble_link));
    ESP_ERROR_CHECK(ble_tracker_init());

    char name[DEVICE_CONFIG_NAME_MAX + 1] = {0};
    (void)device_config_get_adv_name(name, sizeof(name));
    ESP_LOGI(TAG, "ready as \"%s\" — long-press to toggle single/multi", name);
}
