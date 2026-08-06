#include "ui.h"

#include "board_pins.h"
#include "driver/gpio.h"
#include "esp_check.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"

static const char *TAG = "ui";
static QueueHandle_t s_led_q;
static uint8_t s_mode;

static void apply_leds(uint8_t mode)
{
    int green = (mode == 1 || mode == 3) ? 1 : 0;
    int blue = (mode == 2 || mode == 3) ? 1 : 0;
    gpio_set_level(BOARD_LED_GREEN_GPIO, green);
    gpio_set_level(BOARD_LED_BLUE_GPIO, blue);
    s_mode = mode;
    ESP_LOGI(TAG, "LED mode=%u G=%d B=%d", mode, green, blue);
}

static void ui_task(void *arg)
{
    (void)arg;
    uint8_t mode = 0;
    for (;;) {
        if (xQueueReceive(s_led_q, &mode, portMAX_DELAY) == pdTRUE) {
            if (mode <= 3) {
                apply_leds(mode);
            }
        }
    }
}

esp_err_t ui_init(void)
{
    gpio_config_t led_cfg = {
        .pin_bit_mask = (1ULL << BOARD_LED_GREEN_GPIO) | (1ULL << BOARD_LED_BLUE_GPIO),
        .mode = GPIO_MODE_OUTPUT,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&led_cfg), TAG, "led cfg");

    gpio_config_t btn_cfg = {
        .pin_bit_mask = (1ULL << BOARD_BUTTON_GPIO),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&btn_cfg), TAG, "btn cfg");

    apply_leds(0);

    s_led_q = xQueueCreate(4, sizeof(uint8_t));
    ESP_RETURN_ON_FALSE(s_led_q, ESP_ERR_NO_MEM, TAG, "queue");
    BaseType_t ok = xTaskCreate(ui_task, "ui", 2048, NULL, 4, NULL);
    ESP_RETURN_ON_FALSE(ok == pdPASS, ESP_ERR_NO_MEM, TAG, "task");
    return ESP_OK;
}

esp_err_t ui_set_led_mode(uint8_t mode)
{
    ESP_RETURN_ON_FALSE(s_led_q, ESP_ERR_INVALID_STATE, TAG, "no queue");
    ESP_RETURN_ON_FALSE(mode <= 3, ESP_ERR_INVALID_ARG, TAG, "mode");
    if (xQueueSend(s_led_q, &mode, 0) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }
    return ESP_OK;
}

uint8_t ui_get_led_mode(void)
{
    return s_mode;
}
