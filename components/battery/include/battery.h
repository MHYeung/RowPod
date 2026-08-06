#pragma once

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/** @brief Scaffold — ADC oneshot bring-up lands in a later stage. */
esp_err_t battery_init(void);

#ifdef __cplusplus
}
#endif
