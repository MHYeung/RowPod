#pragma once

#include "driver/i2c_master.h"
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Create the shared I2C master bus (GPIO4/5 @ BOARD_I2C_FREQ_HZ).
 *
 * Waits for SDA/SCL idle-high before creating the driver. Safe to call once.
 */
esp_err_t i2c_bus_init(void);

/** @brief Tear down the bus and release GPIOs to input+pull-up. */
esp_err_t i2c_bus_deinit(void);

/**
 * @brief Add a 7-bit device on the shared bus.
 * @param addr_7bit Device address (e.g. 0x6A).
 * @param[out] out_dev Device handle for subsequent transfers.
 */
esp_err_t i2c_bus_add_device(uint8_t addr_7bit, i2c_master_dev_handle_t *out_dev);

esp_err_t i2c_bus_write_reg(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t val);
esp_err_t i2c_bus_read_reg(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t *out);
esp_err_t i2c_bus_read_regs(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t *out, size_t len);
esp_err_t i2c_bus_probe(uint8_t addr_7bit);

#ifdef __cplusplus
}
#endif
