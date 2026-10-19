idf_component_register(
    SRCS "ble_tracker.c"
    INCLUDE_DIRS "include"
    REQUIRES bt board ui sensor_protocol sensor_stream device_config battery esp_timer
             rowing_metrics
)
