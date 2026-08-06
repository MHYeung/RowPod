idf_component_register(
    SRCS "ble_tracker.c"
    INCLUDE_DIRS "include"
    REQUIRES bt nvs_flash board ui sensor_protocol sensor_stream
)
