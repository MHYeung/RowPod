#include "battery.h"

#include <stddef.h>

#include "board_pins.h"
#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_check.h"
#include "esp_log.h"

static const char *TAG = "battery";

/* ESP32-C3 GPIO2 = ADC1 channel 2 */
#define BATTERY_ADC_UNIT    ADC_UNIT_1
#define BATTERY_ADC_CHAN    ADC_CHANNEL_2
#define BATTERY_ADC_ATTEN   ADC_ATTEN_DB_12

#ifndef BOARD_BATTERY_DIVIDER_RATIO
/** Pack voltage = ADC voltage × ratio (1:1 divider → 2). */
#define BOARD_BATTERY_DIVIDER_RATIO  2
#endif

#define LIPO_MV_EMPTY  3300
#define LIPO_MV_FULL   4200
#define BATTERY_ADC_SAMPLES  8

static adc_oneshot_unit_handle_t s_adc;
static adc_cali_handle_t s_cali;
static bool s_cali_ok;
static bool s_ready;

/**
 * Piecewise OCV-ish map. Linear 3.3–4.2 made mid-pack look "low":
 * 3.87 V ≈ 63% linear, but a rested LiPo near 3.9 V is often ~70–75%.
 * 3.7 V is the *nominal* cell voltage, not 50% / empty.
 */
static uint8_t mv_to_percent(uint16_t mv)
{
    static const struct {
        uint16_t mv;
        uint8_t pct;
    } table[] = {
        { 3300, 0 },
        { 3500, 10 },
        { 3600, 25 },
        { 3700, 45 },
        { 3800, 60 },
        { 3900, 75 },
        { 4000, 88 },
        { 4100, 96 },
        { 4200, 100 },
    };

    if (mv <= table[0].mv) {
        return table[0].pct;
    }
    const size_t n = sizeof(table) / sizeof(table[0]);
    if (mv >= table[n - 1].mv) {
        return table[n - 1].pct;
    }
    for (size_t i = 1; i < n; i++) {
        if (mv <= table[i].mv) {
            uint16_t mv0 = table[i - 1].mv;
            uint16_t mv1 = table[i].mv;
            uint8_t p0 = table[i - 1].pct;
            uint8_t p1 = table[i].pct;
            return (uint8_t)(p0 +
                             ((uint32_t)(mv - mv0) * (p1 - p0)) / (mv1 - mv0));
        }
    }
    return 0;
}

static bool init_calibration(adc_unit_t unit, adc_atten_t atten,
                             adc_cali_handle_t *out)
{
    adc_cali_handle_t handle = NULL;
    esp_err_t ret = ESP_FAIL;

#if ADC_CALI_SCHEME_CURVE_FITTING_SUPPORTED
    adc_cali_curve_fitting_config_t cfg = {
        .unit_id = unit,
        .atten = atten,
        .bitwidth = ADC_BITWIDTH_DEFAULT,
    };
    ret = adc_cali_create_scheme_curve_fitting(&cfg, &handle);
#endif
#if ADC_CALI_SCHEME_LINE_FITTING_SUPPORTED
    if (ret != ESP_OK) {
        adc_cali_line_fitting_config_t cfg = {
            .unit_id = unit,
            .atten = atten,
            .bitwidth = ADC_BITWIDTH_DEFAULT,
        };
        ret = adc_cali_create_scheme_line_fitting(&cfg, &handle);
    }
#endif
    if (ret == ESP_OK) {
        *out = handle;
        return true;
    }
    ESP_LOGW(TAG, "ADC calibration unavailable (%s)", esp_err_to_name(ret));
    return false;
}

esp_err_t battery_init(void)
{
    adc_oneshot_unit_init_cfg_t init_cfg = {
        .unit_id = BATTERY_ADC_UNIT,
    };
    ESP_RETURN_ON_ERROR(adc_oneshot_new_unit(&init_cfg, &s_adc), TAG,
                        "adc unit");

    adc_oneshot_chan_cfg_t chan_cfg = {
        .bitwidth = ADC_BITWIDTH_DEFAULT,
        .atten = BATTERY_ADC_ATTEN,
    };
    ESP_RETURN_ON_ERROR(
        adc_oneshot_config_channel(s_adc, BATTERY_ADC_CHAN, &chan_cfg), TAG,
        "adc channel GPIO%d", BOARD_BATTERY_ADC_GPIO);

    s_cali_ok = init_calibration(BATTERY_ADC_UNIT, BATTERY_ADC_ATTEN, &s_cali);
    s_ready = true;
    ESP_LOGI(TAG, "ADC ready on GPIO%d (divider ×%d)", BOARD_BATTERY_ADC_GPIO,
             BOARD_BATTERY_DIVIDER_RATIO);
    return ESP_OK;
}

esp_err_t battery_read(uint16_t *millivolts, uint8_t *percent)
{
    if (!s_ready) {
        return ESP_ERR_INVALID_STATE;
    }
    if (millivolts == NULL && percent == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    int raw_sum = 0;
    for (int i = 0; i < BATTERY_ADC_SAMPLES; i++) {
        int raw = 0;
        ESP_RETURN_ON_ERROR(adc_oneshot_read(s_adc, BATTERY_ADC_CHAN, &raw),
                            TAG, "adc read");
        raw_sum += raw;
    }
    int raw = raw_sum / BATTERY_ADC_SAMPLES;

    int adc_mv = 0;
    if (s_cali_ok) {
        ESP_RETURN_ON_ERROR(adc_cali_raw_to_voltage(s_cali, raw, &adc_mv), TAG,
                            "cali");
    } else {
        /* Rough fallback: 12-bit full-scale ≈ 3300 mV at 12 dB atten. */
        adc_mv = (raw * 3300) / 4095;
    }

    uint32_t pack_mv =
        (uint32_t)adc_mv * (uint32_t)BOARD_BATTERY_DIVIDER_RATIO;
    if (pack_mv > 65535u) {
        pack_mv = 65535u;
    }

    if (millivolts) {
        *millivolts = (uint16_t)pack_mv;
    }
    if (percent) {
        *percent = mv_to_percent((uint16_t)pack_mv);
    }
    return ESP_OK;
}

esp_err_t battery_read_mv(uint16_t *millivolts)
{
    return battery_read(millivolts, NULL);
}

esp_err_t battery_read_percent(uint8_t *percent)
{
    return battery_read(NULL, percent);
}
