#include "qmi8658.h"

#include "board_pins.h"
#include "esp_check.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "i2c_bus.h"

static const char *TAG = "qmi8658";

#define REG_WHOAMI   0x00
#define WHOAMI_VAL   0x05
#define REG_CTRL1    0x02
#define REG_CTRL2    0x03
#define REG_CTRL3    0x04
#define REG_CTRL7    0x08
#define REG_RESET    0x60
#define RESET_VAL    0xB0
#define REG_AX_L     0x35

/* CTRL1: ADDR_AI (bit6) + INT2_EN (bit4); BE=0 → little-endian → 0x50
 * CTRL2: aFS=010 (±8g) | aODR=0110 → 0x26
 * CTRL3: gFS=110 (±1024 dps) | gODR=0110 → 0x66
 * In 6-DoF mode, ODR code 0x6 is approximately 112 Hz.
 * Scales: ±8 g → 4096 LSB/g; ±1024 dps → 32 LSB/dps. */
#define CTRL1_VAL    0x50
#define CTRL2_VAL    0x26
#define CTRL3_VAL    0x66
/* CTRL7: DRDY_DIS=0 routes data-ready pulses to INT2; gEN=1, aEN=1. */
#define CTRL7_VAL    0x03
#define GYRO_FS_CODE 6

static i2c_master_dev_handle_t s_dev;
static qmi8658_scale_t s_scale = {
    .accel_lsb_per_g = 4096,
    .gyro_lsb_per_dps = 32,
    .accel_fs_code = 2,
    .gyro_fs_code = GYRO_FS_CODE,
};
static bool s_ready;

static esp_err_t read_id_stable(void)
{
    int match = 0;
    for (int i = 0; i < 5; i++) {
        uint8_t id = 0;
        esp_err_t err = i2c_bus_read_reg(s_dev, REG_WHOAMI, &id);
        ESP_LOGI(TAG, "WHO_AM_I[%d]=0x%02X (%s)", i, id, esp_err_to_name(err));
        if (err != ESP_OK) {
            match = 0;
            vTaskDelay(pdMS_TO_TICKS(20));
            continue;
        }
        match = (id == WHOAMI_VAL) ? match + 1 : 0;
        if (match >= 3) {
            return ESP_OK;
        }
        vTaskDelay(pdMS_TO_TICKS(20));
    }
    return ESP_ERR_INVALID_RESPONSE;
}

esp_err_t qmi8658_init(void)
{
    ESP_RETURN_ON_ERROR(i2c_bus_probe(BOARD_QMI8658_ADDR), TAG, "probe");
    ESP_RETURN_ON_ERROR(i2c_bus_add_device(BOARD_QMI8658_ADDR, &s_dev), TAG, "add");
    ESP_RETURN_ON_ERROR(read_id_stable(), TAG, "id");
    ESP_RETURN_ON_ERROR(i2c_bus_write_reg(s_dev, REG_RESET, RESET_VAL), TAG, "rst");
    vTaskDelay(pdMS_TO_TICKS(50));
    /* Without ADDR_AI, a 12-byte read from 0x35 does not walk AX..GZ → garbage "noise". */
    ESP_RETURN_ON_ERROR(i2c_bus_write_reg(s_dev, REG_CTRL1, CTRL1_VAL), TAG, "CTRL1");
    ESP_RETURN_ON_ERROR(i2c_bus_write_reg(s_dev, REG_CTRL2, CTRL2_VAL), TAG, "CTRL2");
    ESP_RETURN_ON_ERROR(i2c_bus_write_reg(s_dev, REG_CTRL3, CTRL3_VAL), TAG, "CTRL3");
    ESP_RETURN_ON_ERROR(i2c_bus_write_reg(s_dev, REG_CTRL7, CTRL7_VAL), TAG, "CTRL7");

    uint8_t c1 = 0, c2 = 0, c3 = 0;
    ESP_RETURN_ON_ERROR(i2c_bus_read_reg(s_dev, REG_CTRL1, &c1), TAG, "rd CTRL1");
    ESP_RETURN_ON_ERROR(i2c_bus_read_reg(s_dev, REG_CTRL2, &c2), TAG, "rd CTRL2");
    ESP_RETURN_ON_ERROR(i2c_bus_read_reg(s_dev, REG_CTRL3, &c3), TAG, "rd CTRL3");
    ESP_LOGI(TAG, "CTRL1=0x%02X CTRL2=0x%02X CTRL3=0x%02X scale a=%u LSB/g g=%u LSB/dps",
             c1, c2, c3, s_scale.accel_lsb_per_g, s_scale.gyro_lsb_per_dps);
    s_ready = true;
    return ESP_OK;
}

esp_err_t qmi8658_read_raw(qmi8658_raw_t *out)
{
    ESP_RETURN_ON_FALSE(s_ready && out, ESP_ERR_INVALID_STATE, TAG, "bad state");
    uint8_t buf[12];
    ESP_RETURN_ON_ERROR(i2c_bus_read_regs(s_dev, REG_AX_L, buf, sizeof(buf)), TAG, "read");
    out->ax = (int16_t)((buf[1] << 8) | buf[0]);
    out->ay = (int16_t)((buf[3] << 8) | buf[2]);
    out->az = (int16_t)((buf[5] << 8) | buf[4]);
    out->gx = (int16_t)((buf[7] << 8) | buf[6]);
    out->gy = (int16_t)((buf[9] << 8) | buf[8]);
    out->gz = (int16_t)((buf[11] << 8) | buf[10]);
    return ESP_OK;
}

esp_err_t qmi8658_set_odr_for_rate(uint8_t rate_hz)
{
    ESP_RETURN_ON_FALSE(s_ready, ESP_ERR_INVALID_STATE, TAG, "not ready");
    /* CTRL2/3 low nibble = ODR. Keep ±8 g and ±1024 dps full scales. */
    uint8_t odr;
    if (rate_hz <= 50) {
        odr = 0x07; /* ~56 Hz */
    } else if (rate_hz <= 100) {
        odr = 0x06; /* ~112 Hz */
    } else {
        odr = 0x05; /* ~224 Hz — host may pull at 150 Hz */
    }
    uint8_t ctrl2 = (uint8_t)((0x02 << 4) | odr);
    uint8_t ctrl3 = (uint8_t)((GYRO_FS_CODE << 4) | odr);
    ESP_RETURN_ON_ERROR(i2c_bus_write_reg(s_dev, REG_CTRL2, ctrl2), TAG, "CTRL2");
    ESP_RETURN_ON_ERROR(i2c_bus_write_reg(s_dev, REG_CTRL3, ctrl3), TAG, "CTRL3");
    ESP_LOGI(TAG, "ODR band for %u Hz → CTRL2=0x%02X CTRL3=0x%02X", rate_hz, ctrl2,
             ctrl3);
    return ESP_OK;
}

esp_err_t qmi8658_get_scale(qmi8658_scale_t *out)
{
    ESP_RETURN_ON_FALSE(s_ready && out, ESP_ERR_INVALID_STATE, TAG, "bad state");
    *out = s_scale;
    return ESP_OK;
}
