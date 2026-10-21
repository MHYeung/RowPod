idf_component_register(
    SRCS "sensor_stream.c"
    INCLUDE_DIRS "include"
    REQUIRES board i2c_bus qmi8658 mahony sensor_protocol esp_driver_gpio
             freertos rowing_metrics device_config
)
