#pragma once

/**
 * @file board_pins.h
 * @brief Verified GPIO and device address map for ESP32-C3 Motion Tracker.
 *
 * Pin numbers match the SCH_ESP32C3_Motion_Tracker schematic (2026-07-26).
 */

#define BOARD_LED_GREEN_GPIO        6
#define BOARD_LED_BLUE_GPIO         7
#define BOARD_BUTTON_GPIO           10
#define BOARD_BATTERY_ADC_GPIO      2
/** Pack voltage = ADC pin voltage × ratio. 1:1 divider → 2. */
#define BOARD_BATTERY_DIVIDER_RATIO 2
/** Button gesture timing. */
#define BOARD_BUTTON_LONG_PRESS_MS      2000
#define BOARD_BUTTON_DEBOUNCE_MS           30

#define BOARD_I2C_SDA_GPIO          4
#define BOARD_I2C_SCL_GPIO          5
#define BOARD_IMU_INT1_GPIO         8
#define BOARD_IMU_INT2_GPIO         3

/** QMI8658A: SA0 tied to 3V3 → 7-bit address 0x6A */
#define BOARD_QMI8658_ADDR          0x6A
/** QMC5883P default 7-bit address */
#define BOARD_QMC5883P_ADDR         0x2C

/** Both sensors support I2C Fast-mode; required for 448 Hz 6-DoF capture. */
#define BOARD_I2C_FREQ_HZ           400000
#define BOARD_DEVICE_NAME           "C3-Tracker"
