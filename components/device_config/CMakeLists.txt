idf_component_register(
    SRCS "device_config.c"
    INCLUDE_DIRS "include"
    REQUIRES board nvs_flash esp_system esp_hw_support
)
