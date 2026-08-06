#include "sensor_protocol.h"

#include <string.h>

void sensor_proto_pack_frame(uint8_t out[SENSOR_PROTO_FRAME_LEN], const sensor_proto_frame_t *frame)
{
    /* Struct is already packed LE on little-endian RISC-V; memcpy is fine. */
    memcpy(out, frame, SENSOR_PROTO_FRAME_LEN);
}

void sensor_proto_pack_meta(uint8_t out[SENSOR_PROTO_META_LEN], const sensor_proto_meta_t *meta)
{
    memcpy(out, meta, SENSOR_PROTO_META_LEN);
}
