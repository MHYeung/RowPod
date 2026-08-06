#include "power.h"

#include "esp_log.h"

static const char *TAG = "power";

esp_err_t power_init(void)
{
    ESP_LOGI(TAG, "scaffold only — sleep/wake deferred");
    return ESP_OK;
}
