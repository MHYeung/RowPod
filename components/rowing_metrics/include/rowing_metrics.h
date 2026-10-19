#pragma once

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief On-pod port of the browser OarAngleTracker.
 *
 * Feed engineering units (g and deg/s) from the sensor task at the live rate.
 * A true return means a drive just finished and @p out is a completed stroke.
 * The ESP32-C3 has no FPU, so this stays on the sensor task and never runs
 * from a BLE callback.
 */
typedef struct {
    uint16_t stroke_idx;
    uint32_t sample_index;
    float catch_deg;
    float finish_deg;
    float arc_deg;
    float spm;
    uint16_t drive_ms;
    bool zeroed;
    bool feather_trusted;
} rowing_stroke_t;

typedef struct {
    int8_t sign;
    bool zeroed;
    uint8_t shaft_axis;
    int16_t feather_ddeg;
} rowing_calib_t;

typedef void (*rowing_stroke_cb_t)(const rowing_stroke_t *stroke);

void rowing_metrics_init(void);
void rowing_metrics_set_stroke_cb(rowing_stroke_cb_t cb);

void rowing_metrics_set_sign(int sign);
void rowing_metrics_zero(void);
void rowing_metrics_clear(void);
void rowing_metrics_get_calib(rowing_calib_t *out);
void rowing_metrics_restore(const rowing_calib_t *in);

bool rowing_metrics_push(uint32_t sample_index, float ax_g, float ay_g, float az_g,
                         float gx_dps, float gy_dps, float gz_dps, uint32_t t_ms,
                         rowing_stroke_t *out);

#ifdef __cplusplus
}
#endif
