idf_component_register(
    SRCS "sensor_stream.c"
    INCLUDE_DIRS "include"
    REQUIRES i2c_bus qmi8658 qmc5883p sensor_protocol freertos
)
