idf_component_register(
    SRCS "power.c"
    INCLUDE_DIRS "include"
    REQUIRES board ble_tracker esp_driver_gpio esp_hw_support freertos ui
)
