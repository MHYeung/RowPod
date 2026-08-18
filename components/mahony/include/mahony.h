#pragma once

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Mahony AHRS (gyro integration + accel tilt + optional mag yaw).
 *
 * Soft-float on ESP32-C3 (no FPU). Intended to run in the I2C-owning
 * sensor_stream task at IMU ODR; pass mag_valid only when a new
 * magnetometer sample is available (~10 ms at 100 Hz).
 */
typedef struct {
    float q0; /**< Scalar */
    float q1;
    float q2;
    float q3;
    float integral_x;
    float integral_y;
    float integral_z;
} mahony_state_t;

/** @brief Identity quaternion, cleared integral. */
void mahony_init(mahony_state_t *state);

/**
 * @brief One AHRS step.
 *
 * @param gx,gy,gz  Gyro in rad/s (body frame).
 * @param ax,ay,az  Accel in g (any unit; normalised internally).
 * @param mx,my,mz  Mag in any unit; ignored unless mag_valid.
 * @param mag_valid True only on a fresh magnetometer sample.
 * @param dt        Seconds since last update (include coalesced DRDY gaps).
 */
void mahony_update(mahony_state_t *state,
                   float gx, float gy, float gz,
                   float ax, float ay, float az,
                   float mx, float my, float mz,
                   bool mag_valid, float dt);

/** @brief Pack attitude as Q15 (32767 = 1.0). */
void mahony_get_q15(const mahony_state_t *state, int16_t q_out[4]);

#ifdef __cplusplus
}
#endif
