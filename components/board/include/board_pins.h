#pragma once

/**
 * @file board_pins.h
 * @brief GPIO and device address map for RowPod v2 (ESP32-C3).
 *
 * Pin numbers match SCH_ROWPOD_SCH (2026-09-22), board RowPod2.
 * The user button is GPIO0 (XTAL_32K_P). No 32 kHz crystal is fitted.
 * GPIO0 is an RTC pad, so it can wake deep sleep. GPIO10 cannot.
 */

#define BOARD_LED_GPIO              7
#define BOARD_BUTTON_GPIO           0
#define BOARD_BATTERY_ADC_GPIO      2
/** Pack voltage = ADC pin voltage × ratio. 470 kΩ / 470 kΩ divider → 2. */
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

/** Both the IMU and the external 4.7 kΩ pull-ups support I2C Fast-mode. */
#define BOARD_I2C_FREQ_HZ           400000
#define BOARD_DEVICE_NAME           "C3-Tracker"
