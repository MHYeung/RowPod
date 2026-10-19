#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Custom motion service UUIDs (byte order for BLE_UUID128_INIT / little-endian wire).
 * String form: 9b7e1000-2b2f-4f71-9b86-4bb2e6d54f00
 */
#define SENSOR_PROTO_SVC_UUID_STR   "9b7e1000-2b2f-4f71-9b86-4bb2e6d54f00"
#define SENSOR_PROTO_DATA_UUID_STR  "9b7e1001-2b2f-4f71-9b86-4bb2e6d54f00"
#define SENSOR_PROTO_META_UUID_STR  "9b7e1002-2b2f-4f71-9b86-4bb2e6d54f00"
/** Additive v16 motion notify: uint32 sample_index + 9×int16. */
#define SENSOR_PROTO_DATA_V16_UUID_STR "9b7e1003-2b2f-4f71-9b86-4bb2e6d54f00"
/** On-device Mahony: uint32 sample_index + Q15 quat + accel + mag. */
#define SENSOR_PROTO_DATA_FUSED_UUID_STR "9b7e1004-2b2f-4f71-9b86-4bb2e6d54f00"
/** One notify per completed stroke for a speed-coach central. 20 bytes, MTU 23. */
#define SENSOR_PROTO_DATA_SUMMARY_UUID_STR "9b7e1005-2b2f-4f71-9b86-4bb2e6d54f00"

/** Pod configuration / software-sync service (fixed protocol UUIDs). */
#define SENSOR_PROTO_CFG_SVC_UUID_STR   "9b7e2000-2b2f-4f71-9b86-4bb2e6d54f00"
#define SENSOR_PROTO_CFG_INFO_UUID_STR  "9b7e2001-2b2f-4f71-9b86-4bb2e6d54f00"
#define SENSOR_PROTO_CFG_NAME_UUID_STR  "9b7e2002-2b2f-4f71-9b86-4bb2e6d54f00"
#define SENSOR_PROTO_CFG_SYNC_UUID_STR  "9b7e2003-2b2f-4f71-9b86-4bb2e6d54f00"
#define SENSOR_PROTO_CFG_BATT_UUID_STR  "9b7e2004-2b2f-4f71-9b86-4bb2e6d54f00"
#define SENSOR_PROTO_CFG_RATE_UUID_STR  "9b7e2005-2b2f-4f71-9b86-4bb2e6d54f00"
#define SENSOR_PROTO_CFG_PROFILE_UUID_STR "9b7e2006-2b2f-4f71-9b86-4bb2e6d54f00"
/** Legacy v1 session/status (8 / 36 bytes) — preserved for v15 clients. */
#define SENSOR_PROTO_CFG_SESSION_UUID_STR "9b7e2007-2b2f-4f71-9b86-4bb2e6d54f00"
#define SENSOR_PROTO_CFG_STATUS_UUID_STR  "9b7e2008-2b2f-4f71-9b86-4bb2e6d54f00"
/** Additive v16 capability / session / status characteristics. */
#define SENSOR_PROTO_CFG_CAPS_UUID_STR    "9b7e2009-2b2f-4f71-9b86-4bb2e6d54f00"
#define SENSOR_PROTO_CFG_SESSION_V16_UUID_STR "9b7e200a-2b2f-4f71-9b86-4bb2e6d54f00"
#define SENSOR_PROTO_CFG_STATUS_V16_UUID_STR  "9b7e200b-2b2f-4f71-9b86-4bb2e6d54f00"
/** Speed-coach control: ZERO / SET_SIGN / CLEAR. Not used by the phone PWA. */
#define SENSOR_PROTO_CFG_COACH_UUID_STR "9b7e200c-2b2f-4f71-9b86-4bb2e6d54f00"

#define SENSOR_PROTO_FRAME_LEN      20
#define SENSOR_PROTO_FRAME_V16_LEN  22
#define SENSOR_PROTO_FRAME_FUSED_LEN 24
#define SENSOR_PROTO_META_LEN       12
#define SENSOR_PROTO_CFG_INFO_LEN   4
#define SENSOR_PROTO_CFG_BATT_LEN   4
#define SENSOR_PROTO_CFG_RATE_LEN   1
#define SENSOR_PROTO_CFG_PROFILE_LEN 1
#define SENSOR_PROTO_CFG_SESSION_LEN 8
#define SENSOR_PROTO_CFG_STATUS_LEN 36
#define SENSOR_PROTO_CFG_CAPS_LEN   20
#define SENSOR_PROTO_CFG_SESSION_V16_LEN 12
#define SENSOR_PROTO_CFG_STATUS_V16_LEN  56
#define SENSOR_PROTO_CFG_SYNC_REQ_LEN  8
#define SENSOR_PROTO_CFG_SYNC_RSP_LEN  20
#define SENSOR_PROTO_SUMMARY_LEN       20
#define SENSOR_PROTO_SUMMARY_VER       1
/** summary.flags */
#define SENSOR_PROTO_SUMMARY_FLAG_ZEROED  0x01
#define SENSOR_PROTO_SUMMARY_FLAG_FEATHER 0x02
#define SENSOR_PROTO_SUMMARY_FLAG_VALID   0x04
/** Writes to the coach-control characteristic. SET_SIGN carries a second byte. */
#define SENSOR_PROTO_COACH_ZERO     1
#define SENSOR_PROTO_COACH_SET_SIGN 2
#define SENSOR_PROTO_COACH_CLEAR    3
/** SET_SIGN argument: 0 keeps catch-to-finish positive for this mount, 1 flips it. */
#define SENSOR_PROTO_COACH_SIDE_STROKE 0
#define SENSOR_PROTO_COACH_SIDE_BOW    1
/** Sync response: uint64 client_ms, uint64 device_us, uint32 sample_index. */
/** batt.flags bit0: reading valid */
#define SENSOR_PROTO_BATT_FLAG_VALID  0x01
/** Wire format version on legacy v1 characteristics. */
#define SENSOR_PROTO_FORMAT_VER     1
/** Additive protocol version for v16 characteristics. */
#define SENSOR_PROTO_FORMAT_VER_V16 2
/** Fused quaternion notify (Mahony on-device). */
#define SENSOR_PROTO_FORMAT_VER_FUSED 3
/** Sensor-native 6-DoF rates; sequence numbers are therefore a uniform clock. */
#define SENSOR_PROTO_RATE_LIVE_HZ        56
#define SENSOR_PROTO_RATE_LOG_HZ        112
#define SENSOR_PROTO_RATE_HIGH_HZ       224
/** QMI8658A 6-DoF ODR 448.4 Hz (CTRL2/3 code 0x4). Accel-only 500 Hz is not used. */
#define SENSOR_PROTO_RATE_CAPTURE_HZ    448
#define SENSOR_PROTO_RATE_LOG_MAX_HZ    SENSOR_PROTO_RATE_CAPTURE_HZ
/**
 * uint8 wire token for 448 Hz. Packed rate fields are one byte, so 448 cannot
 * be sent as Hertz; 255 is reserved for this profile.
 */
#define SENSOR_PROTO_RATE_CAPTURE_WIRE  255
/** Host-selected workout processing profile. */
#define SENSOR_PROTO_PROFILE_GENERAL 0
#define SENSOR_PROTO_PROFILE_HYROX   1
#define SENSOR_PROTO_PROFILE_ROWING  2
/** Session command values written by the host. */
#define SENSOR_PROTO_SESSION_PREPARE  1
#define SENSOR_PROTO_SESSION_START    2
#define SENSOR_PROTO_SESSION_STOP     3
#define SENSOR_PROTO_SESSION_DRAIN    4
#define SENSOR_PROTO_SESSION_FINALIZE 5
#define SENSOR_PROTO_SESSION_ABORT    6
/** Session state values reported by the pod. */
#define SENSOR_PROTO_STATE_IDLE           0
#define SENSOR_PROTO_STATE_PREPARED       1
#define SENSOR_PROTO_STATE_RECORDING      2
#define SENSOR_PROTO_STATE_STOP_REQUESTED 3
#define SENSOR_PROTO_STATE_DRAINING       4
#define SENSOR_PROTO_STATE_FINALIZED      5
#define SENSOR_PROTO_STATE_ERROR          6
/** session.status.flags bits (v1 and v16). */
#define SENSOR_PROTO_SESSION_FLAG_CONNECTED   0x01
#define SENSOR_PROTO_SESSION_FLAG_SUBSCRIBED  0x02
#define SENSOR_PROTO_SESSION_FLAG_STREAMING   0x04
#define SENSOR_PROTO_SESSION_FLAG_BATT_VALID  0x08
#define SENSOR_PROTO_SESSION_FLAG_HAS_SAMPLES 0x10
#define SENSOR_PROTO_SESSION_FLAG_DRAIN_DONE  0x20
#define SENSOR_PROTO_SESSION_FLAG_RATE_APPLIED 0x40
/** Session / transport error reason codes. */
#define SENSOR_PROTO_ERR_NONE                 0
#define SENSOR_PROTO_ERR_BAD_VERSION          1
#define SENSOR_PROTO_ERR_BAD_STATE            2
#define SENSOR_PROTO_ERR_BAD_CAPTURE_ID       3
#define SENSOR_PROTO_ERR_BAD_RATE             4
#define SENSOR_PROTO_ERR_DRAIN_INCOMPLETE     5
#define SENSOR_PROTO_ERR_BUSY                 6
/** Capability feature flags. */
#define SENSOR_PROTO_CAP_FLAG_V1_FRAME        0x01
#define SENSOR_PROTO_CAP_FLAG_V16_FRAME       0x02
#define SENSOR_PROTO_CAP_FLAG_DRAIN_BARRIER   0x04
#define SENSOR_PROTO_CAP_FLAG_APPLIED_RATE    0x08
#define SENSOR_PROTO_CAP_FLAG_32BIT_SEQ       0x10
#define SENSOR_PROTO_CAP_FLAG_FUSED_FRAME     0x20
#define SENSOR_PROTO_CAP_FLAG_COACH_SUMMARY   0x40
/** Rate support bitmask bits. */
#define SENSOR_PROTO_RATE_MASK_56             0x01
#define SENSOR_PROTO_RATE_MASK_112            0x02
#define SENSOR_PROTO_RATE_MASK_224            0x04
#define SENSOR_PROTO_RATE_MASK_448            0x08

static inline uint8_t sensor_proto_rate_to_wire(uint16_t hz)
{
    if (hz >= SENSOR_PROTO_RATE_CAPTURE_HZ) {
        return SENSOR_PROTO_RATE_CAPTURE_WIRE;
    }
    return (uint8_t)hz;
}

static inline uint16_t sensor_proto_rate_from_wire(uint8_t wire)
{
    if (wire == SENSOR_PROTO_RATE_CAPTURE_WIRE) {
        return SENSOR_PROTO_RATE_CAPTURE_HZ;
    }
    return wire;
}
/** @deprecated use SENSOR_PROTO_RATE_LIVE_HZ */
#define SENSOR_PROTO_RATE_HZ        SENSOR_PROTO_RATE_LIVE_HZ

/** meta.flags bit0: multi-pod mode active on device. */
#define SENSOR_PROTO_FLAG_MULTI     0x0001

/**
 * @brief Shared internal sample (host and firmware).
 *
 * sample_index is a monotonic 32-bit IMU clock; the legacy 16-bit wire seq is
 * sample_index truncated to uint16.
 */
typedef struct {
    uint32_t sample_index;
    int16_t ax;
    int16_t ay;
    int16_t az;
    int16_t gx;
    int16_t gy;
    int16_t gz;
    int16_t mx;
    int16_t my;
    int16_t mz;
    int16_t qw; /**< Q15, 32767 = 1.0 */
    int16_t qx;
    int16_t qy;
    int16_t qz;
} sensor_proto_sample_t;

/**
 * @brief Legacy v1 live sample frame (packed little-endian on the wire).
 *
 * Wire: uint16 seq; int16 ax,ay,az,gx,gy,gz,mx,my,mz;
 */
typedef struct __attribute__((packed)) {
    uint16_t seq;
    int16_t ax;
    int16_t ay;
    int16_t az;
    int16_t gx;
    int16_t gy;
    int16_t gz;
    int16_t mx;
    int16_t my;
    int16_t mz;
} sensor_proto_frame_t;

_Static_assert(sizeof(sensor_proto_frame_t) == SENSOR_PROTO_FRAME_LEN, "frame size");

/**
 * @brief Additive v16 motion frame (packed little-endian on the wire).
 *
 * Wire: uint32 sample_index; int16 ax,ay,az,gx,gy,gz,mx,my,mz;
 */
typedef struct __attribute__((packed)) {
    uint32_t sample_index;
    int16_t ax;
    int16_t ay;
    int16_t az;
    int16_t gx;
    int16_t gy;
    int16_t gz;
    int16_t mx;
    int16_t my;
    int16_t mz;
} sensor_proto_frame_v16_t;

_Static_assert(sizeof(sensor_proto_frame_v16_t) == SENSOR_PROTO_FRAME_V16_LEN,
               "v16 frame size");

/**
 * @brief Fused attitude frame (packed little-endian).
 *
 * Wire (24 B): uint32 sample_index; int16 qw,qx,qy,qz (Q15); ax,ay,az; mx,my,mz.
 * Gyro is consumed on-device by Mahony and omitted to shrink the notify.
 */
typedef struct __attribute__((packed)) {
    uint32_t sample_index;
    int16_t qw;
    int16_t qx;
    int16_t qy;
    int16_t qz;
    int16_t ax;
    int16_t ay;
    int16_t az;
    int16_t mx;
    int16_t my;
    int16_t mz;
} sensor_proto_frame_fused_t;

_Static_assert(sizeof(sensor_proto_frame_fused_t) == SENSOR_PROTO_FRAME_FUSED_LEN,
               "fused frame size");

/**
 * @brief Per-stroke summary for a speed-coach central.
 *
 * Angles are decidegrees (0.1 deg). arc_ddeg is the absolute drive arc.
 * spm_x10 is catch-to-catch rate times 10. batt_pct is 255 when unknown.
 */
typedef struct __attribute__((packed)) {
    uint8_t ver;
    uint8_t flags;
    uint16_t stroke_idx;
    uint32_t sample_index;
    int16_t catch_ddeg;
    int16_t finish_ddeg;
    uint16_t arc_ddeg;
    uint16_t spm_x10;
    uint16_t drive_ms;
    uint8_t batt_pct;
    uint8_t reserved;
} sensor_proto_summary_t;

_Static_assert(sizeof(sensor_proto_summary_t) == SENSOR_PROTO_SUMMARY_LEN,
               "coach summary size");

typedef struct __attribute__((packed)) {
    uint8_t ver;
    uint8_t rate_hz;
    uint16_t accel_lsb_per_g;
    uint16_t gyro_lsb_per_dps;
    uint16_t mag_lsb_per_gauss;
    uint16_t flags;
    uint16_t reserved; /**< pad to 12 bytes for stable wire size */
} sensor_proto_meta_t;

_Static_assert(sizeof(sensor_proto_meta_t) == SENSOR_PROTO_META_LEN, "meta size");

/**
 * @brief Read-only capability snapshot for host preflight.
 *
 * Wire (20 B): ver, feature_flags, rate_mask, max_batch_frames, max_rate_hz,
 * imu_rate_hz, mag_rate_hz, reserved0, att_mtu(u16), queue_depth_max(u16),
 * firmware_proto(u16), reserved1(u16), reserved2(u32).
 */
typedef struct __attribute__((packed)) {
    uint8_t ver;
    uint8_t feature_flags;
    uint8_t rate_mask;
    uint8_t max_batch_frames;
    uint8_t max_rate_hz;
    uint8_t imu_rate_hz;
    uint8_t mag_rate_hz;
    uint8_t reserved0;
    uint16_t att_mtu;
    uint16_t queue_depth_max;
    uint16_t firmware_proto;
    uint16_t reserved1;
    uint32_t reserved2;
} sensor_proto_caps_t;

_Static_assert(sizeof(sensor_proto_caps_t) == SENSOR_PROTO_CFG_CAPS_LEN, "caps size");

/**
 * @brief Host command for the capture lifecycle (legacy v1).
 *
 * Wire: uint8 ver, command, requested_rate_hz, flags; uint32 capture_id.
 */
typedef struct __attribute__((packed)) {
    uint8_t ver;
    uint8_t command;
    uint8_t rate_hz;
    uint8_t flags;
    uint32_t capture_id;
} sensor_proto_session_cmd_t;

_Static_assert(sizeof(sensor_proto_session_cmd_t) == SENSOR_PROTO_CFG_SESSION_LEN,
               "session command size");

/**
 * @brief Additive v16 session command with command identity.
 *
 * Wire: ver, command, rate_hz, flags; capture_id(u32); command_id(u16); reserved(u16).
 */
typedef struct __attribute__((packed)) {
    uint8_t ver;
    uint8_t command;
    uint8_t rate_hz;
    uint8_t flags;
    uint32_t capture_id;
    uint16_t command_id;
    uint16_t reserved;
} sensor_proto_session_cmd_v16_t;

_Static_assert(sizeof(sensor_proto_session_cmd_v16_t) == SENSOR_PROTO_CFG_SESSION_V16_LEN,
               "v16 session command size");

/**
 * @brief Low-rate pod status snapshot for session manifests and endurance logs.
 */
typedef struct __attribute__((packed)) {
    uint8_t ver;
    uint8_t state;
    uint8_t rate_hz;
    uint8_t flags;
    uint32_t capture_id;
    uint16_t rate_epoch;
    uint16_t first_seq;
    uint16_t last_seq;
    uint16_t queue_depth;
    uint32_t sensor_dropped;
    uint32_t transport_dropped;
    uint32_t notify_failures;
    uint32_t uptime_ms;
    uint16_t battery_mv;
    uint8_t battery_pct;
    uint8_t reserved;
} sensor_proto_session_status_t;

_Static_assert(sizeof(sensor_proto_session_status_t) == SENSOR_PROTO_CFG_STATUS_LEN,
               "session status size");

/**
 * @brief Additive v16 status with drain barrier and applied-rate fields.
 */
typedef struct __attribute__((packed)) {
    uint8_t ver;
    uint8_t state;
    uint8_t requested_rate_hz;
    uint8_t applied_rate_hz;
    uint8_t flags;
    uint8_t error_reason;
    uint16_t last_command_id;
    uint32_t capture_id;
    uint16_t rate_epoch;
    uint16_t att_mtu;
    uint32_t first_sample;
    uint32_t last_produced;
    uint32_t last_sent;
    uint32_t final_sample;
    uint16_t queue_depth;
    uint16_t queue_high_water;
    uint32_t sensor_dropped;
    uint32_t transport_dropped;
    uint32_t notify_failures;
    uint32_t uptime_ms;
    uint16_t battery_mv;
    uint8_t battery_pct;
    uint8_t mag_rate_hz;
} sensor_proto_session_status_v16_t;

_Static_assert(sizeof(sensor_proto_session_status_v16_t) == SENSOR_PROTO_CFG_STATUS_V16_LEN,
               "v16 session status size");

void sensor_proto_pack_frame(uint8_t out[SENSOR_PROTO_FRAME_LEN], const sensor_proto_frame_t *frame);
void sensor_proto_pack_frame_v16(uint8_t out[SENSOR_PROTO_FRAME_V16_LEN],
                                 const sensor_proto_frame_v16_t *frame);
void sensor_proto_pack_frame_fused(uint8_t out[SENSOR_PROTO_FRAME_FUSED_LEN],
                                   const sensor_proto_frame_fused_t *frame);
void sensor_proto_sample_to_frame_v1(sensor_proto_frame_t *out,
                                     const sensor_proto_sample_t *sample);
void sensor_proto_sample_to_frame_v16(sensor_proto_frame_v16_t *out,
                                      const sensor_proto_sample_t *sample);
void sensor_proto_sample_to_frame_fused(sensor_proto_frame_fused_t *out,
                                        const sensor_proto_sample_t *sample);
void sensor_proto_pack_meta(uint8_t out[SENSOR_PROTO_META_LEN], const sensor_proto_meta_t *meta);
void sensor_proto_pack_caps(uint8_t out[SENSOR_PROTO_CFG_CAPS_LEN],
                            const sensor_proto_caps_t *caps);
void sensor_proto_pack_session_status(
    uint8_t out[SENSOR_PROTO_CFG_STATUS_LEN],
    const sensor_proto_session_status_t *status);
void sensor_proto_pack_session_status_v16(
    uint8_t out[SENSOR_PROTO_CFG_STATUS_V16_LEN],
    const sensor_proto_session_status_v16_t *status);
void sensor_proto_unpack_session_cmd(
    sensor_proto_session_cmd_t *cmd,
    const uint8_t in[SENSOR_PROTO_CFG_SESSION_LEN]);
void sensor_proto_unpack_session_cmd_v16(
    sensor_proto_session_cmd_v16_t *cmd,
    const uint8_t in[SENSOR_PROTO_CFG_SESSION_V16_LEN]);

#ifdef __cplusplus
}
#endif
