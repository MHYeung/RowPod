idf_component_register(
    SRCS "power.c"
    INCLUDE_DIRS "include"
    REQUIRES board ble_tracker esp_driver_gpio esp_driver_usb_serial_jtag
             esp_hw_support esp_timer freertos sensor_stream ui
)
