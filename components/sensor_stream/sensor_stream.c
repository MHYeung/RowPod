#include "sensor_stream.h"

#include "board_pins.h"
#include "esp_check.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "i2c_bus.h"
#include "qmc5883p.h"
#include "qmi8658.h"

static const char *TAG = "sensor_stream";

enum {
    TASK_NOTIFY_DRDY = 1u << 0,
    TASK_NOTIFY_CONTROL = 1u << 1,
};

static TaskHandle_t s_task;
static QueueHandle_t s_latest_q;
static volatile bool s_enabled;
static volatile uint8_t s_rate_hz = SENSOR_PROTO_RATE_LIVE_HZ;
static volatile bool s_rate_dirty;
static volatile uint32_t s_dropped;
static sensor_stream_frame_cb_t s_cb;
static void *s_cb_ctx;
static sensor_proto_meta_t s_meta;
static uint16_t s_seq;
static uint64_t s_next_emit_us;

static bool rate_allowed(uint8_t hz)
{
    return hz == 50 || hz == 100 || hz == 150;
}

static void IRAM_ATTR imu_drdy_isr(void *arg)
{
    TaskHandle_t task = (TaskHandle_t)arg;
    if (!s_enabled || !task) {
        return;
    }
    BaseType_t higher_priority_woken = pdFALSE;
    xTaskNotifyFromISR(task, TASK_NOTIFY_DRDY, eSetBits,
                       &higher_priority_woken);
    if (higher_priority_woken == pdTRUE) {
        portYIELD_FROM_ISR();
    }
}

static esp_err_t init_drdy_gpio(void)
{
    gpio_config_t cfg = {
        .pin_bit_mask = 1ULL << BOARD_IMU_INT2_GPIO,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_POSEDGE,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&cfg), TAG, "IMU DRDY GPIO%d",
                        BOARD_IMU_INT2_GPIO);

    esp_err_t ret = gpio_install_isr_service(ESP_INTR_FLAG_IRAM);
    if (ret != ESP_OK && ret != ESP_ERR_INVALID_STATE) {
        return ret;
    }
    if (ret == ESP_ERR_INVALID_STATE) {
        ESP_LOGI(TAG, "GPIO ISR service already installed");
    }
    return ESP_OK;
}

static void stream_task(void *arg)
{
    (void)arg;
    uint8_t applied = s_rate_hz;

    for (;;) {
        if (s_rate_dirty) {
            uint8_t want = s_rate_hz;
            if (qmi8658_set_odr_for_rate(want) == ESP_OK) {
                applied = want;
                s_meta.rate_hz = want;
            } else {
                ESP_LOGW(TAG, "ODR update failed; keeping %u Hz period", applied);
            }
            s_rate_dirty = false;
            s_next_emit_us = 0;
        }

        if (!s_enabled) {
            uint32_t notification = 0;
            (void)xTaskNotifyWait(0, UINT32_MAX, &notification,
                                  portMAX_DELAY);
            continue;
        }

        /* GPIO INT2 DRDY is the only sampling clock; no fixed-rate polling. */
        uint32_t notification = 0;
        if (xTaskNotifyWait(0, UINT32_MAX, &notification, portMAX_DELAY) !=
                pdTRUE ||
            (notification & TASK_NOTIFY_DRDY) == 0) {
            continue;
        }
        uint64_t now_us = (uint64_t)esp_timer_get_time();
        uint32_t period_us = 1000000U / (applied ? applied : 50U);
        if (s_next_emit_us != 0 && now_us < s_next_emit_us) {
            continue;
        }
        if (s_next_emit_us == 0) {
            s_next_emit_us = now_us;
        }
        do {
            s_next_emit_us += period_us;
        } while (s_next_emit_us <= now_us);

        qmi8658_raw_t imu = {0};
        qmc5883p_raw_t mag = {0};
        esp_err_t e1 = qmi8658_read_raw(&imu);
        esp_err_t e2 = qmc5883p_read_raw(&mag);

        if (e1 == ESP_OK && e2 == ESP_OK) {
            sensor_proto_frame_t frame = {
                .seq = s_seq++,
                .ax = imu.ax,
                .ay = imu.ay,
                .az = imu.az,
                .gx = imu.gx,
                .gy = imu.gy,
                .gz = imu.gz,
                .mx = mag.mx,
                .my = mag.my,
                .mz = mag.mz,
            };

            /* Length-1 latest queue: overwrite stale samples. */
            if (xQueueOverwrite(s_latest_q, &frame) != pdTRUE) {
                s_dropped++;
            }
            if (s_cb) {
                s_cb(&frame, s_cb_ctx);
            }
        } else {
            ESP_LOGW(TAG, "sample fail IMU=%s MAG=%s", esp_err_to_name(e1),
                     esp_err_to_name(e2));
            s_dropped++;
        }

    }
}

esp_err_t sensor_stream_init(void)
{
    ESP_RETURN_ON_ERROR(init_drdy_gpio(), TAG, "DRDY GPIO");
    ESP_RETURN_ON_ERROR(i2c_bus_init(), TAG, "i2c");
    ESP_RETURN_ON_ERROR(qmi8658_init(), TAG, "imu");
    ESP_RETURN_ON_ERROR(qmc5883p_init(), TAG, "mag");
    ESP_RETURN_ON_ERROR(qmi8658_set_odr_for_rate(SENSOR_PROTO_RATE_LIVE_HZ), TAG,
                        "odr");

    qmi8658_scale_t as = {0};
    qmc5883p_scale_t ms = {0};
    ESP_RETURN_ON_ERROR(qmi8658_get_scale(&as), TAG, "a scale");
    ESP_RETURN_ON_ERROR(qmc5883p_get_scale(&ms), TAG, "m scale");

    s_rate_hz = SENSOR_PROTO_RATE_LIVE_HZ;
    s_rate_dirty = false;
    s_meta = (sensor_proto_meta_t){
        .ver = SENSOR_PROTO_FORMAT_VER,
        .rate_hz = SENSOR_PROTO_RATE_LIVE_HZ,
        .accel_lsb_per_g = as.accel_lsb_per_g,
        .gyro_lsb_per_dps = as.gyro_lsb_per_dps,
        .mag_lsb_per_gauss = ms.lsb_per_gauss,
        .flags = 0,
        .reserved = 0,
    };

    s_latest_q = xQueueCreate(1, sizeof(sensor_proto_frame_t));
    ESP_RETURN_ON_FALSE(s_latest_q, ESP_ERR_NO_MEM, TAG, "queue");

    BaseType_t ok =
        xTaskCreate(stream_task, "sensor_stream", 4096, NULL, 5, &s_task);
    ESP_RETURN_ON_FALSE(ok == pdPASS, ESP_ERR_NO_MEM, TAG, "task");
    ESP_RETURN_ON_ERROR(gpio_isr_handler_add(BOARD_IMU_INT2_GPIO,
                                             imu_drdy_isr, s_task),
                        TAG, "DRDY ISR");
    ESP_LOGI(TAG, "ready @ %u Hz live (paused until enable)",
             SENSOR_PROTO_RATE_LIVE_HZ);
    return ESP_OK;
}

void sensor_stream_set_enabled(bool enabled)
{
    s_enabled = enabled;
    if (s_task) {
        xTaskNotify(s_task, TASK_NOTIFY_CONTROL, eSetBits);
    }
    ESP_LOGI(TAG, "stream %s", enabled ? "ON" : "OFF");
}

bool sensor_stream_is_enabled(void)
{
    return s_enabled;
}

esp_err_t sensor_stream_set_rate_hz(uint8_t rate_hz)
{
    if (!rate_allowed(rate_hz)) {
        return ESP_ERR_INVALID_ARG;
    }
    s_rate_hz = rate_hz;
    s_meta.rate_hz = rate_hz;
    s_rate_dirty = true;
    if (s_task) {
        xTaskNotify(s_task, TASK_NOTIFY_CONTROL, eSetBits);
    }
    ESP_LOGI(TAG, "rate request %u Hz", rate_hz);
    return ESP_OK;
}

uint8_t sensor_stream_get_rate_hz(void)
{
    return s_rate_hz;
}

void sensor_stream_set_frame_cb(sensor_stream_frame_cb_t cb, void *ctx)
{
    s_cb = cb;
    s_cb_ctx = ctx;
}

esp_err_t sensor_stream_get_latest(sensor_proto_frame_t *out)
{
    ESP_RETURN_ON_FALSE(out && s_latest_q, ESP_ERR_INVALID_STATE, TAG, "bad");
    if (xQueuePeek(s_latest_q, out, 0) != pdTRUE) {
        return ESP_ERR_NOT_FOUND;
    }
    return ESP_OK;
}

uint32_t sensor_stream_dropped_count(void)
{
    return s_dropped;
}

esp_err_t sensor_stream_get_meta(sensor_proto_meta_t *out)
{
    ESP_RETURN_ON_FALSE(out, ESP_ERR_INVALID_ARG, TAG, "null");
    *out = s_meta;
    return ESP_OK;
}
