#include "qmc5883p.h"

#include "board_pins.h"
#include "esp_check.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "i2c_bus.h"

static const char *TAG = "qmc5883p";

#define REG_CHIPID   0x00
#define CHIPID_VAL   0x80
#define REG_DATA_XL  0x01
#define REG_CTRL1    0x0A
#define REG_CTRL2    0x0B
#define REG_XYZ_SIGN 0x29

/* Rev-E normal-mode setup: OSR2=8, OSR1=8, ODR=200 Hz, MODE=normal.
 * ±8 G retains ample indoor hard-iron headroom at 3750 LSB/G. */
#define CTRL1_VAL    0xCD
#define CTRL2_CFG    0x08
#define XYZ_SIGN_VAL 0x06
#define SOFT_RST     0x80

static i2c_master_dev_handle_t s_dev;
static qmc5883p_scale_t s_scale = {
    .lsb_per_gauss = 3750,
    .range_code = 2,
    .odr_hz = 200,
};
static bool s_ready;

static esp_err_t read_id_stable(void)
{
    int match = 0;
    for (int i = 0; i < 5; i++) {
        uint8_t id = 0;
        esp_err_t err = i2c_bus_read_reg(s_dev, REG_CHIPID, &id);
        ESP_LOGI(TAG, "CHIPID[%d]=0x%02X (%s)", i, id, esp_err_to_name(err));
        if (err != ESP_OK) {
            match = 0;
            vTaskDelay(pdMS_TO_TICKS(20));
            continue;
        }
        match = (id == CHIPID_VAL) ? match + 1 : 0;
        if (match >= 3) {
            return ESP_OK;
        }
        vTaskDelay(pdMS_TO_TICKS(20));
    }
    return ESP_ERR_INVALID_RESPONSE;
}

esp_err_t qmc5883p_init(void)
{
    ESP_RETURN_ON_ERROR(i2c_bus_probe(BOARD_QMC5883P_ADDR), TAG, "probe");
    ESP_RETURN_ON_ERROR(i2c_bus_add_device(BOARD_QMC5883P_ADDR, &s_dev), TAG, "add");
    ESP_RETURN_ON_ERROR(read_id_stable(), TAG, "id");
    ESP_RETURN_ON_ERROR(i2c_bus_write_reg(s_dev, REG_CTRL2, SOFT_RST), TAG, "soft rst");
    vTaskDelay(pdMS_TO_TICKS(10));
    ESP_RETURN_ON_ERROR(i2c_bus_write_reg(s_dev, REG_XYZ_SIGN, XYZ_SIGN_VAL),
                        TAG, "XYZ sign");
    ESP_RETURN_ON_ERROR(i2c_bus_write_reg(s_dev, REG_CTRL2, CTRL2_CFG), TAG, "CTRL2");
    ESP_RETURN_ON_ERROR(i2c_bus_write_reg(s_dev, REG_CTRL1, CTRL1_VAL), TAG, "CTRL1");

    uint8_t c1 = 0, c2 = 0;
    ESP_RETURN_ON_ERROR(i2c_bus_read_reg(s_dev, REG_CTRL1, &c1), TAG, "rd CTRL1");
    ESP_RETURN_ON_ERROR(i2c_bus_read_reg(s_dev, REG_CTRL2, &c2), TAG, "rd CTRL2");
    ESP_LOGI(TAG, "configured CTRL1=0x%02X CTRL2=0x%02X scale=%u LSB/G odr=%u Hz",
             c1, c2, s_scale.lsb_per_gauss, s_scale.odr_hz);
    s_ready = true;
    return ESP_OK;
}

esp_err_t qmc5883p_read_raw(qmc5883p_raw_t *out)
{
    ESP_RETURN_ON_FALSE(s_ready && out, ESP_ERR_INVALID_STATE, TAG, "bad state");
    uint8_t buf[6];
    ESP_RETURN_ON_ERROR(i2c_bus_read_regs(s_dev, REG_DATA_XL, buf, sizeof(buf)), TAG, "read");
    out->mx = (int16_t)((buf[1] << 8) | buf[0]);
    out->my = (int16_t)((buf[3] << 8) | buf[2]);
    out->mz = (int16_t)((buf[5] << 8) | buf[4]);
    return ESP_OK;
}

esp_err_t qmc5883p_set_odr_for_rate(uint16_t imu_rate_hz)
{
    ESP_RETURN_ON_FALSE(s_ready, ESP_ERR_INVALID_STATE, TAG, "not ready");
    uint8_t odr_bits;
    uint8_t mag_hz;
    if (imu_rate_hz == 56) {
        odr_bits = 0x01;
        mag_hz = 50;
    } else if (imu_rate_hz == 112 || imu_rate_hz == 448) {
        /* CTRL1 ODR=10 → 100 Hz; 448 Hz IMU uses mag only for ~10 ms correction. */
        odr_bits = 0x02;
        mag_hz = 100;
    } else if (imu_rate_hz == 224) {
        odr_bits = 0x03;
        mag_hz = 200;
    } else {
        return ESP_ERR_INVALID_ARG;
    }
    uint8_t ctrl1 = (uint8_t)(0xC1 | (odr_bits << 2));
    ESP_RETURN_ON_ERROR(i2c_bus_write_reg(s_dev, REG_CTRL1, ctrl1), TAG,
                        "CTRL1 ODR");
    s_scale.odr_hz = mag_hz;
    ESP_LOGI(TAG, "ODR %u Hz for IMU profile %u Hz", mag_hz,
             (unsigned)imu_rate_hz);
    return ESP_OK;
}

esp_err_t qmc5883p_get_scale(qmc5883p_scale_t *out)
{
    ESP_RETURN_ON_FALSE(s_ready && out, ESP_ERR_INVALID_STATE, TAG, "bad state");
    *out = s_scale;
    return ESP_OK;
}
