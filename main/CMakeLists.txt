idf_component_register(
    SRCS "main.c"
    INCLUDE_DIRS "."
    REQUIRES
        nvs_flash
        esp_event
        board
        ui
        battery
        power
        sensor_stream
        ble_tracker
)
