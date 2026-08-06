#pragma once

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/** @brief Scaffold — deep-sleep / wake policy deferred. */
esp_err_t power_init(void);

#ifdef __cplusplus
}
#endif
