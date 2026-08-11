#include "sensor_protocol.h"

#include <string.h>

void sensor_proto_pack_frame(uint8_t out[SENSOR_PROTO_FRAME_LEN], const sensor_proto_frame_t *frame)
{
    /* Struct is already packed LE on little-endian RISC-V; memcpy is fine. */
    memcpy(out, frame, SENSOR_PROTO_FRAME_LEN);
}

void sensor_proto_pack_frame_v16(uint8_t out[SENSOR_PROTO_FRAME_V16_LEN],
                                 const sensor_proto_frame_v16_t *frame)
{
    memcpy(out, frame, SENSOR_PROTO_FRAME_V16_LEN);
}

void sensor_proto_sample_to_frame_v1(sensor_proto_frame_t *out,
                                     const sensor_proto_sample_t *sample)
{
    out->seq = (uint16_t)(sample->sample_index & 0xffffu);
    out->ax = sample->ax;
    out->ay = sample->ay;
    out->az = sample->az;
    out->gx = sample->gx;
    out->gy = sample->gy;
    out->gz = sample->gz;
    out->mx = sample->mx;
    out->my = sample->my;
    out->mz = sample->mz;
}

void sensor_proto_sample_to_frame_v16(sensor_proto_frame_v16_t *out,
                                      const sensor_proto_sample_t *sample)
{
    out->sample_index = sample->sample_index;
    out->ax = sample->ax;
    out->ay = sample->ay;
    out->az = sample->az;
    out->gx = sample->gx;
    out->gy = sample->gy;
    out->gz = sample->gz;
    out->mx = sample->mx;
    out->my = sample->my;
    out->mz = sample->mz;
}

void sensor_proto_pack_meta(uint8_t out[SENSOR_PROTO_META_LEN], const sensor_proto_meta_t *meta)
{
    memcpy(out, meta, SENSOR_PROTO_META_LEN);
}

void sensor_proto_pack_caps(uint8_t out[SENSOR_PROTO_CFG_CAPS_LEN],
                            const sensor_proto_caps_t *caps)
{
    memcpy(out, caps, SENSOR_PROTO_CFG_CAPS_LEN);
}

void sensor_proto_pack_session_status(
    uint8_t out[SENSOR_PROTO_CFG_STATUS_LEN],
    const sensor_proto_session_status_t *status)
{
    memcpy(out, status, SENSOR_PROTO_CFG_STATUS_LEN);
}

void sensor_proto_pack_session_status_v16(
    uint8_t out[SENSOR_PROTO_CFG_STATUS_V16_LEN],
    const sensor_proto_session_status_v16_t *status)
{
    memcpy(out, status, SENSOR_PROTO_CFG_STATUS_V16_LEN);
}

void sensor_proto_unpack_session_cmd(
    sensor_proto_session_cmd_t *cmd,
    const uint8_t in[SENSOR_PROTO_CFG_SESSION_LEN])
{
    memcpy(cmd, in, SENSOR_PROTO_CFG_SESSION_LEN);
}

void sensor_proto_unpack_session_cmd_v16(
    sensor_proto_session_cmd_v16_t *cmd,
    const uint8_t in[SENSOR_PROTO_CFG_SESSION_V16_LEN])
{
    memcpy(cmd, in, SENSOR_PROTO_CFG_SESSION_V16_LEN);
}
