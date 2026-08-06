#include "battery.h"
#include "ble_tracker.h"
#include "esp_event.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"
#include "power.h"
#include "sensor_stream.h"
#include "ui.h"

static const char *TAG = "main";

void app_main(void)
{
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);
    ESP_ERROR_CHECK(esp_event_loop_create_default());

    ESP_ERROR_CHECK(ui_init());
    ESP_ERROR_CHECK(battery_init());
    ESP_ERROR_CHECK(power_init());
    ESP_ERROR_CHECK(sensor_stream_init());
    ESP_ERROR_CHECK(ble_tracker_init());

    ESP_LOGI(TAG, "C3-Tracker ready — subscribe to motion notify for 100 Hz stream");
}
