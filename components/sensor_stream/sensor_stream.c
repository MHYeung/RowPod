#include "device_config.h"
#include "rowing_metrics.h"
#include "sensor_stream.h"

#include <inttypes.h>

#include "board_pins.h"
#include "esp_check.h"
#include "esp_log.h"
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h" // IWYU pragma: keep
#include "freertos/queue.h"
#include "freertos/task.h"
#include "i2c_bus.h"
#include "mahony.h"
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
static volatile uint16_t s_requested_rate_hz = SENSOR_PROTO_RATE_LIVE_HZ;
static volatile uint16_t s_applied_rate_hz = SENSOR_PROTO_RATE_LIVE_HZ;
static volatile uint8_t s_mag_rate_hz = 50;
static volatile bool s_rate_dirty;
static volatile uint32_t s_dropped;
static volatile uint32_t s_drdy_count;
static volatile uint32_t s_sample_index;
static sensor_stream_sample_cb_t s_cb;
static void *s_cb_ctx;
static sensor_proto_meta_t s_meta;
static qmc5883p_raw_t s_last_mag;
static bool s_have_mag;
static uint8_t s_mag_stride = 1;
static uint8_t s_mag_div;
static mahony_state_t s_mahony;
static uint16_t s_accel_lsb = 2048;
static uint16_t s_gyro_lsb = 16;
static uint16_t s_mag_lsb = 3750;

#define DEG_TO_RAD 0.01745329252f

static bool rate_allowed(uint16_t hz)
{
    return hz == SENSOR_PROTO_RATE_LIVE_HZ ||
           hz == SENSOR_PROTO_RATE_LOG_HZ ||
           hz == SENSOR_PROTO_RATE_HIGH_HZ ||
           hz == SENSOR_PROTO_RATE_CAPTURE_HZ;
}

static uint8_t mag_hz_for_imu(uint16_t imu_hz)
{
    if (imu_hz == SENSOR_PROTO_RATE_LIVE_HZ) {
        return 50;
    }
    if (imu_hz == SENSOR_PROTO_RATE_LOG_HZ ||
        imu_hz == SENSOR_PROTO_RATE_CAPTURE_HZ) {
        return 100;
    }
    return 200;
}

/**
 * Read mag every N IMU DRDYs so I2C stays near the mag ODR (~10 ms at 448/100).
 */
static uint8_t mag_stride_for(uint16_t imu_hz, uint8_t mag_hz)
{
    if (mag_hz == 0 || imu_hz <= mag_hz) {
        return 1;
    }
    uint16_t n = (uint16_t)((imu_hz + mag_hz / 2u) / mag_hz);
    if (n < 1) {
        return 1;
    }
    if (n > 8) {
        return 8;
    }
    return (uint8_t)n;
}

static void IRAM_ATTR imu_drdy_isr(void *arg)
{
    TaskHandle_t task = (TaskHandle_t)arg;
    if (!s_enabled || !task) {
        return;
    }
    s_drdy_count++;
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
    uint32_t last_drdy_count = 0;

    for (;;) {
        if (s_rate_dirty) {
            uint16_t want = s_requested_rate_hz;
            esp_err_t imu_err = qmi8658_set_odr_for_rate(want);
            esp_err_t mag_err = qmc5883p_set_odr_for_rate(want);
            if (imu_err == ESP_OK && mag_err == ESP_OK) {
                s_applied_rate_hz = want;
                s_mag_rate_hz = mag_hz_for_imu(want);
                s_mag_stride = mag_stride_for(want, s_mag_rate_hz);
                s_mag_div = s_mag_stride; /* next DRDY refreshes mag */
                s_meta.rate_hz = sensor_proto_rate_to_wire(want);
            } else {
                ESP_LOGW(TAG, "ODR update failed IMU=%s MAG=%s; keeping %u Hz",
                         esp_err_to_name(imu_err), esp_err_to_name(mag_err),
                         (unsigned)s_applied_rate_hz);
            }
            s_rate_dirty = false;
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
        uint32_t drdy_count = s_drdy_count;
        uint32_t slots = 1;
        if (last_drdy_count != 0) {
            uint32_t elapsed_samples = drdy_count - last_drdy_count;
            if (elapsed_samples == 0) {
                continue; /* A queued notification for an already-read DRDY. */
            }
            if (elapsed_samples > 1) {
                uint32_t missed = elapsed_samples - 1;
                uint32_t dropped_before = s_dropped;
                /* Advance the sample clock for each coalesced DRDY slot. */
                s_sample_index += missed;
                s_dropped += missed;
                slots = elapsed_samples;
                if (dropped_before == 0 ||
                    s_dropped / 64 != dropped_before / 64) {
                    ESP_LOGW(TAG, "coalesced DRDY samples=%" PRIu32
                                  " total dropped=%" PRIu32,
                             missed, s_dropped);
                }
            }
        }
        last_drdy_count = drdy_count;
        qmi8658_raw_t imu = {0};
        esp_err_t e1 = qmi8658_read_raw(&imu);

        /* IMU on every DRDY (~2.2 ms at 448 Hz). Mag I2C at mag ODR (~10 ms). */
        bool mag_fresh = false;
        s_mag_div++;
        if (s_mag_div >= s_mag_stride) {
            s_mag_div = 0;
            qmc5883p_raw_t mag = {0};
            if (qmc5883p_read_raw(&mag) == ESP_OK) {
                s_last_mag = mag;
                s_have_mag = true;
                mag_fresh = true;
            }
        }

        /*
         * Always consume one sample_index slot so failed reads remain visible
         * as gaps in the host timebase rather than silent stalls.
         */
        uint32_t index = s_sample_index++;
        if (e1 == ESP_OK && s_have_mag) {
            float dt = s_applied_rate_hz
                ? (float)slots / (float)s_applied_rate_hz
                : 0.002f;
            float ax = (float)imu.ax / (float)s_accel_lsb;
            float ay = (float)imu.ay / (float)s_accel_lsb;
            float az = (float)imu.az / (float)s_accel_lsb;
            float gx = (float)imu.gx / (float)s_gyro_lsb * DEG_TO_RAD;
            float gy = (float)imu.gy / (float)s_gyro_lsb * DEG_TO_RAD;
            float gz = (float)imu.gz / (float)s_gyro_lsb * DEG_TO_RAD;
            float mx = (float)s_last_mag.mx / (float)s_mag_lsb;
            float my = (float)s_last_mag.my / (float)s_mag_lsb;
            float mz = (float)s_last_mag.mz / (float)s_mag_lsb;
            mahony_update(&s_mahony, gx, gy, gz, ax, ay, az, mx, my, mz,
                          mag_fresh, dt);
            int16_t q15[4];
            mahony_get_q15(&s_mahony, q15);

            sensor_proto_sample_t sample = {
                .sample_index = index,
                .ax = imu.ax,
                .ay = imu.ay,
                .az = imu.az,
                .gx = imu.gx,
                .gy = imu.gy,
                .gz = imu.gz,
                .mx = s_last_mag.mx,
                .my = s_last_mag.my,
                .mz = s_last_mag.mz,
                .qw = q15[0],
                .qx = q15[1],
                .qy = q15[2],
                .qz = q15[3],
            };

            /* Length-1 latest queue: overwrite stale samples. */
            if (xQueueOverwrite(s_latest_q, &sample) != pdTRUE) {
                s_dropped++;
            }
            if (s_cb) {
                s_cb(&sample, s_cb_ctx);
            }
        } else {
            ESP_LOGW(TAG, "sample fail IMU=%s mag_ready=%d index=%" PRIu32,
                     esp_err_to_name(e1), (int)s_have_mag, index);
            s_dropped++;
        }
    }
}

esp_err_t sensor_stream_init(void)
{
    rowing_calib_t cal = {.sign = 1, .shaft_axis = 2};
    int8_t sign = 1;
    bool zeroed = false;
    uint8_t axis = 2;
    int16_t feather = 0;
    rowing_metrics_init();
    if (device_config_get_oar(&sign, &zeroed, &axis, &feather) == ESP_OK) {
        cal.sign = sign;
        cal.zeroed = zeroed;
        cal.shaft_axis = axis;
        cal.feather_ddeg = feather;
        rowing_metrics_restore(&cal);
    }
    ESP_RETURN_ON_ERROR(init_drdy_gpio(), TAG, "DRDY GPIO");
    ESP_RETURN_ON_ERROR(i2c_bus_init(), TAG, "i2c");
    ESP_RETURN_ON_ERROR(qmi8658_init(), TAG, "imu");
    ESP_RETURN_ON_ERROR(qmc5883p_init(), TAG, "mag");
    ESP_RETURN_ON_ERROR(qmi8658_set_odr_for_rate(SENSOR_PROTO_RATE_LIVE_HZ), TAG,
                        "odr");
    ESP_RETURN_ON_ERROR(qmc5883p_set_odr_for_rate(SENSOR_PROTO_RATE_LIVE_HZ),
                        TAG, "mag odr");

    qmi8658_scale_t as = {0};
    qmc5883p_scale_t ms = {0};
    ESP_RETURN_ON_ERROR(qmi8658_get_scale(&as), TAG, "a scale");
    ESP_RETURN_ON_ERROR(qmc5883p_get_scale(&ms), TAG, "m scale");
    s_accel_lsb = as.accel_lsb_per_g;
    s_gyro_lsb = as.gyro_lsb_per_dps;
    s_mag_lsb = ms.lsb_per_gauss;
    mahony_init(&s_mahony);

    s_requested_rate_hz = SENSOR_PROTO_RATE_LIVE_HZ;
    s_applied_rate_hz = SENSOR_PROTO_RATE_LIVE_HZ;
    s_mag_rate_hz = mag_hz_for_imu(SENSOR_PROTO_RATE_LIVE_HZ);
    s_mag_stride = mag_stride_for(s_applied_rate_hz, s_mag_rate_hz);
    s_mag_div = s_mag_stride;
    s_have_mag = false;
    s_rate_dirty = false;
    s_drdy_count = 0;
    s_sample_index = 0;
    s_meta = (sensor_proto_meta_t){
        .ver = SENSOR_PROTO_FORMAT_VER,
        .rate_hz = sensor_proto_rate_to_wire(SENSOR_PROTO_RATE_LIVE_HZ),
        .accel_lsb_per_g = as.accel_lsb_per_g,
        .gyro_lsb_per_dps = as.gyro_lsb_per_dps,
        .mag_lsb_per_gauss = ms.lsb_per_gauss,
        .flags = 0,
        .reserved = 0,
    };

    s_latest_q = xQueueCreate(1, sizeof(sensor_proto_sample_t));
    ESP_RETURN_ON_FALSE(s_latest_q, ESP_ERR_NO_MEM, TAG, "queue");

    BaseType_t ok =
        xTaskCreate(stream_task, "sensor_stream", 6144, NULL, 5, &s_task);
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

esp_err_t sensor_stream_set_rate_hz(uint16_t rate_hz)
{
    if (rate_hz == SENSOR_PROTO_RATE_CAPTURE_WIRE) {
        rate_hz = SENSOR_PROTO_RATE_CAPTURE_HZ;
    }
    if (!rate_allowed(rate_hz)) {
        return ESP_ERR_INVALID_ARG;
    }
    s_requested_rate_hz = rate_hz;
    s_rate_dirty = true;
    if (s_task) {
        xTaskNotify(s_task, TASK_NOTIFY_CONTROL, eSetBits);
    }
    ESP_LOGI(TAG, "rate request %u Hz", (unsigned)rate_hz);
    return ESP_OK;
}

uint16_t sensor_stream_get_rate_hz(void)
{
    return s_requested_rate_hz;
}

uint16_t sensor_stream_get_applied_rate_hz(void)
{
    return s_applied_rate_hz;
}

bool sensor_stream_is_rate_applied(void)
{
    return !s_rate_dirty && s_requested_rate_hz == s_applied_rate_hz;
}

uint8_t sensor_stream_get_mag_rate_hz(void)
{
    return s_mag_rate_hz;
}

void sensor_stream_set_sample_cb(sensor_stream_sample_cb_t cb, void *ctx)
{
    s_cb = cb;
    s_cb_ctx = ctx;
}

esp_err_t sensor_stream_get_latest(sensor_proto_sample_t *out)
{
    ESP_RETURN_ON_FALSE(out && s_latest_q, ESP_ERR_INVALID_STATE, TAG, "bad");
    if (xQueuePeek(s_latest_q, out, 0) != pdTRUE) {
        return ESP_ERR_NOT_FOUND;
    }
    return ESP_OK;
}

esp_err_t sensor_stream_get_latest_frame_v1(sensor_proto_frame_t *out)
{
    sensor_proto_sample_t sample = {0};
    esp_err_t err = sensor_stream_get_latest(&sample);
    if (err != ESP_OK) {
        return err;
    }
    sensor_proto_sample_to_frame_v1(out, &sample);
    return ESP_OK;
}

esp_err_t sensor_stream_get_latest_frame_fused(sensor_proto_frame_fused_t *out)
{
    sensor_proto_sample_t sample = {0};
    esp_err_t err = sensor_stream_get_latest(&sample);
    if (err != ESP_OK) {
        return err;
    }
    sensor_proto_sample_to_frame_fused(out, &sample);
    return ESP_OK;
}

uint32_t sensor_stream_dropped_count(void)
{
    return s_dropped;
}

uint32_t sensor_stream_sample_index(void)
{
    return s_sample_index;
}

esp_err_t sensor_stream_get_meta(sensor_proto_meta_t *out)
{
    ESP_RETURN_ON_FALSE(out, ESP_ERR_INVALID_ARG, TAG, "null");
    *out = s_meta;
    /* Meta continues to report applied rate for v1 clients. */
    out->rate_hz = sensor_proto_rate_to_wire(s_applied_rate_hz);
    return ESP_OK;
}
