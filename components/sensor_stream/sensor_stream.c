#include "sensor_stream.h"

#include "esp_check.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "i2c_bus.h"
#include "qmc5883p.h"
#include "qmi8658.h"

static const char *TAG = "sensor_stream";

static TaskHandle_t s_task;
static QueueHandle_t s_latest_q;
static volatile bool s_enabled;
static volatile uint32_t s_dropped;
static sensor_stream_frame_cb_t s_cb;
static void *s_cb_ctx;
static sensor_proto_meta_t s_meta;
static uint16_t s_seq;

static void stream_task(void *arg)
{
    (void)arg;
    TickType_t last = xTaskGetTickCount();
    const TickType_t period = pdMS_TO_TICKS(1000 / SENSOR_PROTO_RATE_HZ);

    for (;;) {
        if (!s_enabled) {
            vTaskDelay(pdMS_TO_TICKS(50));
            last = xTaskGetTickCount();
            continue;
        }

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
            ESP_LOGW(TAG, "sample fail IMU=%s MAG=%s", esp_err_to_name(e1), esp_err_to_name(e2));
            s_dropped++;
        }

        vTaskDelayUntil(&last, period);
    }
}

esp_err_t sensor_stream_init(void)
{
    ESP_RETURN_ON_ERROR(i2c_bus_init(), TAG, "i2c");
    ESP_RETURN_ON_ERROR(qmi8658_init(), TAG, "imu");
    ESP_RETURN_ON_ERROR(qmc5883p_init(), TAG, "mag");

    qmi8658_scale_t as = {0};
    qmc5883p_scale_t ms = {0};
    ESP_RETURN_ON_ERROR(qmi8658_get_scale(&as), TAG, "a scale");
    ESP_RETURN_ON_ERROR(qmc5883p_get_scale(&ms), TAG, "m scale");

    s_meta = (sensor_proto_meta_t){
        .ver = SENSOR_PROTO_FORMAT_VER,
        .rate_hz = SENSOR_PROTO_RATE_HZ,
        .accel_lsb_per_g = as.accel_lsb_per_g,
        .gyro_lsb_per_dps = as.gyro_lsb_per_dps,
        .mag_lsb_per_gauss = ms.lsb_per_gauss,
        .flags = 0,
        .reserved = 0,
    };

    s_latest_q = xQueueCreate(1, sizeof(sensor_proto_frame_t));
    ESP_RETURN_ON_FALSE(s_latest_q, ESP_ERR_NO_MEM, TAG, "queue");

    BaseType_t ok = xTaskCreate(stream_task, "sensor_stream", 4096, NULL, 5, &s_task);
    ESP_RETURN_ON_FALSE(ok == pdPASS, ESP_ERR_NO_MEM, TAG, "task");
    ESP_LOGI(TAG, "ready @ %u Hz (paused until enable)", SENSOR_PROTO_RATE_HZ);
    return ESP_OK;
}

void sensor_stream_set_enabled(bool enabled)
{
    s_enabled = enabled;
    ESP_LOGI(TAG, "stream %s", enabled ? "ON" : "OFF");
}

bool sensor_stream_is_enabled(void)
{
    return s_enabled;
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
