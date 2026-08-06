#include "battery.h"

#include "esp_log.h"

static const char *TAG = "battery";

esp_err_t battery_init(void)
{
    ESP_LOGI(TAG, "scaffold only — ADC on GPIO%d deferred", 2);
    return ESP_OK;
}
