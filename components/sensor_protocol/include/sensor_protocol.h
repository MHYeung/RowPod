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

/** Pod configuration / software-sync service (fixed protocol UUIDs). */
#define SENSOR_PROTO_CFG_SVC_UUID_STR   "9b7e2000-2b2f-4f71-9b86-4bb2e6d54f00"
#define SENSOR_PROTO_CFG_INFO_UUID_STR  "9b7e2001-2b2f-4f71-9b86-4bb2e6d54f00"
#define SENSOR_PROTO_CFG_NAME_UUID_STR  "9b7e2002-2b2f-4f71-9b86-4bb2e6d54f00"
#define SENSOR_PROTO_CFG_SYNC_UUID_STR  "9b7e2003-2b2f-4f71-9b86-4bb2e6d54f00"
#define SENSOR_PROTO_CFG_BATT_UUID_STR  "9b7e2004-2b2f-4f71-9b86-4bb2e6d54f00"
#define SENSOR_PROTO_CFG_RATE_UUID_STR  "9b7e2005-2b2f-4f71-9b86-4bb2e6d54f00"

#define SENSOR_PROTO_FRAME_LEN      20
#define SENSOR_PROTO_META_LEN       12
#define SENSOR_PROTO_CFG_INFO_LEN   4
#define SENSOR_PROTO_CFG_BATT_LEN   4
#define SENSOR_PROTO_CFG_RATE_LEN   1
#define SENSOR_PROTO_CFG_SYNC_REQ_LEN  8
#define SENSOR_PROTO_CFG_SYNC_RSP_LEN  20
/** batt.flags bit0: reading valid */
#define SENSOR_PROTO_BATT_FLAG_VALID  0x01
#define SENSOR_PROTO_FORMAT_VER     1
/** Default stream rate while connected for live monitor (not logging). */
#define SENSOR_PROTO_RATE_LIVE_HZ   50
/** High-rate capture while the dashboard is logging. */
#define SENSOR_PROTO_RATE_LOG_HZ    100
#define SENSOR_PROTO_RATE_LOG_MAX_HZ 150
/** @deprecated use SENSOR_PROTO_RATE_LIVE_HZ */
#define SENSOR_PROTO_RATE_HZ        SENSOR_PROTO_RATE_LIVE_HZ

/** meta.flags bit0: multi-pod mode active on device. */
#define SENSOR_PROTO_FLAG_MULTI     0x0001

/**
 * @brief Live sample frame (packed little-endian on the wire).
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

void sensor_proto_pack_frame(uint8_t out[SENSOR_PROTO_FRAME_LEN], const sensor_proto_frame_t *frame);
void sensor_proto_pack_meta(uint8_t out[SENSOR_PROTO_META_LEN], const sensor_proto_meta_t *meta);

#ifdef __cplusplus
}
#endif
