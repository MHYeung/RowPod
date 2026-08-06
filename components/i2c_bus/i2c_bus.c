#include "i2c_bus.h"

#include "board_pins.h"
#include "driver/gpio.h"
#include "esp_check.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "i2c_bus";
static i2c_master_bus_handle_t s_bus;
static bool s_ready;

static void pins_as_idle_inputs(void)
{
    gpio_reset_pin(BOARD_I2C_SDA_GPIO);
    gpio_reset_pin(BOARD_I2C_SCL_GPIO);
    gpio_config_t cfg = {
        .pin_bit_mask = (1ULL << BOARD_I2C_SDA_GPIO) | (1ULL << BOARD_I2C_SCL_GPIO),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
    };
    gpio_config(&cfg);
}

static bool wait_bus_idle(int tries_ms)
{
    pins_as_idle_inputs();
    for (int t = 0; t < tries_ms; t += 20) {
        vTaskDelay(pdMS_TO_TICKS(20));
        if (gpio_get_level(BOARD_I2C_SDA_GPIO) && gpio_get_level(BOARD_I2C_SCL_GPIO)) {
            ESP_LOGI(TAG, "bus idle after %d ms", t + 20);
            return true;
        }
    }
    ESP_LOGE(TAG, "not idle SDA=%d SCL=%d",
             gpio_get_level(BOARD_I2C_SDA_GPIO),
             gpio_get_level(BOARD_I2C_SCL_GPIO));
    return false;
}

esp_err_t i2c_bus_init(void)
{
    if (s_ready) {
        return ESP_OK;
    }
    if (!wait_bus_idle(500)) {
        return ESP_ERR_INVALID_STATE;
    }

    i2c_master_bus_config_t bus_cfg = {
        .i2c_port = I2C_NUM_0,
        .sda_io_num = BOARD_I2C_SDA_GPIO,
        .scl_io_num = BOARD_I2C_SCL_GPIO,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    ESP_RETURN_ON_ERROR(i2c_new_master_bus(&bus_cfg, &s_bus), TAG, "new bus");
    s_ready = true;
    ESP_LOGI(TAG, "I2C0 ready SDA=%d SCL=%d @ %d Hz",
             BOARD_I2C_SDA_GPIO, BOARD_I2C_SCL_GPIO, BOARD_I2C_FREQ_HZ);
    return ESP_OK;
}

esp_err_t i2c_bus_deinit(void)
{
    if (!s_ready) {
        return ESP_OK;
    }
    esp_err_t err = i2c_del_master_bus(s_bus);
    s_bus = NULL;
    s_ready = false;
    pins_as_idle_inputs();
    return err;
}

esp_err_t i2c_bus_add_device(uint8_t addr_7bit, i2c_master_dev_handle_t *out_dev)
{
    ESP_RETURN_ON_FALSE(s_ready && out_dev, ESP_ERR_INVALID_STATE, TAG, "not ready");
    i2c_device_config_t cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = addr_7bit,
        .scl_speed_hz = BOARD_I2C_FREQ_HZ,
    };
    return i2c_master_bus_add_device(s_bus, &cfg, out_dev);
}

esp_err_t i2c_bus_write_reg(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t val)
{
    uint8_t buf[2] = {reg, val};
    return i2c_master_transmit(dev, buf, sizeof(buf), 300);
}

esp_err_t i2c_bus_read_reg(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t *out)
{
    return i2c_master_transmit_receive(dev, &reg, 1, out, 1, 300);
}

esp_err_t i2c_bus_read_regs(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t *out, size_t len)
{
    return i2c_master_transmit_receive(dev, &reg, 1, out, len, 300);
}

esp_err_t i2c_bus_probe(uint8_t addr_7bit)
{
    ESP_RETURN_ON_FALSE(s_ready, ESP_ERR_INVALID_STATE, TAG, "not ready");
    return i2c_master_probe(s_bus, addr_7bit, 300);
}
