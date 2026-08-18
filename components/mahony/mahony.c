#include "mahony.h"

#include <math.h>

/* Proportional gain. Ki left at 0: integral wind-up on a moving athlete
 * is worse than a little gyro bias on a 1–8 s capture. */
#define MAHONY_KP 1.0f

void mahony_init(mahony_state_t *state)
{
    if (!state) {
        return;
    }
    state->q0 = 1.0f;
    state->q1 = 0.0f;
    state->q2 = 0.0f;
    state->q3 = 0.0f;
    state->integral_x = 0.0f;
    state->integral_y = 0.0f;
    state->integral_z = 0.0f;
}

void mahony_update(mahony_state_t *state,
                   float gx, float gy, float gz,
                   float ax, float ay, float az,
                   float mx, float my, float mz,
                   bool mag_valid, float dt)
{
    if (!state || dt <= 0.0f) {
        return;
    }
    if (dt > 0.05f) {
        dt = 0.05f; /* clamp coalesced gaps; do not freeze the filter */
    }

    float q0 = state->q0;
    float q1 = state->q1;
    float q2 = state->q2;
    float q3 = state->q3;

    float anorm = sqrtf(ax * ax + ay * ay + az * az);
    if (anorm > 0.1f) {
        ax /= anorm;
        ay /= anorm;
        az /= anorm;

        /* Estimated gravity in body frame. */
        float vx = 2.0f * (q1 * q3 - q0 * q2);
        float vy = 2.0f * (q0 * q1 + q2 * q3);
        float vz = q0 * q0 - q1 * q1 - q2 * q2 + q3 * q3;

        float ex = ay * vz - az * vy;
        float ey = az * vx - ax * vz;
        float ez = ax * vy - ay * vx;

        if (mag_valid) {
            float mnorm = sqrtf(mx * mx + my * my + mz * mz);
            if (mnorm > 1e-6f) {
                mx /= mnorm;
                my /= mnorm;
                mz /= mnorm;
                float q0q0 = q0 * q0;
                float q0q1 = q0 * q1;
                float q0q2 = q0 * q2;
                float q0q3 = q0 * q3;
                float q1q1 = q1 * q1;
                float q1q2 = q1 * q2;
                float q1q3 = q1 * q3;
                float q2q2 = q2 * q2;
                float q2q3 = q2 * q3;
                float q3q3 = q3 * q3;
                float hx = 2.0f * (mx * (0.5f - q2q2 - q3q3) +
                                   my * (q1q2 - q0q3) + mz * (q1q3 + q0q2));
                float hy = 2.0f * (mx * (q1q2 + q0q3) +
                                   my * (0.5f - q1q1 - q3q3) + mz * (q2q3 - q0q1));
                float bx = sqrtf(hx * hx + hy * hy);
                float bz = 2.0f * (mx * (q1q3 - q0q2) +
                                   my * (q2q3 + q0q1) + mz * (0.5f - q1q1 - q2q2));
                float wx = 2.0f * (bx * (0.5f - q2q2 - q3q3) + bz * (q1q3 - q0q2));
                float wy = 2.0f * (bx * (q1q2 - q0q3) + bz * (q0q1 + q2q3));
                float wz = 2.0f * (bx * (q0q2 + q1q3) + bz * (0.5f - q1q1 - q2q2));
                ex += my * wz - mz * wy;
                ey += mz * wx - mx * wz;
                ez += mx * wy - my * wx;
            }
        }

        gx += MAHONY_KP * ex;
        gy += MAHONY_KP * ey;
        gz += MAHONY_KP * ez;
    }

    gx *= 0.5f * dt;
    gy *= 0.5f * dt;
    gz *= 0.5f * dt;
    float qa = q0;
    float qb = q1;
    float qc = q2;
    q0 += (-qb * gx - qc * gy - q3 * gz);
    q1 += (qa * gx + qc * gz - q3 * gy);
    q2 += (qa * gy - qb * gz + q3 * gx);
    q3 += (qa * gz + qb * gy - qc * gx);

    float n = sqrtf(q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3);
    if (n > 0.0f) {
        state->q0 = q0 / n;
        state->q1 = q1 / n;
        state->q2 = q2 / n;
        state->q3 = q3 / n;
    }
}

void mahony_get_q15(const mahony_state_t *state, int16_t q_out[4])
{
    if (!state || !q_out) {
        return;
    }
    const float q[4] = { state->q0, state->q1, state->q2, state->q3 };
    for (int i = 0; i < 4; i++) {
        float s = q[i] * 32767.0f;
        if (s > 32767.0f) {
            s = 32767.0f;
        } else if (s < -32767.0f) {
            s = -32767.0f;
        }
        q_out[i] = (int16_t)s;
    }
}
