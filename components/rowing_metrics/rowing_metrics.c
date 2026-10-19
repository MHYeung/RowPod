#include "rowing_metrics.h"

#include <math.h>
#include <string.h>

#ifndef ROWPOD_HOST
#include "esp_log.h"
static const char *TAG = "rowing_metrics";
#endif

#define REFRACTORY_MS     350.0f
#define OMEGA_PEAK_MIN    25.0f
#define GRAVITY_LP_TAU_S  0.35f
#define DC_ALPHA          0.85f
#define DC_TAU_S          0.45f
#define MIN_ARC_DEG       20.0f
#define FINISH_TIMEOUT_MS 2500.0f
#define FEATHER_ON_DEG    45.0f
#define FEATHER_TRACK_R   0.7f
#define FEATHER_TRACK_RANGE 0.45f
#define FEATHER_TRUST_DRIVES 2

typedef struct {
    bool valid;
    float t;
    float theta;
    float feather;
    float omega_peak;
} rm_ev_t;

static rowing_stroke_cb_t s_cb;

static float s_prev_t;
static bool s_have_prev;
static float s_theta;
static float s_omega;
static bool s_zeroed;
static float s_raw;
static float s_dc;
static float s_dc_target;
static float s_mid_ref;
static bool s_have_mid;
static float s_last_walk;
static uint16_t s_dc_strokes;
static float s_g[3];
static uint8_t s_shaft_axis;
static float s_feather_ref;
static float s_feather;
static bool s_expect_finish;
static float s_last_omega;
static float s_last_t;
static float s_last_theta;
static float s_last_feather;
static float s_t_omega;
static bool s_have_t_omega;
static float s_peak_abs;
static bool s_have_event;
static float s_last_event_t;
static rm_ev_t s_catch;
static rm_ev_t s_finish;
static bool s_feather_trusted;
static uint8_t s_drive_leak;
static uint8_t s_drive_done;
static bool s_awaiting_feather;
static int8_t s_sign;
static uint16_t s_stroke_idx;
static uint32_t s_catch_index;
static float s_prev_catch_t;
static bool s_have_prev_catch;

static int s_drive_n;
static float s_sum_th, s_sum_fe, s_sum_thth, s_sum_fefe, s_sum_thfe;
static float s_min_th, s_max_th, s_min_fe, s_max_fe;

static float wrap180(float deg)
{
    return deg - 360.0f * roundf(deg / 360.0f);
}

static float clampf(float v, float lo, float hi)
{
    if (v < lo) {
        return lo;
    }
    if (v > hi) {
        return hi;
    }
    return v;
}

static int pick_shaft(const float g[3])
{
    float mag0 = fabsf(g[0]);
    float mag1 = fabsf(g[1]);
    float mag2 = fabsf(g[2]);
    int axis = 0;
    if (mag1 < mag0) {
        axis = 1;
    }
    float best = (axis == 0) ? mag0 : mag1;
    if (mag2 < best) {
        axis = 2;
    }
    return axis;
}

static float feather_deg(const float g[3], int axis)
{
    int j = (axis + 1) % 3;
    int k = (axis + 2) % 3;
    return atan2f(g[j], g[k]) * (180.0f / 3.14159265f);
}

static float hypot3(float x, float y, float z)
{
    float h = sqrtf(x * x + y * y + z * z);
    return (h > 1e-9f) ? h : 1e-9f;
}

static void reset_drive(void)
{
    s_drive_n = 0;
    s_sum_th = s_sum_fe = s_sum_thth = s_sum_fefe = s_sum_thfe = 0.0f;
    s_min_th = 1e30f;
    s_max_th = -1e30f;
    s_min_fe = 1e30f;
    s_max_fe = -1e30f;
}

static void reset_all(void)
{
    memset(&s_catch, 0, sizeof(s_catch));
    memset(&s_finish, 0, sizeof(s_finish));
    s_have_prev = false;
    s_theta = 0.0f;
    s_omega = 0.0f;
    s_zeroed = false;
    s_raw = 0.0f;
    s_dc = 0.0f;
    s_dc_target = 0.0f;
    s_have_mid = false;
    s_last_walk = 0.0f;
    s_dc_strokes = 0;
    s_g[0] = 0.0f;
    s_g[1] = 0.0f;
    s_g[2] = 1.0f;
    s_shaft_axis = 2;
    s_feather_ref = 0.0f;
    s_feather = 0.0f;
    s_expect_finish = false;
    s_last_omega = 0.0f;
    s_have_t_omega = false;
    s_peak_abs = 0.0f;
    s_have_event = false;
    s_feather_trusted = true;
    s_drive_leak = 0;
    s_drive_done = 0;
    s_awaiting_feather = false;
    s_sign = 1;
    s_stroke_idx = 0;
    s_have_prev_catch = false;
    reset_drive();
}

void rowing_metrics_init(void)
{
    reset_all();
}

void rowing_metrics_set_stroke_cb(rowing_stroke_cb_t cb)
{
    s_cb = cb;
}

void rowing_metrics_set_sign(int sign)
{
    s_sign = (sign < 0) ? -1 : 1;
}

void rowing_metrics_zero(void)
{
    s_dc = s_raw;
    s_dc_target = s_raw;
    s_have_mid = false;
    s_last_walk = 0.0f;
    s_dc_strokes = 0;
    s_shaft_axis = (uint8_t)pick_shaft(s_g);
    s_feather_ref = feather_deg(s_g, s_shaft_axis);
    s_feather = 0.0f;
    s_expect_finish = false;
    s_zeroed = true;
    s_theta = 0.0f;
    s_feather_trusted = true;
    s_drive_leak = 0;
    s_drive_done = 0;
    s_awaiting_feather = false;
    reset_drive();
}

void rowing_metrics_clear(void)
{
    memset(&s_catch, 0, sizeof(s_catch));
    memset(&s_finish, 0, sizeof(s_finish));
    s_expect_finish = false;
    s_awaiting_feather = false;
    s_peak_abs = 0.0f;
    s_have_event = false;
    s_have_prev_catch = false;
}

void rowing_metrics_get_calib(rowing_calib_t *out)
{
    if (!out) {
        return;
    }
    out->sign = s_sign;
    out->zeroed = s_zeroed;
    out->shaft_axis = s_shaft_axis;
    float ddeg = s_feather_ref * 10.0f;
    if (ddeg > 32767.0f) {
        ddeg = 32767.0f;
    }
    if (ddeg < -32768.0f) {
        ddeg = -32768.0f;
    }
    out->feather_ddeg = (int16_t)lroundf(ddeg);
}

void rowing_metrics_restore(const rowing_calib_t *in)
{
    if (!in) {
        return;
    }
    s_sign = (in->sign < 0) ? -1 : 1;
    if (!in->zeroed) {
        return;
    }
    s_shaft_axis = (in->shaft_axis > 2) ? 2 : in->shaft_axis;
    s_feather_ref = (float)in->feather_ddeg / 10.0f;
    s_zeroed = true;
    s_dc = 0.0f;
    s_dc_target = 0.0f;
    s_raw = 0.0f;
    s_theta = 0.0f;
}

static void accum_drive(float theta, float feather)
{
    s_drive_n++;
    s_sum_th += theta;
    s_sum_fe += feather;
    s_sum_thth += theta * theta;
    s_sum_fefe += feather * feather;
    s_sum_thfe += theta * feather;
    if (theta < s_min_th) {
        s_min_th = theta;
    }
    if (theta > s_max_th) {
        s_max_th = theta;
    }
    if (feather < s_min_fe) {
        s_min_fe = feather;
    }
    if (feather > s_max_fe) {
        s_max_fe = feather;
    }
}

static bool score_leak(void)
{
    float r = 0.0f;
    if (s_drive_n >= 8) {
        float n = (float)s_drive_n;
        float num = n * s_sum_thfe - s_sum_th * s_sum_fe;
        float den_x = n * s_sum_thth - s_sum_th * s_sum_th;
        float den_y = n * s_sum_fefe - s_sum_fe * s_sum_fe;
        float den = sqrtf(den_x * den_y);
        if (den > 1e-9f) {
            r = num / den;
        }
    }
    bool leaked = false;
    if (s_drive_n > 0) {
        float th_range = s_max_th - s_min_th;
        float fe_range = s_max_fe - s_min_fe;
        leaked = (fabsf(r) > FEATHER_TRACK_R) ||
                 (th_range > 15.0f && fe_range > FEATHER_TRACK_RANGE * th_range);
    }
    s_drive_done++;
    if (leaked) {
        s_drive_leak++;
    }
    if (s_drive_done >= FEATHER_TRUST_DRIVES) {
        s_feather_trusted = s_drive_leak < FEATHER_TRUST_DRIVES;
    }
    reset_drive();
    return leaked;
}

static void lock_dc(const rm_ev_t *finish)
{
    if (!s_catch.valid) {
        return;
    }
    float mid = 0.5f * (s_catch.theta + finish->theta);
    if (!s_have_mid) {
        s_mid_ref = mid;
        s_have_mid = true;
        s_last_walk = 0.0f;
        return;
    }
    float err = mid - s_mid_ref;
    s_last_walk = err;
    s_dc_target += DC_ALPHA * err;
    s_dc_strokes++;
}

static float interp_cross(float t0, float y0, float t1, float y1)
{
    float denom = y1 - y0;
    float frac = (fabsf(denom) > 1e-12f) ? (-y0 / denom) : 0.0f;
    return t0 + clampf(frac, 0.0f, 1.0f) * (t1 - t0);
}

static bool maybe_event(float t, float t_omega, float theta, float omega, rm_ev_t *out)
{
    if (fabsf(omega) > s_peak_abs) {
        s_peak_abs = fabsf(omega);
    }
    if (!s_have_t_omega) {
        return false;
    }
    bool crossed_up = (s_last_omega < 0.0f && omega >= 0.0f);
    bool crossed_down = (s_last_omega > 0.0f && omega <= 0.0f);
    if (!crossed_up && !crossed_down) {
        return false;
    }
    if (s_have_event && (t - s_last_event_t) < REFRACTORY_MS) {
        return false;
    }
    if (s_peak_abs < OMEGA_PEAK_MIN) {
        return false;
    }

    bool is_catch = crossed_up;
    if (s_expect_finish && is_catch && s_have_event &&
        (t - s_last_event_t) > FINISH_TIMEOUT_MS) {
        s_expect_finish = false;
    }
    if (is_catch == s_expect_finish) {
        return false;
    }

    float t_cross = interp_cross(s_t_omega, s_last_omega, t_omega, omega);
    float dt_sample = t - s_last_t;
    float frac = (fabsf(dt_sample) > 1e-9f) ? ((t_cross - s_last_t) / dt_sample) : 0.0f;
    float u = clampf(frac, 0.0f, 1.0f);
    float theta_cross = s_last_theta + u * (theta - s_last_theta);
    float feather_cross = s_last_feather + u * (s_feather - s_last_feather);
    if (!is_catch && s_catch.valid &&
        fabsf(theta_cross - s_catch.theta) < MIN_ARC_DEG) {
        return false;
    }

    rm_ev_t ev = {
        .valid = true,
        .t = t_cross,
        .theta = theta_cross,
        .feather = feather_cross,
        .omega_peak = s_peak_abs,
    };
    if (is_catch) {
        if (s_catch.valid) {
            s_prev_catch_t = s_catch.t;
            s_have_prev_catch = true;
        }
        s_catch = ev;
        s_awaiting_feather = false;
        reset_drive();
    } else {
        s_finish = ev;
        lock_dc(&ev);
        bool leaked = score_leak();
        s_awaiting_feather = s_feather_trusted && !leaked;
    }
    s_expect_finish = is_catch;
    s_peak_abs = 0.0f;
    s_last_event_t = t_cross;
    s_have_event = true;
    *out = ev;
    return true;
}

bool rowing_metrics_push(uint32_t sample_index, float ax_g, float ay_g, float az_g,
                         float gx_dps, float gy_dps, float gz_dps, uint32_t t_ms,
                         rowing_stroke_t *out)
{
    float t = (float)t_ms;
    float dt = s_have_prev ? (t - s_prev_t) / 1000.0f : 0.0f;
    bool dt_ok = (dt > 1e-4f && dt < 0.15f);
    if (dt_ok) {
        float k = 1.0f - expf(-dt / GRAVITY_LP_TAU_S);
        s_g[0] += k * (ax_g - s_g[0]);
        s_g[1] += k * (ay_g - s_g[1]);
        s_g[2] += k * (az_g - s_g[2]);
    }

    float gn = hypot3(s_g[0], s_g[1], s_g[2]);
    float omega = (float)s_sign *
                  (gx_dps * s_g[0] + gy_dps * s_g[1] + gz_dps * s_g[2]) / gn;
    if (dt_ok) {
        s_raw += omega * dt;
    }
    if (dt_ok && omega > 0.0f) {
        float a = 1.0f - expf(-dt / DC_TAU_S);
        s_dc += a * (s_dc_target - s_dc);
    }
    s_theta = s_raw - s_dc;
    s_feather = wrap180(feather_deg(s_g, s_shaft_axis) - s_feather_ref);
    s_omega = omega;
    if (dt_ok && s_expect_finish) {
        accum_drive(s_theta, s_feather);
    }

    float t_omega = s_have_prev ? (s_prev_t + t) * 0.5f : t;
    rm_ev_t ev;
    bool got = maybe_event(t, t_omega, s_theta, omega, &ev);
    /* After a catch, expect_finish is true. After a finish it is false. */
    bool was_catch = got && s_expect_finish;
    bool was_finish = got && !s_expect_finish;
    if (was_catch) {
        s_catch_index = sample_index;
    }

    s_last_omega = omega;
    s_last_t = t;
    s_t_omega = t_omega;
    s_have_t_omega = true;
    s_last_theta = s_theta;
    s_last_feather = s_feather;
    s_prev_t = t;
    s_have_prev = true;

    if (!was_finish || !s_finish.valid) {
        return false;
    }

    if (s_stroke_idx < 65535) {
        s_stroke_idx++;
    }
    rowing_stroke_t stroke = {
        .stroke_idx = s_stroke_idx,
        .sample_index = s_catch_index,
        .catch_deg = s_catch.theta,
        .finish_deg = s_finish.theta,
        .arc_deg = s_finish.theta - s_catch.theta,
        .spm = 0.0f,
        .drive_ms = 0,
        .zeroed = s_zeroed,
        .feather_trusted = s_feather_trusted,
    };
    float drive = s_finish.t - s_catch.t;
    if (drive > 0.0f && drive < 10000.0f) {
        stroke.drive_ms = (uint16_t)lroundf(drive);
    }
    if (s_have_prev_catch) {
        float period = s_catch.t - s_prev_catch_t;
        if (period > 300.0f && period < 10000.0f) {
            stroke.spm = 60000.0f / period;
        }
    }
    if (out) {
        *out = stroke;
    }
    if (s_cb) {
        s_cb(&stroke);
    }
#ifndef ROWPOD_HOST
    ESP_LOGI(TAG, "stroke %u catch=%.1f finish=%.1f arc=%.1f spm=%.1f",
             (unsigned)stroke.stroke_idx, (double)stroke.catch_deg,
             (double)stroke.finish_deg, (double)stroke.arc_deg, (double)stroke.spm);
#endif
    return true;
}
