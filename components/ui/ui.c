#include "ui.h"

#include "board_pins.h"
#include "driver/gpio.h"
#include "driver/ledc.h"
#include "esp_check.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"

static const char *TAG = "ui";
static QueueHandle_t s_state_q;
static ui_long_press_cb_t s_long_press_cb;
static volatile bool s_gestures_enabled;
static volatile bool s_flash_ack;

enum {
    BREATH_STEPS = 64,
    BREATH_STEP_MS = 2000 / BREATH_STEPS,
    LEDC_DUTY_MAX = (1U << LEDC_TIMER_13_BIT) - 1U,
    /* Waiting breath peak ~25%; connected link lamp ~5% blue only. */
    LED_STATUS_DUTY_MAX = LEDC_DUTY_MAX / 4,
    LED_LINK_DUTY = LEDC_DUTY_MAX / 20,
    LONG_PRESS_MS = 2000,
    DEBOUNCE_MS = 30,
    BTN_POLL_MS = 20,
};

static uint32_t breath_duty(uint8_t phase)
{
    uint8_t level = phase <= BREATH_STEPS / 2
                        ? phase : BREATH_STEPS - phase;
    return (uint32_t)level * LED_STATUS_DUTY_MAX / (BREATH_STEPS / 2);
}

static void set_led_duty(ledc_channel_t channel, uint32_t duty)
{
    /* Only ui_task touches these channels, so direct updates are safe. */
    ESP_ERROR_CHECK(ledc_set_duty(LEDC_LOW_SPEED_MODE, channel, duty));
    ESP_ERROR_CHECK(ledc_update_duty(LEDC_LOW_SPEED_MODE, channel));
}

static void apply_state(ui_state_t state)
{
    /* Green stays off once linked — saves pack current for ADC/runtime. */
    set_led_duty(LEDC_CHANNEL_1, 0);
    if (state == UI_STATE_CONNECTED || state == UI_STATE_STREAMING) {
        set_led_duty(LEDC_CHANNEL_0, LED_LINK_DUTY);
    } else if (state != UI_STATE_WAITING) {
        set_led_duty(LEDC_CHANNEL_0, 0);
    }
}

static void run_flash_ack(void)
{
    for (int i = 0; i < 2; i++) {
        set_led_duty(LEDC_CHANNEL_0, LED_STATUS_DUTY_MAX);
        set_led_duty(LEDC_CHANNEL_1, LED_STATUS_DUTY_MAX);
        vTaskDelay(pdMS_TO_TICKS(80));
        set_led_duty(LEDC_CHANNEL_0, 0);
        set_led_duty(LEDC_CHANNEL_1, 0);
        vTaskDelay(pdMS_TO_TICKS(80));
    }
}

static void poll_button(ui_state_t state)
{
    static bool pressed;
    static bool fired;
    static TickType_t press_start;
    static TickType_t stable_since;
    static int last_level = 1;

    if (!s_gestures_enabled || state != UI_STATE_WAITING) {
        pressed = false;
        fired = false;
        last_level = gpio_get_level(BOARD_BUTTON_GPIO);
        return;
    }

    int level = gpio_get_level(BOARD_BUTTON_GPIO);
    TickType_t now = xTaskGetTickCount();
    if (level != last_level) {
        last_level = level;
        stable_since = now;
        return;
    }
    if ((now - stable_since) < pdMS_TO_TICKS(DEBOUNCE_MS)) {
        return;
    }

    if (level == 0) {
        if (!pressed) {
            pressed = true;
            fired = false;
            press_start = now;
        } else if (!fired &&
                   (now - press_start) >= pdMS_TO_TICKS(LONG_PRESS_MS)) {
            fired = true;
            ESP_LOGI(TAG, "long press");
            if (s_long_press_cb) {
                s_long_press_cb();
            }
        }
    } else {
        pressed = false;
        fired = false;
    }
}

static void ui_task(void *arg)
{
    (void)arg;
    ui_state_t state = UI_STATE_SLEEP;
    uint8_t phase = 0;
    for (;;) {
        ui_state_t requested;
        if (xQueueReceive(s_state_q, &requested,
                          pdMS_TO_TICKS(BTN_POLL_MS)) == pdTRUE) {
            state = requested;
            phase = 0;
            apply_state(state);
        } else if (s_flash_ack) {
            s_flash_ack = false;
            run_flash_ack();
            apply_state(state);
        } else if (state == UI_STATE_WAITING) {
            set_led_duty(LEDC_CHANNEL_0, breath_duty(phase++ % BREATH_STEPS));
        }
        poll_button(state);
    }
}

static void init_status_led_pwm(void)
{
    ledc_timer_config_t timer = {
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .timer_num = LEDC_TIMER_0,
        .duty_resolution = LEDC_TIMER_13_BIT,
        .freq_hz = 5000,
        .clk_cfg = LEDC_AUTO_CLK,
    };
    ESP_ERROR_CHECK(ledc_timer_config(&timer));
    ledc_channel_config_t channel = {
        .gpio_num = BOARD_LED_BLUE_GPIO,
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .channel = LEDC_CHANNEL_0,
        .intr_type = LEDC_INTR_DISABLE,
        .timer_sel = LEDC_TIMER_0,
        .duty = 0,
        .hpoint = 0,
    };
    ESP_ERROR_CHECK(ledc_channel_config(&channel));
    channel.gpio_num = BOARD_LED_GREEN_GPIO;
    channel.channel = LEDC_CHANNEL_1;
    ESP_ERROR_CHECK(ledc_channel_config(&channel));
}

esp_err_t ui_init(void)
{
    init_status_led_pwm();

    gpio_config_t btn_cfg = {
        .pin_bit_mask = (1ULL << BOARD_BUTTON_GPIO),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&btn_cfg), TAG, "btn cfg");

    apply_state(UI_STATE_SLEEP);

    s_state_q = xQueueCreate(1, sizeof(ui_state_t));
    ESP_RETURN_ON_FALSE(s_state_q, ESP_ERR_NO_MEM, TAG, "state queue");
    BaseType_t ok = xTaskCreate(ui_task, "ui", 2048, NULL, 4, NULL);
    ESP_RETURN_ON_FALSE(ok == pdPASS, ESP_ERR_NO_MEM, TAG, "task");
    return ESP_OK;
}

esp_err_t ui_set_state(ui_state_t state)
{
    ESP_RETURN_ON_FALSE(s_state_q, ESP_ERR_INVALID_STATE, TAG, "no state queue");
    ESP_RETURN_ON_FALSE(state <= UI_STATE_STREAMING, ESP_ERR_INVALID_ARG, TAG, "state");
    if (xQueueOverwrite(s_state_q, &state) != pdPASS) {
        return ESP_ERR_TIMEOUT;
    }
    return ESP_OK;
}

esp_err_t ui_set_long_press_cb(ui_long_press_cb_t cb)
{
    s_long_press_cb = cb;
    return ESP_OK;
}

void ui_set_gestures_enabled(bool enabled)
{
    s_gestures_enabled = enabled;
}

esp_err_t ui_flash_mode_ack(void)
{
    s_flash_ack = true;
    return ESP_OK;
}
