idf_component_register(
    SRCS "ui.c"
    INCLUDE_DIRS "include"
    REQUIRES board esp_driver_gpio freertos
)
