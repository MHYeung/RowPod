#include "ble_tracker.h"

#include <assert.h>
#include <inttypes.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

#include "battery.h"
#include "device_config.h"
#include "esp_check.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h" // IWYU pragma: keep
#include "host/ble_hs.h"
#include "host/ble_gap.h"
#include "host/ble_att.h"
#include "host/ble_uuid.h"
#include "host/util/util.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "rowing_metrics.h"
#include "sensor_protocol.h"
#include "sensor_stream.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"
#include "ui.h"

static const char *TAG = "ble_tracker";

static const ble_uuid128_t uuid_motion_svc =
    BLE_UUID128_INIT(0x00, 0x4f, 0xd5, 0xe6, 0xb2, 0x4b, 0x86, 0x9b,
                     0x71, 0x4f, 0x2f, 0x2b, 0x00, 0x10, 0x7e, 0x9b);
static const ble_uuid128_t uuid_motion_data =
    BLE_UUID128_INIT(0x00, 0x4f, 0xd5, 0xe6, 0xb2, 0x4b, 0x86, 0x9b,
                     0x71, 0x4f, 0x2f, 0x2b, 0x01, 0x10, 0x7e, 0x9b);
static const ble_uuid128_t uuid_motion_meta =
    BLE_UUID128_INIT(0x00, 0x4f, 0xd5, 0xe6, 0xb2, 0x4b, 0x86, 0x9b,
                     0x71, 0x4f, 0x2f, 0x2b, 0x02, 0x10, 0x7e, 0x9b);
static const ble_uuid128_t uuid_motion_data_v16 =
    BLE_UUID128_INIT(0x00, 0x4f, 0xd5, 0xe6, 0xb2, 0x4b, 0x86, 0x9b,
                     0x71, 0x4f, 0x2f, 0x2b, 0x03, 0x10, 0x7e, 0x9b);
static const ble_uuid128_t uuid_motion_data_fused =
    BLE_UUID128_INIT(0x00, 0x4f, 0xd5, 0xe6, 0xb2, 0x4b, 0x86, 0x9b,
                     0x71, 0x4f, 0x2f, 0x2b, 0x04, 0x10, 0x7e, 0x9b);
static const ble_uuid128_t uuid_motion_summary =
    BLE_UUID128_INIT(0x00, 0x4f, 0xd5, 0xe6, 0xb2, 0x4b, 0x86, 0x9b,
                     0x71, 0x4f, 0x2f, 0x2b, 0x05, 0x10, 0x7e, 0x9b);

static const ble_uuid128_t uuid_cfg_svc =
    BLE_UUID128_INIT(0x00, 0x4f, 0xd5, 0xe6, 0xb2, 0x4b, 0x86, 0x9b,
                     0x71, 0x4f, 0x2f, 0x2b, 0x00, 0x20, 0x7e, 0x9b);
static const ble_uuid128_t uuid_cfg_info =
    BLE_UUID128_INIT(0x00, 0x4f, 0xd5, 0xe6, 0xb2, 0x4b, 0x86, 0x9b,
                     0x71, 0x4f, 0x2f, 0x2b, 0x01, 0x20, 0x7e, 0x9b);
static const ble_uuid128_t uuid_cfg_name =
    BLE_UUID128_INIT(0x00, 0x4f, 0xd5, 0xe6, 0xb2, 0x4b, 0x86, 0x9b,
                     0x71, 0x4f, 0x2f, 0x2b, 0x02, 0x20, 0x7e, 0x9b);
static const ble_uuid128_t uuid_cfg_sync =
    BLE_UUID128_INIT(0x00, 0x4f, 0xd5, 0xe6, 0xb2, 0x4b, 0x86, 0x9b,
                     0x71, 0x4f, 0x2f, 0x2b, 0x03, 0x20, 0x7e, 0x9b);
static const ble_uuid128_t uuid_cfg_batt =
    BLE_UUID128_INIT(0x00, 0x4f, 0xd5, 0xe6, 0xb2, 0x4b, 0x86, 0x9b,
                     0x71, 0x4f, 0x2f, 0x2b, 0x04, 0x20, 0x7e, 0x9b);
static const ble_uuid128_t uuid_cfg_rate =
    BLE_UUID128_INIT(0x00, 0x4f, 0xd5, 0xe6, 0xb2, 0x4b, 0x86, 0x9b,
                     0x71, 0x4f, 0x2f, 0x2b, 0x05, 0x20, 0x7e, 0x9b);
static const ble_uuid128_t uuid_cfg_profile =
    BLE_UUID128_INIT(0x00, 0x4f, 0xd5, 0xe6, 0xb2, 0x4b, 0x86, 0x9b,
                     0x71, 0x4f, 0x2f, 0x2b, 0x06, 0x20, 0x7e, 0x9b);
static const ble_uuid128_t uuid_cfg_session =
    BLE_UUID128_INIT(0x00, 0x4f, 0xd5, 0xe6, 0xb2, 0x4b, 0x86, 0x9b,
                     0x71, 0x4f, 0x2f, 0x2b, 0x07, 0x20, 0x7e, 0x9b);
static const ble_uuid128_t uuid_cfg_status =
    BLE_UUID128_INIT(0x00, 0x4f, 0xd5, 0xe6, 0xb2, 0x4b, 0x86, 0x9b,
                     0x71, 0x4f, 0x2f, 0x2b, 0x08, 0x20, 0x7e, 0x9b);
static const ble_uuid128_t uuid_cfg_caps =
    BLE_UUID128_INIT(0x00, 0x4f, 0xd5, 0xe6, 0xb2, 0x4b, 0x86, 0x9b,
                     0x71, 0x4f, 0x2f, 0x2b, 0x09, 0x20, 0x7e, 0x9b);
static const ble_uuid128_t uuid_cfg_session_v16 =
    BLE_UUID128_INIT(0x00, 0x4f, 0xd5, 0xe6, 0xb2, 0x4b, 0x86, 0x9b,
                     0x71, 0x4f, 0x2f, 0x2b, 0x0a, 0x20, 0x7e, 0x9b);
static const ble_uuid128_t uuid_cfg_status_v16 =
    BLE_UUID128_INIT(0x00, 0x4f, 0xd5, 0xe6, 0xb2, 0x4b, 0x86, 0x9b,
                     0x71, 0x4f, 0x2f, 0x2b, 0x0b, 0x20, 0x7e, 0x9b);
static const ble_uuid128_t uuid_cfg_coach =
    BLE_UUID128_INIT(0x00, 0x4f, 0xd5, 0xe6, 0xb2, 0x4b, 0x86, 0x9b,
                     0x71, 0x4f, 0x2f, 0x2b, 0x0c, 0x20, 0x7e, 0x9b);

static uint8_t s_own_addr_type;
static uint16_t s_conn_handle = BLE_HS_CONN_HANDLE_NONE;
static uint16_t s_data_val_handle;
static uint16_t s_data_v16_val_handle;
static uint16_t s_data_fused_val_handle;
static uint16_t s_summary_val_handle;
static uint16_t s_coach_val_handle;
static bool s_summary_subscribed;
static uint8_t s_summary[SENSOR_PROTO_SUMMARY_LEN];
static uint16_t s_meta_val_handle;
static uint16_t s_info_val_handle;
static uint16_t s_name_val_handle;
static uint16_t s_sync_val_handle;
static uint16_t s_batt_val_handle;
static uint16_t s_rate_val_handle;
static uint16_t s_profile_val_handle;
static uint16_t s_session_val_handle;
static uint16_t s_status_val_handle;
static uint16_t s_caps_val_handle;
static uint16_t s_session_v16_val_handle;
static uint16_t s_status_v16_val_handle;
static volatile bool s_notify_enabled;
static volatile bool s_motion_subscribed;
static volatile bool s_motion_v16_subscribed;
static volatile bool s_motion_fused_subscribed;
static volatile bool s_stream_requested;
static volatile bool s_advertising;
static volatile bool s_stack_running;
static ble_tracker_link_cb_t s_link_cb;
static char s_adv_name[DEVICE_CONFIG_NAME_MAX + 1];
static uint8_t s_sync_rsp[SENSOR_PROTO_CFG_SYNC_RSP_LEN];
static bool s_sync_rsp_valid;
static volatile uint8_t s_workout_profile = SENSOR_PROTO_PROFILE_GENERAL;
static volatile uint8_t s_session_state = SENSOR_PROTO_STATE_IDLE;
static uint32_t s_capture_id;
static uint16_t s_rate_epoch;
static uint16_t s_last_command_id;
static uint8_t s_last_error_reason;
static volatile bool s_session_first_valid;
static volatile uint32_t s_session_first_sample;
static volatile uint32_t s_last_produced;
static volatile uint32_t s_last_sent;
static volatile uint32_t s_final_sample;
static volatile bool s_drain_complete;
static volatile bool s_accept_transport;
static uint16_t s_queue_high_water;
static uint32_t s_session_sensor_base;
static uint32_t s_session_transport_base;
static uint32_t s_session_notify_base;
static uint16_t s_epoch_rate_hz;

/* 256 × 32 B ≈ 8 KB: covers a ~450 ms Windows delivery stall at 448 Hz
 * (≈200 frames) without overwriting the oldest capture samples. */
#define FRAME_QUEUE_DEPTH    256
#define BATCH_MAX_FRAMES       8 /* retry buffer size; never exceeded */
#define BATCH_CAPTURE_FRAMES   4 /* ≥224 Hz: 224 / 4 = 56 notifies/s per pod */
#define BATCH_LOG_FRAMES       2 /* 112 Hz: 112 / 2 = 56 notifies/s per pod */
#define CONN_ITVL_MIN_CREW    12 /* 15 ms: do not demand 7.5 ms */
#define CONN_ITVL_MAX_CREW    24 /* 30 ms: four pods can share one tablet radio */
#define CONN_UPDATE_MAX_TRIES  3

static struct ble_npl_event s_notify_ev;
static sensor_proto_sample_t s_frame_queue[FRAME_QUEUE_DEPTH];
static sensor_proto_sample_t s_retry_batch[BATCH_MAX_FRAMES];
static portMUX_TYPE s_frame_mux = portMUX_INITIALIZER_UNLOCKED;
static uint16_t s_frame_head;
static uint16_t s_frame_tail;
static uint16_t s_frame_count;
static uint16_t s_att_mtu = BLE_ATT_MTU_DFLT;
static uint8_t s_retry_count;
/* Frames per notify the host proved it receives (0 = no cap). Written by the
 * session-command handler, read by the sensor task: one byte, no lock. */
static volatile uint8_t s_host_max_batch;
static bool s_notify_inflight;
static uint8_t s_conn_update_tries;
static uint32_t s_transport_dropped;
static uint32_t s_notify_failures;

static esp_err_t start_advertise(void);
static int gap_event(struct ble_gap_event *event, void *arg);
static esp_err_t init_stack(void);
static void host_task(void *param);
static esp_err_t set_stream_rate(uint16_t rate_hz);
static void notify_session_status(void);
static void frame_queue_reset(void);
static void maybe_complete_drain(void);
static int handle_session_command(uint8_t command, uint32_t capture_id,
                                  uint8_t rate_hz, uint8_t flags,
                                  uint16_t command_id);
static void request_fast_conn_params(void);
static uint8_t current_batch_limit(void);
static bool session_capture_active(void);
static bool notify_ready(void);

static void request_fast_conn_params(void)
{
    /* A speed coach that only subscribed the per-stroke summary wants a slow
     * interval. Pushing 7.5 ms here would undo that and drain the pod. */
    if (!s_motion_subscribed && !s_motion_v16_subscribed && !s_motion_fused_subscribed) {
        return;
    }
    if (s_conn_handle == BLE_HS_CONN_HANDLE_NONE) {
        return;
    }
    if (s_conn_update_tries >= CONN_UPDATE_MAX_TRIES) {
        return;
    }
    const struct ble_gap_upd_params fast = {
        .itvl_min = CONN_ITVL_MIN_CREW,
        .itvl_max = CONN_ITVL_MAX_CREW,
        .latency = 0,
        .supervision_timeout = 400,
        .min_ce_len = 6,
        .max_ce_len = 24, /* longer CE so 2-frame notifies drain */
    };
    int rc = ble_gap_update_params(s_conn_handle, &fast);
    if (rc == 0 || rc == BLE_HS_EALREADY) {
        s_conn_update_tries++;
        ESP_LOGI(TAG, "requested 15-30 ms interval try=%u",
                 (unsigned)s_conn_update_tries);
    } else {
        ESP_LOGW(TAG, "connection interval request rc=%d", rc);
    }
}

static bool motion_any_subscribed(void)
{
    return s_motion_subscribed || s_motion_v16_subscribed ||
           s_motion_fused_subscribed;
}

static uint8_t current_batch_limit(void)
{
    /* Live is one frame per notify: lowest RowPod latency, and a 20-byte v1
     * frame fits any link. Capture packs frames so each pod stays near the
     * 56 notifies/s that four Windows links carried without loss. */
    if (!session_capture_active()) {
        /* Two live frames when the MTU can carry them, so a 30 ms interval
         * still delivers 56 Hz. batch_target() keeps a 23-byte link at 1. */
        return 2;
    }
    uint16_t rate = sensor_stream_get_rate_hz();
    uint8_t limit = rate >= SENSOR_PROTO_RATE_HIGH_HZ ? BATCH_CAPTURE_FRAMES
                    : rate >= SENSOR_PROTO_RATE_LOG_HZ ? BATCH_LOG_FRAMES
                                                       : 1;
    uint8_t host = s_host_max_batch;
    if (host != 0 && host < limit) {
        limit = host;
    }
    return limit;
}

static uint8_t active_frame_len(void)
{
    if (s_motion_fused_subscribed) {
        return SENSOR_PROTO_FRAME_FUSED_LEN;
    }
    return s_motion_v16_subscribed ? SENSOR_PROTO_FRAME_V16_LEN
                                   : SENSOR_PROTO_FRAME_LEN;
}

/** Frames that make one full notify: batch limit, capped by ATT payload. */
static uint8_t batch_target(void)
{
    uint16_t payload = s_att_mtu > 3 ? (uint16_t)(s_att_mtu - 3) : 0;
    uint16_t fit = payload / active_frame_len();
    uint8_t limit = current_batch_limit();
    if (fit == 0) {
        return 1;
    }
    return fit < limit ? (uint8_t)fit : limit;
}

static void deinit_stack_after_init_failure(void)
{
    esp_err_t ret = nimble_port_deinit();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "cleanup NimBLE: %s", esp_err_to_name(ret));
    }
}

static void set_ui_state(ui_state_t state)
{
    esp_err_t ret = ui_set_state(state);
    if (ret != ESP_OK) {
        ESP_LOGW(TAG, "UI state %d failed: %s", state, esp_err_to_name(ret));
    }
}

static void apply_stream_state(void)
{
    bool motion = motion_any_subscribed();
    bool coach = s_summary_subscribed && s_stream_requested;
    s_notify_enabled = motion && s_stream_requested;
    sensor_stream_set_fusion_enabled(s_motion_fused_subscribed);
    sensor_stream_set_enabled(s_notify_enabled || coach);
    if (s_conn_handle != BLE_HS_CONN_HANDLE_NONE) {
        set_ui_state(s_notify_enabled ? UI_STATE_STREAMING
                                      : UI_STATE_CONNECTED);
    }
}

static void load_adv_name(void)
{
    if (device_config_get_adv_name(s_adv_name, sizeof(s_adv_name)) != ESP_OK) {
        snprintf(s_adv_name, sizeof(s_adv_name), "C3-Tracker");
    }
}

static uint16_t queued_frame_count(void)
{
    uint16_t count;
    taskENTER_CRITICAL(&s_frame_mux);
    count = (uint16_t)(s_frame_count + s_retry_count);
    taskEXIT_CRITICAL(&s_frame_mux);
    return count;
}

static bool session_capture_active(void)
{
    return s_session_state == SENSOR_PROTO_STATE_PREPARED ||
           s_session_state == SENSOR_PROTO_STATE_RECORDING ||
           s_session_state == SENSOR_PROTO_STATE_STOP_REQUESTED ||
           s_session_state == SENSOR_PROTO_STATE_DRAINING;
}

static bool session_accepts_samples(void)
{
    return s_session_state == SENSOR_PROTO_STATE_RECORDING ||
           s_session_state == SENSOR_PROTO_STATE_STOP_REQUESTED;
}

static void note_rate_epoch_if_applied(void)
{
    uint16_t applied = sensor_stream_get_applied_rate_hz();
    if (sensor_stream_is_rate_applied() && applied != s_epoch_rate_hz) {
        s_rate_epoch++;
        s_epoch_rate_hz = applied;
    }
}

static esp_err_t set_stream_rate(uint16_t rate_hz)
{
    return sensor_stream_set_rate_hz(rate_hz);
}

static void refresh_att_mtu(void)
{
    if (s_conn_handle == BLE_HS_CONN_HANDLE_NONE) {
        return;
    }
    uint16_t cur = ble_att_mtu(s_conn_handle);
    if (cur >= BLE_ATT_MTU_DFLT && cur != s_att_mtu) {
        s_att_mtu = cur;
        ESP_LOGI(TAG, "ATT MTU refresh mtu=%u", (unsigned)cur);
    }
}

static int on_mtu_exchanged(uint16_t conn_handle,
                            const struct ble_gatt_error *error, uint16_t mtu,
                            void *arg)
{
    (void)arg;
    if (error == NULL || error->status != 0) {
        uint16_t cur = ble_att_mtu(conn_handle);
        ESP_LOGW(TAG, "ATT MTU exchange status=%d cur=%u",
                 error ? error->status : -1, (unsigned)cur);
        if (cur >= BLE_ATT_MTU_DFLT) {
            s_att_mtu = cur;
            notify_session_status();
        }
        return 0;
    }
    s_att_mtu = mtu;
    ESP_LOGI(TAG, "ATT MTU exchange ok conn=%u mtu=%u", (unsigned)conn_handle,
             (unsigned)mtu);
    notify_session_status();
    return 0;
}

static void fill_caps(sensor_proto_caps_t *caps)
{
    refresh_att_mtu();
    memset(caps, 0, sizeof(*caps));
    caps->ver = SENSOR_PROTO_FORMAT_VER_V16;
    caps->feature_flags =
        SENSOR_PROTO_CAP_FLAG_V1_FRAME | SENSOR_PROTO_CAP_FLAG_V16_FRAME |
        SENSOR_PROTO_CAP_FLAG_DRAIN_BARRIER | SENSOR_PROTO_CAP_FLAG_APPLIED_RATE |
        SENSOR_PROTO_CAP_FLAG_32BIT_SEQ | SENSOR_PROTO_CAP_FLAG_FUSED_FRAME |
        SENSOR_PROTO_CAP_FLAG_COACH_SUMMARY;
    caps->rate_mask = SENSOR_PROTO_RATE_MASK_56 | SENSOR_PROTO_RATE_MASK_112 |
                      SENSOR_PROTO_RATE_MASK_224 | SENSOR_PROTO_RATE_MASK_448;
    caps->max_batch_frames = BATCH_MAX_FRAMES;
    caps->max_rate_hz = sensor_proto_rate_to_wire(SENSOR_PROTO_RATE_LOG_MAX_HZ);
    caps->imu_rate_hz =
        sensor_proto_rate_to_wire(sensor_stream_get_applied_rate_hz());
    caps->mag_rate_hz = sensor_stream_get_mag_rate_hz();
    caps->hw_rev = SENSOR_PROTO_HW_REV_V2;
    caps->att_mtu = s_att_mtu;
    caps->queue_depth_max = FRAME_QUEUE_DEPTH;
    caps->firmware_proto = SENSOR_PROTO_FORMAT_VER_FUSED;
}

static void fill_session_status_v1(sensor_proto_session_status_t *status)
{
    refresh_att_mtu();
    note_rate_epoch_if_applied();
    memset(status, 0, sizeof(*status));
    status->ver = SENSOR_PROTO_FORMAT_VER;
    status->state = s_session_state;
    status->rate_hz =
        sensor_proto_rate_to_wire(sensor_stream_get_applied_rate_hz());
    status->capture_id = s_capture_id;
    status->rate_epoch = s_rate_epoch;
    status->first_seq =
        s_session_first_valid ? (uint16_t)(s_session_first_sample & 0xffffu) : 0;
    status->last_seq = (uint16_t)(s_last_produced & 0xffffu);
    status->queue_depth = queued_frame_count();
    status->sensor_dropped =
        sensor_stream_dropped_count() - s_session_sensor_base;
    status->transport_dropped = s_transport_dropped - s_session_transport_base;
    status->notify_failures = s_notify_failures - s_session_notify_base;
    status->uptime_ms = (uint32_t)((uint64_t)esp_timer_get_time() / 1000ULL);
    if (s_session_first_valid) {
        status->flags |= SENSOR_PROTO_SESSION_FLAG_HAS_SAMPLES;
    }
    if (s_drain_complete) {
        status->flags |= SENSOR_PROTO_SESSION_FLAG_DRAIN_DONE;
    }
    if (sensor_stream_is_rate_applied()) {
        status->flags |= SENSOR_PROTO_SESSION_FLAG_RATE_APPLIED;
    }
    if (s_conn_handle != BLE_HS_CONN_HANDLE_NONE) {
        status->flags |= SENSOR_PROTO_SESSION_FLAG_CONNECTED;
    }
    if (motion_any_subscribed()) {
        status->flags |= SENSOR_PROTO_SESSION_FLAG_SUBSCRIBED;
    }
    if (s_notify_enabled) {
        status->flags |= SENSOR_PROTO_SESSION_FLAG_STREAMING;
    }

    uint16_t battery_mv = 0;
    uint8_t battery_pct = 0;
    if (battery_read(&battery_mv, &battery_pct) == ESP_OK) {
        status->flags |= SENSOR_PROTO_SESSION_FLAG_BATT_VALID;
        status->battery_mv = battery_mv;
        status->battery_pct = battery_pct;
    }
}

static void fill_session_status_v16(sensor_proto_session_status_v16_t *status)
{
    refresh_att_mtu();
    note_rate_epoch_if_applied();
    memset(status, 0, sizeof(*status));
    status->ver = SENSOR_PROTO_FORMAT_VER_V16;
    status->state = s_session_state;
    status->requested_rate_hz =
        sensor_proto_rate_to_wire(sensor_stream_get_rate_hz());
    status->applied_rate_hz =
        sensor_proto_rate_to_wire(sensor_stream_get_applied_rate_hz());
    status->error_reason = s_last_error_reason;
    status->last_command_id = s_last_command_id;
    status->capture_id = s_capture_id;
    status->rate_epoch = s_rate_epoch;
    status->att_mtu = s_att_mtu;
    status->first_sample = s_session_first_valid ? s_session_first_sample : 0;
    status->last_produced = s_last_produced;
    status->last_sent = s_last_sent;
    status->final_sample = s_drain_complete ? s_final_sample : 0;
    status->queue_depth = queued_frame_count();
    status->queue_high_water = s_queue_high_water;
    status->sensor_dropped =
        sensor_stream_dropped_count() - s_session_sensor_base;
    status->transport_dropped = s_transport_dropped - s_session_transport_base;
    status->notify_failures = s_notify_failures - s_session_notify_base;
    status->uptime_ms = (uint32_t)((uint64_t)esp_timer_get_time() / 1000ULL);
    status->mag_rate_hz = sensor_stream_get_mag_rate_hz();

    if (s_session_first_valid) {
        status->flags |= SENSOR_PROTO_SESSION_FLAG_HAS_SAMPLES;
    }
    if (s_drain_complete) {
        status->flags |= SENSOR_PROTO_SESSION_FLAG_DRAIN_DONE;
    }
    if (sensor_stream_is_rate_applied()) {
        status->flags |= SENSOR_PROTO_SESSION_FLAG_RATE_APPLIED;
    }
    if (s_conn_handle != BLE_HS_CONN_HANDLE_NONE) {
        status->flags |= SENSOR_PROTO_SESSION_FLAG_CONNECTED;
    }
    if (motion_any_subscribed()) {
        status->flags |= SENSOR_PROTO_SESSION_FLAG_SUBSCRIBED;
    }
    if (s_notify_enabled) {
        status->flags |= SENSOR_PROTO_SESSION_FLAG_STREAMING;
    }

    uint16_t battery_mv = 0;
    uint8_t battery_pct = 0;
    if (battery_read(&battery_mv, &battery_pct) == ESP_OK) {
        status->flags |= SENSOR_PROTO_SESSION_FLAG_BATT_VALID;
        status->battery_mv = battery_mv;
        status->battery_pct = battery_pct;
    }
}

static void notify_session_status(void)
{
    if (s_conn_handle == BLE_HS_CONN_HANDLE_NONE) {
        return;
    }

    if (s_status_v16_val_handle != 0 &&
        s_att_mtu >= SENSOR_PROTO_CFG_STATUS_V16_LEN + 3) {
        sensor_proto_session_status_v16_t status = {0};
        uint8_t wire[SENSOR_PROTO_CFG_STATUS_V16_LEN] = {0};
        fill_session_status_v16(&status);
        sensor_proto_pack_session_status_v16(wire, &status);
        struct os_mbuf *om = ble_hs_mbuf_from_flat(wire, sizeof(wire));
        if (om) {
            int rc =
                ble_gatts_notify_custom(s_conn_handle, s_status_v16_val_handle, om);
            if (rc != 0) {
                ESP_LOGW(TAG, "status v16 notify rc=%d", rc);
            }
        }
    }

    /* ATT notifications are not fragmented; long status is still available
     * through the characteristic read path on a default 23-byte MTU. */
    if (s_status_val_handle == 0 ||
        s_att_mtu < SENSOR_PROTO_CFG_STATUS_LEN + 3) {
        return;
    }
    sensor_proto_session_status_t status = {0};
    uint8_t wire[SENSOR_PROTO_CFG_STATUS_LEN] = {0};
    fill_session_status_v1(&status);
    sensor_proto_pack_session_status(wire, &status);
    struct os_mbuf *om = ble_hs_mbuf_from_flat(wire, sizeof(wire));
    if (!om) {
        ESP_LOGW(TAG, "status notify allocation failed");
        return;
    }
    int rc = ble_gatts_notify_custom(s_conn_handle, s_status_val_handle, om);
    if (rc != 0) {
        ESP_LOGW(TAG, "status notify rc=%d", rc);
    }
}

static int motion_access(uint16_t conn_handle, uint16_t attr_handle,
                         struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    (void)conn_handle;
    (void)arg;
    if (ctxt->op != BLE_GATT_ACCESS_OP_READ_CHR) {
        return BLE_ATT_ERR_UNLIKELY;
    }
    if (attr_handle == s_meta_val_handle) {
        sensor_proto_meta_t meta = {0};
        if (sensor_stream_get_meta(&meta) != ESP_OK) {
            return BLE_ATT_ERR_UNLIKELY;
        }
        uint8_t buf[SENSOR_PROTO_META_LEN];
        sensor_proto_pack_meta(buf, &meta);
        return os_mbuf_append(ctxt->om, buf, sizeof(buf)) == 0
                   ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    if (attr_handle == s_data_val_handle) {
        sensor_proto_frame_t frame = {0};
        if (sensor_stream_get_latest_frame_v1(&frame) != ESP_OK) {
            return BLE_ATT_ERR_UNLIKELY;
        }
        uint8_t buf[SENSOR_PROTO_FRAME_LEN];
        sensor_proto_pack_frame(buf, &frame);
        return os_mbuf_append(ctxt->om, buf, sizeof(buf)) == 0
                   ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    if (attr_handle == s_data_v16_val_handle) {
        sensor_proto_sample_t sample = {0};
        if (sensor_stream_get_latest(&sample) != ESP_OK) {
            return BLE_ATT_ERR_UNLIKELY;
        }
        sensor_proto_frame_v16_t frame = {0};
        sensor_proto_sample_to_frame_v16(&frame, &sample);
        uint8_t buf[SENSOR_PROTO_FRAME_V16_LEN];
        sensor_proto_pack_frame_v16(buf, &frame);
        return os_mbuf_append(ctxt->om, buf, sizeof(buf)) == 0
                   ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    if (attr_handle == s_data_fused_val_handle) {
        sensor_proto_frame_fused_t frame = {0};
        if (sensor_stream_get_latest_frame_fused(&frame) != ESP_OK) {
            return BLE_ATT_ERR_UNLIKELY;
        }
        uint8_t buf[SENSOR_PROTO_FRAME_FUSED_LEN];
        sensor_proto_pack_frame_fused(buf, &frame);
        return os_mbuf_append(ctxt->om, buf, sizeof(buf)) == 0
                   ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    if (attr_handle == s_summary_val_handle) {
        return os_mbuf_append(ctxt->om, s_summary, sizeof(s_summary)) == 0
                   ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    return BLE_ATT_ERR_UNLIKELY;
}

static int handle_session_command(uint8_t command, uint32_t capture_id,
                                  uint8_t rate_hz, uint8_t flags,
                                  uint16_t command_id)
{
    uint16_t logical_rate = sensor_proto_rate_from_wire(rate_hz);
    s_last_command_id = command_id;
    s_last_error_reason = SENSOR_PROTO_ERR_NONE;

    if (command == SENSOR_PROTO_SESSION_PREPARE) {
        if (session_capture_active()) {
            s_last_error_reason = SENSOR_PROTO_ERR_BUSY;
            return BLE_ATT_ERR_WRITE_NOT_PERMITTED;
        }
        if (capture_id == 0) {
            s_last_error_reason = SENSOR_PROTO_ERR_BAD_CAPTURE_ID;
            return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
        }
        if (rate_hz != 0 && set_stream_rate(logical_rate) != ESP_OK) {
            s_last_error_reason = SENSOR_PROTO_ERR_BAD_RATE;
            return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
        }
        s_capture_id = capture_id;
        s_host_max_batch = flags & SENSOR_PROTO_SESSION_CMD_BATCH_MASK;
        s_session_state = SENSOR_PROTO_STATE_PREPARED;
        s_session_first_valid = false;
        s_session_first_sample = 0;
        s_last_produced = 0;
        s_last_sent = 0;
        s_final_sample = 0;
        s_drain_complete = false;
        s_accept_transport = true;
        s_queue_high_water = 0;
        s_session_sensor_base = sensor_stream_dropped_count();
        s_session_transport_base = s_transport_dropped;
        s_session_notify_base = s_notify_failures;
        frame_queue_reset();
        s_conn_update_tries = 0;
        request_fast_conn_params();
    } else if (command == SENSOR_PROTO_SESSION_START) {
        if (s_session_state != SENSOR_PROTO_STATE_PREPARED ||
            capture_id != s_capture_id ||
            (rate_hz != 0 && logical_rate != sensor_stream_get_rate_hz())) {
            s_last_error_reason = SENSOR_PROTO_ERR_BAD_STATE;
            return BLE_ATT_ERR_WRITE_NOT_PERMITTED;
        }
        s_session_state = SENSOR_PROTO_STATE_RECORDING;
        s_session_first_valid = false;
        s_accept_transport = true;
        s_drain_complete = false;
    } else if (command == SENSOR_PROTO_SESSION_STOP) {
        if (s_session_state != SENSOR_PROTO_STATE_RECORDING ||
            capture_id != s_capture_id) {
            s_last_error_reason = SENSOR_PROTO_ERR_BAD_STATE;
            return BLE_ATT_ERR_WRITE_NOT_PERMITTED;
        }
        s_session_state = SENSOR_PROTO_STATE_STOP_REQUESTED;
    } else if (command == SENSOR_PROTO_SESSION_DRAIN) {
        if (s_session_state != SENSOR_PROTO_STATE_STOP_REQUESTED ||
            capture_id != s_capture_id) {
            s_last_error_reason = SENSOR_PROTO_ERR_BAD_STATE;
            return BLE_ATT_ERR_WRITE_NOT_PERMITTED;
        }
        s_session_state = SENSOR_PROTO_STATE_DRAINING;
        /* Freeze the transport boundary: no new capture frames after this. */
        s_accept_transport = false;
        s_drain_complete = false;
        /* A partial batch (< batch_target) is waiting; draining flushes it. */
        ble_npl_eventq_put(nimble_port_get_dflt_eventq(), &s_notify_ev);
        maybe_complete_drain();
    } else if (command == SENSOR_PROTO_SESSION_FINALIZE) {
        if (s_session_state != SENSOR_PROTO_STATE_DRAINING ||
            capture_id != s_capture_id) {
            s_last_error_reason = SENSOR_PROTO_ERR_BAD_STATE;
            return BLE_ATT_ERR_WRITE_NOT_PERMITTED;
        }
        maybe_complete_drain();
        if (!s_drain_complete) {
            s_last_error_reason = SENSOR_PROTO_ERR_DRAIN_INCOMPLETE;
            return BLE_ATT_ERR_WRITE_NOT_PERMITTED;
        }
        s_session_state = SENSOR_PROTO_STATE_FINALIZED;
    } else if (command == SENSOR_PROTO_SESSION_ABORT) {
        s_session_state = SENSOR_PROTO_STATE_IDLE;
        s_capture_id = 0;
        s_session_first_valid = false;
        s_accept_transport = true;
        s_drain_complete = false;
        s_final_sample = 0;
    } else {
        s_last_error_reason = SENSOR_PROTO_ERR_BAD_VERSION;
        return BLE_ATT_ERR_UNLIKELY;
    }

    ESP_LOGI(TAG, "session command=%u capture=%" PRIu32 " state=%u cmd_id=%u",
             command, s_capture_id, s_session_state, command_id);
    notify_session_status();
    return 0;
}

static int cfg_access(uint16_t conn_handle, uint16_t attr_handle,
                      struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    (void)conn_handle;
    (void)arg;

    if (attr_handle == s_coach_val_handle) {
        if (ctxt->op != BLE_GATT_ACCESS_OP_WRITE_CHR) {
            return BLE_ATT_ERR_UNLIKELY;
        }
        uint8_t buf[2] = {0};
        uint16_t n = OS_MBUF_PKTLEN(ctxt->om);
        if (n < 1 || n > sizeof(buf)) {
            return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
        }
        if (ble_hs_mbuf_to_flat(ctxt->om, buf, n, NULL) != 0) {
            return BLE_ATT_ERR_UNLIKELY;
        }
        rowing_calib_t cal;
        if (buf[0] == SENSOR_PROTO_COACH_ZERO) {
            rowing_metrics_zero();
        } else if (buf[0] == SENSOR_PROTO_COACH_SET_SIGN && n >= 2) {
            rowing_metrics_set_sign(buf[1] == SENSOR_PROTO_COACH_SIDE_BOW ? -1 : 1);
        } else if (buf[0] == SENSOR_PROTO_COACH_CLEAR) {
            rowing_metrics_clear();
        } else {
            return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
        }
        rowing_metrics_get_calib(&cal);
        (void)device_config_set_oar(cal.sign, cal.zeroed, cal.shaft_axis, cal.feather_ddeg);
        return 0;
    }

    if (attr_handle == s_info_val_handle) {
        if (ctxt->op != BLE_GATT_ACCESS_OP_READ_CHR) {
            return BLE_ATT_ERR_UNLIKELY;
        }
        uint8_t buf[SENSOR_PROTO_CFG_INFO_LEN] = {
            (uint8_t)device_config_get_mode(),
            (uint8_t)(device_config_get_pod_id() & 0xff),
            (uint8_t)(device_config_get_pod_id() >> 8),
            device_config_has_custom_name() ? 0x01 : 0x00,
        };
        return os_mbuf_append(ctxt->om, buf, sizeof(buf)) == 0
                   ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
    }

    if (attr_handle == s_caps_val_handle) {
        if (ctxt->op != BLE_GATT_ACCESS_OP_READ_CHR) {
            return BLE_ATT_ERR_UNLIKELY;
        }
        sensor_proto_caps_t caps = {0};
        uint8_t wire[SENSOR_PROTO_CFG_CAPS_LEN] = {0};
        fill_caps(&caps);
        sensor_proto_pack_caps(wire, &caps);
        return os_mbuf_append(ctxt->om, wire, sizeof(wire)) == 0
                   ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
    }

    if (attr_handle == s_name_val_handle) {
        if (ctxt->op == BLE_GATT_ACCESS_OP_READ_CHR) {
            char name[DEVICE_CONFIG_NAME_MAX + 1] = {0};
            if (device_config_get_adv_name(name, sizeof(name)) != ESP_OK) {
                return BLE_ATT_ERR_UNLIKELY;
            }
            return os_mbuf_append(ctxt->om, name, strlen(name)) == 0
                       ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
        }
        if (ctxt->op == BLE_GATT_ACCESS_OP_WRITE_CHR) {
            uint16_t len = OS_MBUF_PKTLEN(ctxt->om);
            if (len > DEVICE_CONFIG_NAME_MAX) {
                return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
            }
            char name[DEVICE_CONFIG_NAME_MAX + 1] = {0};
            if (len > 0 &&
                ble_hs_mbuf_to_flat(ctxt->om, name, len, NULL) != 0) {
                return BLE_ATT_ERR_UNLIKELY;
            }
            name[len] = '\0';
            if (device_config_set_name(name) != ESP_OK) {
                return BLE_ATT_ERR_UNLIKELY;
            }
            load_adv_name();
            return 0;
        }
        return BLE_ATT_ERR_UNLIKELY;
    }

    if (attr_handle == s_batt_val_handle) {
        if (ctxt->op != BLE_GATT_ACCESS_OP_READ_CHR) {
            return BLE_ATT_ERR_UNLIKELY;
        }
        uint16_t mv = 0;
        uint8_t pct = 0;
        uint8_t flags = 0;
        if (battery_read(&mv, &pct) == ESP_OK) {
            flags = SENSOR_PROTO_BATT_FLAG_VALID;
        }
        uint8_t buf[SENSOR_PROTO_CFG_BATT_LEN] = {
            (uint8_t)(mv & 0xff),
            (uint8_t)(mv >> 8),
            pct,
            flags,
        };
        return os_mbuf_append(ctxt->om, buf, sizeof(buf)) == 0
                   ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
    }

    if (attr_handle == s_rate_val_handle) {
        if (ctxt->op == BLE_GATT_ACCESS_OP_READ_CHR) {
            uint8_t hz =
                sensor_proto_rate_to_wire(sensor_stream_get_applied_rate_hz());
            return os_mbuf_append(ctxt->om, &hz, 1) == 0
                       ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
        }
        if (ctxt->op == BLE_GATT_ACCESS_OP_WRITE_CHR) {
            if (OS_MBUF_PKTLEN(ctxt->om) < SENSOR_PROTO_CFG_RATE_LEN) {
                return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
            }
            uint8_t hz = 0;
            if (ble_hs_mbuf_to_flat(ctxt->om, &hz, 1, NULL) != 0) {
                return BLE_ATT_ERR_UNLIKELY;
            }
            uint16_t logical = sensor_proto_rate_from_wire(hz);
            if (session_capture_active() &&
                logical != sensor_stream_get_rate_hz()) {
                return BLE_ATT_ERR_WRITE_NOT_PERMITTED;
            }
            if (set_stream_rate(logical) != ESP_OK) {
                return BLE_ATT_ERR_UNLIKELY;
            }
            notify_session_status();
            return 0;
        }
        return BLE_ATT_ERR_UNLIKELY;
    }

    if (attr_handle == s_profile_val_handle) {
        if (ctxt->op == BLE_GATT_ACCESS_OP_READ_CHR) {
            uint8_t profile = s_workout_profile;
            return os_mbuf_append(ctxt->om, &profile,
                                  SENSOR_PROTO_CFG_PROFILE_LEN) == 0
                       ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
        }
        if (ctxt->op == BLE_GATT_ACCESS_OP_WRITE_CHR) {
            if (OS_MBUF_PKTLEN(ctxt->om) < SENSOR_PROTO_CFG_PROFILE_LEN) {
                return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
            }
            uint8_t profile = 0;
            if (ble_hs_mbuf_to_flat(ctxt->om, &profile, 1, NULL) != 0 ||
                profile > SENSOR_PROTO_PROFILE_ROWING) {
                return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
            }
            if (session_capture_active()) {
                return BLE_ATT_ERR_WRITE_NOT_PERMITTED;
            }
            s_workout_profile = profile;
            esp_err_t err = set_stream_rate(
                profile == SENSOR_PROTO_PROFILE_HYROX
                    ? SENSOR_PROTO_RATE_LOG_MAX_HZ
                    : SENSOR_PROTO_RATE_LIVE_HZ);
            if (err != ESP_OK) {
                ESP_LOGW(TAG, "workout profile rate failed: %s",
                         esp_err_to_name(err));
                return BLE_ATT_ERR_UNLIKELY;
            }
            ESP_LOGI(TAG, "workout profile=%u", profile);
            notify_session_status();
            return 0;
        }
        return BLE_ATT_ERR_UNLIKELY;
    }

    if (attr_handle == s_session_val_handle) {
        if (ctxt->op != BLE_GATT_ACCESS_OP_WRITE_CHR ||
            OS_MBUF_PKTLEN(ctxt->om) != SENSOR_PROTO_CFG_SESSION_LEN) {
            return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
        }
        uint8_t wire[SENSOR_PROTO_CFG_SESSION_LEN] = {0};
        sensor_proto_session_cmd_t cmd = {0};
        if (ble_hs_mbuf_to_flat(ctxt->om, wire, sizeof(wire), NULL) != 0) {
            return BLE_ATT_ERR_UNLIKELY;
        }
        sensor_proto_unpack_session_cmd(&cmd, wire);
        if (cmd.ver != SENSOR_PROTO_FORMAT_VER) {
            s_last_error_reason = SENSOR_PROTO_ERR_BAD_VERSION;
            return BLE_ATT_ERR_UNLIKELY;
        }
        return handle_session_command(cmd.command, cmd.capture_id, cmd.rate_hz,
                                      cmd.flags, 0);
    }

    if (attr_handle == s_session_v16_val_handle) {
        if (ctxt->op != BLE_GATT_ACCESS_OP_WRITE_CHR ||
            OS_MBUF_PKTLEN(ctxt->om) != SENSOR_PROTO_CFG_SESSION_V16_LEN) {
            return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
        }
        uint8_t wire[SENSOR_PROTO_CFG_SESSION_V16_LEN] = {0};
        sensor_proto_session_cmd_v16_t cmd = {0};
        if (ble_hs_mbuf_to_flat(ctxt->om, wire, sizeof(wire), NULL) != 0) {
            return BLE_ATT_ERR_UNLIKELY;
        }
        sensor_proto_unpack_session_cmd_v16(&cmd, wire);
        if (cmd.ver != SENSOR_PROTO_FORMAT_VER_V16) {
            s_last_error_reason = SENSOR_PROTO_ERR_BAD_VERSION;
            return BLE_ATT_ERR_UNLIKELY;
        }
        return handle_session_command(cmd.command, cmd.capture_id, cmd.rate_hz,
                                      cmd.flags, cmd.command_id);
    }

    if (attr_handle == s_status_val_handle) {
        if (ctxt->op != BLE_GATT_ACCESS_OP_READ_CHR) {
            return BLE_ATT_ERR_UNLIKELY;
        }
        sensor_proto_session_status_t status = {0};
        uint8_t wire[SENSOR_PROTO_CFG_STATUS_LEN] = {0};
        fill_session_status_v1(&status);
        sensor_proto_pack_session_status(wire, &status);
        return os_mbuf_append(ctxt->om, wire, sizeof(wire)) == 0
                   ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
    }

    if (attr_handle == s_status_v16_val_handle) {
        if (ctxt->op != BLE_GATT_ACCESS_OP_READ_CHR) {
            return BLE_ATT_ERR_UNLIKELY;
        }
        sensor_proto_session_status_v16_t status = {0};
        uint8_t wire[SENSOR_PROTO_CFG_STATUS_V16_LEN] = {0};
        fill_session_status_v16(&status);
        sensor_proto_pack_session_status_v16(wire, &status);
        return os_mbuf_append(ctxt->om, wire, sizeof(wire)) == 0
                   ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
    }

    if (attr_handle == s_sync_val_handle) {
        if (ctxt->op == BLE_GATT_ACCESS_OP_WRITE_CHR) {
            if (OS_MBUF_PKTLEN(ctxt->om) < SENSOR_PROTO_CFG_SYNC_REQ_LEN) {
                return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
            }
            uint8_t req[SENSOR_PROTO_CFG_SYNC_REQ_LEN] = {0};
            if (ble_hs_mbuf_to_flat(ctxt->om, req, sizeof(req), NULL) != 0) {
                return BLE_ATT_ERR_UNLIKELY;
            }
            uint64_t client_ms = 0;
            memcpy(&client_ms, req, sizeof(client_ms));
            uint64_t device_us = (uint64_t)esp_timer_get_time();
            uint32_t sample_index = sensor_stream_sample_index();
            sensor_proto_sample_t sample = {0};
            if (sensor_stream_get_latest(&sample) == ESP_OK) {
                sample_index = sample.sample_index;
            }
            memset(s_sync_rsp, 0, sizeof(s_sync_rsp));
            memcpy(&s_sync_rsp[0], &client_ms, sizeof(client_ms));
            memcpy(&s_sync_rsp[8], &device_us, sizeof(device_us));
            memcpy(&s_sync_rsp[16], &sample_index, sizeof(sample_index));
            s_sync_rsp_valid = true;

            struct os_mbuf *om =
                ble_hs_mbuf_from_flat(s_sync_rsp, sizeof(s_sync_rsp));
            if (om && s_conn_handle != BLE_HS_CONN_HANDLE_NONE) {
                int rc = ble_gatts_notify_custom(s_conn_handle,
                                                s_sync_val_handle, om);
                if (rc != 0) {
                    ESP_LOGW(TAG, "sync notify rc=%d", rc);
                }
            } else if (om) {
                os_mbuf_free_chain(om);
            }
            return 0;
        }
        if (ctxt->op == BLE_GATT_ACCESS_OP_READ_CHR) {
            if (!s_sync_rsp_valid) {
                return BLE_ATT_ERR_UNLIKELY;
            }
            return os_mbuf_append(ctxt->om, s_sync_rsp, sizeof(s_sync_rsp)) == 0
                       ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
        }
        return BLE_ATT_ERR_UNLIKELY;
    }

    return BLE_ATT_ERR_UNLIKELY;
}

static const struct ble_gatt_svc_def gatt_svcs[] = {
    {
        .type = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid = &uuid_motion_svc.u,
        .characteristics = (struct ble_gatt_chr_def[]) {
            {
                .uuid = &uuid_motion_data.u,
                .access_cb = motion_access,
                .flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_NOTIFY,
                .val_handle = &s_data_val_handle,
            },
            {
                .uuid = &uuid_motion_meta.u,
                .access_cb = motion_access,
                .flags = BLE_GATT_CHR_F_READ,
                .val_handle = &s_meta_val_handle,
            },
            {
                .uuid = &uuid_motion_data_v16.u,
                .access_cb = motion_access,
                .flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_NOTIFY,
                .val_handle = &s_data_v16_val_handle,
            },
            {
                .uuid = &uuid_motion_data_fused.u,
                .access_cb = motion_access,
                .flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_NOTIFY,
                .val_handle = &s_data_fused_val_handle,
            },
            {
                .uuid = &uuid_motion_summary.u,
                .access_cb = motion_access,
                .flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_NOTIFY,
                .val_handle = &s_summary_val_handle,
            },
            { 0 },
        },
    },
    {
        .type = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid = &uuid_cfg_svc.u,
        .characteristics = (struct ble_gatt_chr_def[]) {
            {
                .uuid = &uuid_cfg_info.u,
                .access_cb = cfg_access,
                .flags = BLE_GATT_CHR_F_READ,
                .val_handle = &s_info_val_handle,
            },
            {
                .uuid = &uuid_cfg_name.u,
                .access_cb = cfg_access,
                .flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_WRITE |
                         BLE_GATT_CHR_F_WRITE_NO_RSP,
                .val_handle = &s_name_val_handle,
            },
            {
                .uuid = &uuid_cfg_sync.u,
                .access_cb = cfg_access,
                .flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_WRITE |
                         BLE_GATT_CHR_F_WRITE_NO_RSP | BLE_GATT_CHR_F_NOTIFY,
                .val_handle = &s_sync_val_handle,
            },
            {
                .uuid = &uuid_cfg_batt.u,
                .access_cb = cfg_access,
                .flags = BLE_GATT_CHR_F_READ,
                .val_handle = &s_batt_val_handle,
            },
            {
                .uuid = &uuid_cfg_rate.u,
                .access_cb = cfg_access,
                .flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_WRITE |
                         BLE_GATT_CHR_F_WRITE_NO_RSP,
                .val_handle = &s_rate_val_handle,
            },
            {
                .uuid = &uuid_cfg_profile.u,
                .access_cb = cfg_access,
                .flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_WRITE |
                         BLE_GATT_CHR_F_WRITE_NO_RSP,
                .val_handle = &s_profile_val_handle,
            },
            {
                .uuid = &uuid_cfg_session.u,
                .access_cb = cfg_access,
                .flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_NO_RSP,
                .val_handle = &s_session_val_handle,
            },
            {
                .uuid = &uuid_cfg_status.u,
                .access_cb = cfg_access,
                .flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_NOTIFY,
                .val_handle = &s_status_val_handle,
            },
            {
                .uuid = &uuid_cfg_caps.u,
                .access_cb = cfg_access,
                .flags = BLE_GATT_CHR_F_READ,
                .val_handle = &s_caps_val_handle,
            },
            {
                .uuid = &uuid_cfg_session_v16.u,
                .access_cb = cfg_access,
                .flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_NO_RSP,
                .val_handle = &s_session_v16_val_handle,
            },
            {
                .uuid = &uuid_cfg_status_v16.u,
                .access_cb = cfg_access,
                .flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_NOTIFY,
                .val_handle = &s_status_v16_val_handle,
            },
            {
                .uuid = &uuid_cfg_coach.u,
                .access_cb = cfg_access,
                .flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_NO_RSP,
                .val_handle = &s_coach_val_handle,
            },
            { 0 },
        },
    },
    { 0 },
};

static void frame_queue_reset(void)
{
    taskENTER_CRITICAL(&s_frame_mux);
    s_frame_head = 0;
    s_frame_tail = 0;
    s_frame_count = 0;
    s_retry_count = 0;
    s_notify_inflight = false;
    taskEXIT_CRITICAL(&s_frame_mux);
}

static void maybe_complete_drain(void)
{
    if (s_session_state != SENSOR_PROTO_STATE_DRAINING || s_drain_complete) {
        return;
    }
    if (queued_frame_count() != 0) {
        return;
    }
    s_final_sample = s_last_sent;
    s_drain_complete = true;
    ESP_LOGI(TAG, "drain complete final_sample=%" PRIu32, s_final_sample);
    notify_session_status();
}

static void frame_queue_push(const sensor_proto_sample_t *sample)
{
    bool dropped = false;
    uint16_t depth = 0;
    taskENTER_CRITICAL(&s_frame_mux);
    if (s_frame_count == FRAME_QUEUE_DEPTH) {
        s_frame_tail = (uint16_t)((s_frame_tail + 1) % FRAME_QUEUE_DEPTH);
        s_frame_count--;
        s_transport_dropped++;
        dropped = true;
    }
    s_frame_queue[s_frame_head] = *sample;
    s_frame_head = (uint16_t)((s_frame_head + 1) % FRAME_QUEUE_DEPTH);
    s_frame_count++;
    depth = (uint16_t)(s_frame_count + s_retry_count);
    if (depth > s_queue_high_water) {
        s_queue_high_water = depth;
    }
    taskEXIT_CRITICAL(&s_frame_mux);
    if (dropped && (s_transport_dropped % 64) == 1) {
        ESP_LOGW(TAG, "BLE frame queue dropped=%" PRIu32, s_transport_dropped);
    }
}

static uint8_t prepare_retry_batch(uint8_t frame_len)
{
    if (s_retry_count != 0) {
        return s_retry_count;
    }
    uint16_t payload_len = s_att_mtu > 3 ? (uint16_t)(s_att_mtu - 3) : 0;
    if (payload_len < frame_len) {
        /* Forcing one oversized frame retries a PDU the peer cannot accept
         * and the motion counter stays at zero. */
        static uint32_t skips;
        if ((skips++ % 64) == 0) {
            ESP_LOGW(TAG, "frame %u B does not fit ATT payload %u",
                     (unsigned)frame_len, (unsigned)payload_len);
        }
        return 0;
    }
    uint8_t max_frames = (uint8_t)(payload_len / frame_len);
    uint8_t batch_limit = current_batch_limit();
    if (max_frames > batch_limit) {
        max_frames = batch_limit;
    }

    taskENTER_CRITICAL(&s_frame_mux);
    while (s_retry_count < max_frames && s_frame_count > 0) {
        s_retry_batch[s_retry_count++] = s_frame_queue[s_frame_tail];
        s_frame_tail = (uint16_t)((s_frame_tail + 1) % FRAME_QUEUE_DEPTH);
        s_frame_count--;
    }
    taskEXIT_CRITICAL(&s_frame_mux);
    return s_retry_count;
}

static bool notify_batch(uint16_t val_handle, uint8_t frame_len)
{
    uint8_t frame_count = prepare_retry_batch(frame_len);
    if (frame_count == 0) {
        return false;
    }

    uint8_t buf[SENSOR_PROTO_FRAME_FUSED_LEN * BATCH_MAX_FRAMES];
    for (uint8_t i = 0; i < frame_count; i++) {
        if (frame_len == SENSOR_PROTO_FRAME_FUSED_LEN) {
            sensor_proto_frame_fused_t frame = {0};
            sensor_proto_sample_to_frame_fused(&frame, &s_retry_batch[i]);
            sensor_proto_pack_frame_fused(&buf[i * SENSOR_PROTO_FRAME_FUSED_LEN],
                                          &frame);
        } else if (frame_len == SENSOR_PROTO_FRAME_V16_LEN) {
            sensor_proto_frame_v16_t frame = {0};
            sensor_proto_sample_to_frame_v16(&frame, &s_retry_batch[i]);
            sensor_proto_pack_frame_v16(&buf[i * SENSOR_PROTO_FRAME_V16_LEN],
                                        &frame);
        } else {
            sensor_proto_frame_t frame = {0};
            sensor_proto_sample_to_frame_v1(&frame, &s_retry_batch[i]);
            sensor_proto_pack_frame(&buf[i * SENSOR_PROTO_FRAME_LEN], &frame);
        }
    }
    uint16_t len = (uint16_t)(frame_count * frame_len);
    struct os_mbuf *om = ble_hs_mbuf_from_flat(buf, len);
    if (!om) {
        return true; /* keep retry batch */
    }
    /*
     * IDF 5 deferred NOTIFY_TX until the controller sent the PDU. IDF 6
     * NimBLE emits it synchronously inside ble_gatts_notify_custom
     * ("attempted"). Mark inflight *before* that call so the callback can
     * clear it. Setting inflight after return deadlocks: one notify, then
     * the frame queue fills and the browser sees a stale 0 Hz stream.
     */
    s_notify_inflight = true;
    int rc = ble_gatts_notify_custom(s_conn_handle, val_handle, om);
    if (rc != 0 && s_notify_inflight) {
        s_notify_inflight = false;
        s_notify_failures++;
        if ((s_notify_failures % 100) == 1) {
            ESP_LOGW(TAG, "notify rc=%d failures=%" PRIu32, rc,
                     s_notify_failures);
        }
    }
    return true;
}

/*
 * True when a full batch is queued, a failed batch awaits retry, or a drain
 * must flush the tail. Without this, every TX-complete event sent whatever
 * was queued, so captures went out one frame per notify. Called from the
 * sensor task and the NimBLE host task.
 */
static bool notify_ready(void)
{
    uint8_t target = batch_target();
    bool draining = s_session_state == SENSOR_PROTO_STATE_DRAINING;
    taskENTER_CRITICAL(&s_frame_mux);
    bool ready = s_retry_count > 0 || s_frame_count >= target ||
                 (draining && s_frame_count > 0);
    taskEXIT_CRITICAL(&s_frame_mux);
    return ready;
}

static void notify_ev_cb(struct ble_npl_event *ev)
{
    (void)ev;
    if (!s_notify_enabled || s_conn_handle == BLE_HS_CONN_HANDLE_NONE) {
        return;
    }
    if (s_notify_inflight) {
        return;
    }
    if (!notify_ready()) {
        maybe_complete_drain();
        return;
    }

    /*
     * Prefer fused (Mahony) when subscribed; else v16; else legacy v1.
     * Dual subscription must not double the radio load.
     */
    bool sent = false;
    if (s_motion_fused_subscribed) {
        sent = notify_batch(s_data_fused_val_handle, SENSOR_PROTO_FRAME_FUSED_LEN);
    } else if (s_motion_v16_subscribed) {
        sent = notify_batch(s_data_v16_val_handle, SENSOR_PROTO_FRAME_V16_LEN);
    } else if (s_motion_subscribed) {
        sent = notify_batch(s_data_val_handle, SENSOR_PROTO_FRAME_LEN);
    }
    if (!sent) {
        maybe_complete_drain();
        return;
    }
    if (s_notify_inflight) {
        return; /* wait for TX complete before the next batch */
    }

    if (notify_ready()) {
        ble_npl_eventq_put(nimble_port_get_dflt_eventq(), &s_notify_ev);
    } else {
        maybe_complete_drain();
    }
}

static int16_t deg_to_ddeg(float deg)
{
    float v = deg * 10.0f;
    if (v > 32767.0f) {
        v = 32767.0f;
    }
    if (v < -32768.0f) {
        v = -32768.0f;
    }
    return (int16_t)lroundf(v);
}

static void on_stroke(const rowing_stroke_t *stroke)
{
    if (!stroke) {
        return;
    }
    sensor_proto_summary_t pkt = {0};
    pkt.ver = SENSOR_PROTO_SUMMARY_VER;
    pkt.flags = SENSOR_PROTO_SUMMARY_FLAG_VALID;
    if (stroke->zeroed) {
        pkt.flags |= SENSOR_PROTO_SUMMARY_FLAG_ZEROED;
    }
    if (stroke->feather_trusted) {
        pkt.flags |= SENSOR_PROTO_SUMMARY_FLAG_FEATHER;
    }
    pkt.stroke_idx = stroke->stroke_idx;
    pkt.sample_index = stroke->sample_index;
    pkt.catch_ddeg = deg_to_ddeg(stroke->catch_deg);
    pkt.finish_ddeg = deg_to_ddeg(stroke->finish_deg);
    float arc = fabsf(stroke->arc_deg) * 10.0f;
    if (arc > 65535.0f) {
        arc = 65535.0f;
    }
    pkt.arc_ddeg = (uint16_t)lroundf(arc);
    float spm = stroke->spm * 10.0f;
    if (spm < 0.0f) {
        spm = 0.0f;
    }
    if (spm > 65535.0f) {
        spm = 65535.0f;
    }
    pkt.spm_x10 = (uint16_t)lroundf(spm);
    pkt.drive_ms = stroke->drive_ms;
    uint16_t mv = 0;
    uint8_t pct = 255;
    if (battery_read(&mv, &pct) != ESP_OK) {
        pct = 255;
    }
    pkt.batt_pct = pct;
    memcpy(s_summary, &pkt, sizeof(pkt));
    if (!s_summary_subscribed || s_conn_handle == BLE_HS_CONN_HANDLE_NONE) {
        return;
    }
    struct os_mbuf *om = ble_hs_mbuf_from_flat(s_summary, sizeof(s_summary));
    if (!om) {
        return;
    }
    int rc = ble_gatts_notify_custom(s_conn_handle, s_summary_val_handle, om);
    if (rc != 0) {
        ESP_LOGW(TAG, "summary notify rc=%d", rc);
    }
}

static void feed_rowing(const sensor_proto_sample_t *sample)
{
    uint16_t rate = sensor_stream_get_applied_rate_hz();
    if (rate == 0 || rate > SENSOR_PROTO_RATE_LOG_HZ) {
        return;
    }
    sensor_proto_meta_t meta = {0};
    if (sensor_stream_get_meta(&meta) != ESP_OK ||
        meta.accel_lsb_per_g == 0 || meta.gyro_lsb_per_dps == 0) {
        return;
    }
    float ax = (float)sample->ax / (float)meta.accel_lsb_per_g;
    float ay = (float)sample->ay / (float)meta.accel_lsb_per_g;
    float az = (float)sample->az / (float)meta.accel_lsb_per_g;
    float gx = (float)sample->gx / (float)meta.gyro_lsb_per_dps;
    float gy = (float)sample->gy / (float)meta.gyro_lsb_per_dps;
    float gz = (float)sample->gz / (float)meta.gyro_lsb_per_dps;
    uint32_t t_ms = (uint32_t)(((uint64_t)sample->sample_index * 1000ull) / rate);
    rowing_metrics_push(sample->sample_index, ax, ay, az, gx, gy, gz, t_ms, NULL);
}

static void on_sample(const sensor_proto_sample_t *sample, void *ctx)
{
    (void)ctx;
    feed_rowing(sample);
    if (session_accepts_samples()) {
        if (!s_session_first_valid) {
            s_session_first_sample = sample->sample_index;
            s_session_first_valid = true;
        }
        s_last_produced = sample->sample_index;
    }
    if (!s_notify_enabled || !s_accept_transport) {
        maybe_complete_drain();
        return;
    }
    frame_queue_push(sample);
    if (notify_ready()) {
        ble_npl_eventq_put(nimble_port_get_dflt_eventq(), &s_notify_ev);
    }
}

static esp_err_t start_advertise(void)
{
    load_adv_name();

    struct ble_hs_adv_fields fields = {0};
    fields.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
    fields.uuids128 = (ble_uuid128_t *)&uuid_motion_svc;
    fields.num_uuids128 = 1;
    fields.uuids128_is_complete = 1;

    int rc = ble_gap_adv_set_fields(&fields);
    if (rc != 0) {
        ESP_LOGE(TAG, "adv_set_fields rc=%d", rc);
        return ESP_FAIL;
    }

    struct ble_hs_adv_fields rsp = {0};
    rsp.name = (uint8_t *)s_adv_name;
    rsp.name_len = strlen(s_adv_name);
    rsp.name_is_complete = 1;
    rc = ble_gap_adv_rsp_set_fields(&rsp);
    if (rc != 0) {
        ESP_LOGE(TAG, "adv_rsp rc=%d", rc);
        return ESP_FAIL;
    }

    struct ble_gap_adv_params adv = {0};
    adv.conn_mode = BLE_GAP_CONN_MODE_UND;
    adv.disc_mode = BLE_GAP_DISC_MODE_GEN;
    adv.itvl_min = BLE_GAP_ADV_ITVL_MS(100);
    adv.itvl_max = BLE_GAP_ADV_ITVL_MS(100);

    rc = ble_gap_adv_start(s_own_addr_type, NULL, BLE_HS_FOREVER, &adv,
                           gap_event, NULL);
    if (rc != 0) {
        ESP_LOGE(TAG, "adv_start rc=%d", rc);
        return ESP_FAIL;
    }
    s_advertising = true;
    set_ui_state(UI_STATE_WAITING);
    ESP_LOGI(TAG, "advertising as \"%s\"", s_adv_name);
    if (s_link_cb) {
        s_link_cb(false);
    }
    return ESP_OK;
}

static int gap_event(struct ble_gap_event *event, void *arg)
{
    (void)arg;
    switch (event->type) {
    case BLE_GAP_EVENT_CONNECT:
        ESP_LOGI(TAG, "connect status=%d", event->connect.status);
        if (event->connect.status == 0) {
            s_conn_handle = event->connect.conn_handle;
            s_att_mtu = BLE_ATT_MTU_DFLT;
            s_conn_update_tries = 0;
            s_notify_inflight = false;
            frame_queue_reset();
            request_fast_conn_params();
            int rc = ble_gap_set_data_len(s_conn_handle, 251, 2120);
            if (rc != 0) {
                ESP_LOGW(TAG, "data length request rc=%d", rc);
            }
            /* Windows/Chrome often never initiate ATT MTU exchange; request it. */
            rc = ble_gattc_exchange_mtu(s_conn_handle, on_mtu_exchanged, NULL);
            if (rc != 0) {
                ESP_LOGW(TAG, "ATT MTU exchange request rc=%d", rc);
                refresh_att_mtu();
            }
            s_advertising = false;
            s_motion_subscribed = false;
            s_motion_v16_subscribed = false;
            s_motion_fused_subscribed = false;
            s_summary_subscribed = false;
            s_stream_requested = true;
            s_notify_enabled = false;
            s_session_state = SENSOR_PROTO_STATE_IDLE;
            s_capture_id = 0;
            s_host_max_batch = 0;
            s_session_first_valid = false;
            s_accept_transport = true;
            s_drain_complete = false;
            s_last_error_reason = SENSOR_PROTO_ERR_NONE;
            s_session_sensor_base = sensor_stream_dropped_count();
            s_session_transport_base = s_transport_dropped;
            s_session_notify_base = s_notify_failures;
            sensor_stream_set_enabled(false);
            set_ui_state(UI_STATE_CONNECTED);
            if (s_link_cb) {
                s_link_cb(true);
            }
        } else {
            s_conn_handle = BLE_HS_CONN_HANDLE_NONE;
            s_advertising = false;
            if (start_advertise() != ESP_OK) {
                ESP_LOGE(TAG, "failed to resume advertising");
            }
        }
        break;
    case BLE_GAP_EVENT_DISCONNECT:
        ESP_LOGI(TAG, "disconnect reason=%d", event->disconnect.reason);
        s_conn_handle = BLE_HS_CONN_HANDLE_NONE;
        frame_queue_reset();
        s_advertising = false;
        s_motion_subscribed = false;
        s_motion_v16_subscribed = false;
        s_motion_fused_subscribed = false;
        s_summary_subscribed = false;
        s_stream_requested = true;
        s_notify_enabled = false;
        s_session_state = SENSOR_PROTO_STATE_IDLE;
        s_capture_id = 0;
        s_host_max_batch = 0;
        s_session_first_valid = false;
        s_accept_transport = true;
        s_drain_complete = false;
        sensor_stream_set_fusion_enabled(false);
        s_notify_inflight = false;
        sensor_stream_set_enabled(false);
        if (start_advertise() != ESP_OK) {
            ESP_LOGE(TAG, "failed to advertise after disconnect");
        }
        break;
    case BLE_GAP_EVENT_SUBSCRIBE:
        if (event->subscribe.attr_handle == s_data_val_handle) {
            s_motion_subscribed = event->subscribe.cur_notify;
            ESP_LOGI(TAG, "motion v1 notify %s",
                     s_motion_subscribed ? "ON" : "OFF");
            if (!motion_any_subscribed()) {
                (void)set_stream_rate(SENSOR_PROTO_RATE_LIVE_HZ);
                frame_queue_reset();
            }
            apply_stream_state();
            if (event->subscribe.cur_notify) {
                request_fast_conn_params();
            }
            notify_session_status();
        } else if (event->subscribe.attr_handle == s_data_v16_val_handle) {
            s_motion_v16_subscribed = event->subscribe.cur_notify;
            ESP_LOGI(TAG, "motion v16 notify %s",
                     s_motion_v16_subscribed ? "ON" : "OFF");
            if (!motion_any_subscribed()) {
                (void)set_stream_rate(SENSOR_PROTO_RATE_LIVE_HZ);
                frame_queue_reset();
            }
            apply_stream_state();
            if (event->subscribe.cur_notify) {
                request_fast_conn_params();
            }
            notify_session_status();
        } else if (event->subscribe.attr_handle == s_data_fused_val_handle) {
            s_motion_fused_subscribed = event->subscribe.cur_notify;
            ESP_LOGI(TAG, "motion fused notify %s",
                     s_motion_fused_subscribed ? "ON" : "OFF");
            if (!motion_any_subscribed()) {
                (void)set_stream_rate(SENSOR_PROTO_RATE_LIVE_HZ);
                frame_queue_reset();
            }
            apply_stream_state();
            if (event->subscribe.cur_notify) {
                request_fast_conn_params();
            }
            notify_session_status();
        } else if (event->subscribe.attr_handle == s_summary_val_handle) {
            s_summary_subscribed = event->subscribe.cur_notify;
            ESP_LOGI(TAG, "coach summary notify %s",
                     s_summary_subscribed ? "ON" : "OFF");
            if (s_summary_subscribed && !motion_any_subscribed()) {
                (void)set_stream_rate(SENSOR_PROTO_RATE_LIVE_HZ);
            }
            apply_stream_state();
        } else if ((event->subscribe.attr_handle == s_status_val_handle ||
                    event->subscribe.attr_handle == s_status_v16_val_handle) &&
                   event->subscribe.cur_notify) {
            notify_session_status();
        }
        break;
    case BLE_GAP_EVENT_MTU:
        s_att_mtu = event->mtu.value;
        ESP_LOGI(TAG, "MTU update conn=%d mtu=%d",
                 event->mtu.conn_handle, event->mtu.value);
        notify_session_status();
        break;
    case BLE_GAP_EVENT_CONN_UPDATE: {
        struct ble_gap_conn_desc desc;
        int rc = ble_gap_conn_find(event->conn_update.conn_handle, &desc);
        if (rc == 0) {
            ESP_LOGI(TAG, "conn update status=%d itvl=%u (x1.25ms) latency=%u",
                     event->conn_update.status, desc.conn_itvl,
                     desc.conn_latency);
            if (event->conn_update.status == 0 &&
                desc.conn_itvl > CONN_ITVL_MAX_CREW) {
                request_fast_conn_params();
            }
        }
        break;
    }
    case BLE_GAP_EVENT_NOTIFY_TX: {
        uint16_t handle = event->notify_tx.attr_handle;
        if (handle != s_data_val_handle && handle != s_data_v16_val_handle &&
            handle != s_data_fused_val_handle) {
            break;
        }
        s_notify_inflight = false;
        if (event->notify_tx.status == 0 ||
            event->notify_tx.status == BLE_HS_EDONE) {
            if (s_retry_count > 0) {
                s_last_sent = s_retry_batch[s_retry_count - 1].sample_index;
                s_retry_count = 0;
            }
        } else {
            s_notify_failures++;
            if ((s_notify_failures % 100) == 1) {
                ESP_LOGW(TAG, "notify_tx status=%d failures=%" PRIu32,
                         event->notify_tx.status, s_notify_failures);
            }
        }
        if (s_notify_enabled) {
            ble_npl_eventq_put(nimble_port_get_dflt_eventq(), &s_notify_ev);
        } else {
            maybe_complete_drain();
        }
        break;
    }
    default:
        break;
    }
    return 0;
}

static void on_sync(void)
{
    int rc = ble_hs_util_ensure_addr(0);
    assert(rc == 0);
    rc = ble_hs_id_infer_auto(0, &s_own_addr_type);
    assert(rc == 0);

    uint8_t addr[6] = {0};
    ble_hs_id_copy_addr(s_own_addr_type, addr, NULL);
    ESP_LOGI(TAG, "BLE addr %02X:%02X:%02X:%02X:%02X:%02X",
             addr[5], addr[4], addr[3], addr[2], addr[1], addr[0]);
    if (start_advertise() != ESP_OK) {
        ESP_LOGE(TAG, "initial advertising failed");
    }
}

static void on_reset(int reason)
{
    ESP_LOGW(TAG, "nimble reset reason=%d", reason);
}

static esp_err_t init_stack(void)
{
    esp_err_t ret = nimble_port_init();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "nimble_port_init: %s", esp_err_to_name(ret));
        return ret;
    }
    ble_hs_cfg.reset_cb = on_reset;
    ble_hs_cfg.sync_cb = on_sync;
    load_adv_name();
    if (ble_svc_gap_device_name_set(s_adv_name) != 0) {
        ESP_LOGE(TAG, "failed to set BLE device name");
        deinit_stack_after_init_failure();
        return ESP_FAIL;
    }
    ble_svc_gap_init();
    ble_svc_gatt_init();
    /* Prefer a large ATT MTU so 4×24 B fused (or 2×22 B v16) batches fit. */
    if (ble_att_set_preferred_mtu(247) != 0) {
        ESP_LOGW(TAG, "failed to set preferred ATT MTU");
    }
    int rc = ble_gatts_count_cfg(gatt_svcs);
    if (rc != 0) {
        ESP_LOGE(TAG, "gatt count rc=%d", rc);
        deinit_stack_after_init_failure();
        return ESP_FAIL;
    }
    rc = ble_gatts_add_svcs(gatt_svcs);
    if (rc != 0) {
        ESP_LOGE(TAG, "gatt add rc=%d", rc);
        deinit_stack_after_init_failure();
        return ESP_FAIL;
    }
    ble_npl_event_init(&s_notify_ev, notify_ev_cb, NULL);
    s_conn_handle = BLE_HS_CONN_HANDLE_NONE;
    s_notify_enabled = false;
    s_motion_subscribed = false;
    s_motion_v16_subscribed = false;
    s_motion_fused_subscribed = false;
    s_stream_requested = true;
    s_att_mtu = BLE_ATT_MTU_DFLT;
    s_transport_dropped = 0;
    s_notify_failures = 0;
    s_rate_epoch = 1;
    s_epoch_rate_hz = SENSOR_PROTO_RATE_LIVE_HZ;
    s_session_state = SENSOR_PROTO_STATE_IDLE;
    s_capture_id = 0;
    s_session_first_valid = false;
    s_accept_transport = true;
    s_drain_complete = false;
    s_last_error_reason = SENSOR_PROTO_ERR_NONE;
    s_last_command_id = 0;
    s_queue_high_water = 0;
    s_session_sensor_base = 0;
    s_session_transport_base = 0;
    s_session_notify_base = 0;
    frame_queue_reset();
    s_advertising = false;
    s_sync_rsp_valid = false;
    s_workout_profile = SENSOR_PROTO_PROFILE_GENERAL;
    s_stack_running = true;
    return ESP_OK;
}

static void host_task(void *param)
{
    (void)param;
    nimble_port_run();
    nimble_port_freertos_deinit();
}

esp_err_t ble_tracker_init(void)
{
    rowing_calib_t cal = {.sign = 1, .shaft_axis = 2};
    int8_t sign = 1;
    bool zeroed = false;
    uint8_t axis = 2;
    int16_t feather = 0;
    if (device_config_get_oar(&sign, &zeroed, &axis, &feather) == ESP_OK) {
        cal.sign = sign;
        cal.zeroed = zeroed;
        cal.shaft_axis = axis;
        cal.feather_ddeg = feather;
    }
    rowing_metrics_init();
    rowing_metrics_restore(&cal);
    rowing_metrics_set_stroke_cb(on_stroke);
    sensor_stream_set_sample_cb(on_sample, NULL);
    return ble_tracker_start_advertising();
}

esp_err_t ble_tracker_set_link_cb(ble_tracker_link_cb_t cb)
{
    s_link_cb = cb;
    return ESP_OK;
}

esp_err_t ble_tracker_start_advertising(void)
{
    ESP_RETURN_ON_FALSE(!s_stack_running, ESP_ERR_INVALID_STATE, TAG,
                        "BLE stack already running");
    esp_err_t ret = init_stack();
    if (ret != ESP_OK) {
        return ret;
    }
    nimble_port_freertos_init(host_task);
    ESP_LOGI(TAG, "NimBLE host started");
    return ESP_OK;
}

esp_err_t ble_tracker_stop_advertising(void)
{
    ESP_RETURN_ON_FALSE(s_stack_running, ESP_OK, TAG, "BLE stack stopped");
    ESP_RETURN_ON_FALSE(s_conn_handle == BLE_HS_CONN_HANDLE_NONE,
                        ESP_ERR_INVALID_STATE, TAG, "BLE connection active");
    if (s_advertising && ble_gap_adv_stop() != 0) {
        ESP_LOGE(TAG, "failed to stop advertising");
        return ESP_FAIL;
    }
    s_advertising = false;
    if (nimble_port_stop() != 0) {
        ESP_LOGE(TAG, "failed to stop NimBLE host");
        return ESP_FAIL;
    }
    esp_err_t ret = nimble_port_deinit();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "NimBLE deinit: %s", esp_err_to_name(ret));
        return ret;
    }
    s_stack_running = false;
    s_conn_handle = BLE_HS_CONN_HANDLE_NONE;
    s_notify_enabled = false;
    s_motion_subscribed = false;
    s_motion_v16_subscribed = false;
    s_motion_fused_subscribed = false;
    s_stream_requested = true;
    frame_queue_reset();
    sensor_stream_set_enabled(false);
    return ESP_OK;
}

esp_err_t ble_tracker_refresh_advertising(void)
{
    if (!s_stack_running || s_conn_handle != BLE_HS_CONN_HANDLE_NONE) {
        return ESP_ERR_INVALID_STATE;
    }
    if (s_advertising) {
        (void)ble_gap_adv_stop();
        s_advertising = false;
    }
    load_adv_name();
    if (ble_svc_gap_device_name_set(s_adv_name) != 0) {
        ESP_LOGW(TAG, "GAP name update failed");
    }
    return start_advertise();
}

bool ble_tracker_is_advertising(void)
{
    return s_advertising;
}

bool ble_tracker_is_connected(void)
{
    return s_conn_handle != BLE_HS_CONN_HANDLE_NONE;
}

esp_err_t ble_tracker_toggle_streaming(bool *out_enabled)
{
    ESP_RETURN_ON_FALSE(s_conn_handle != BLE_HS_CONN_HANDLE_NONE,
                        ESP_ERR_INVALID_STATE, TAG, "not connected");
    s_stream_requested = !s_stream_requested;
    apply_stream_state();
    if (out_enabled) {
        *out_enabled = s_stream_requested;
    }
    notify_session_status();
    ESP_LOGI(TAG, "button stream %s",
             s_stream_requested ? "enabled" : "paused");
    return ESP_OK;
}

bool ble_tracker_is_streaming(void)
{
    return s_notify_enabled;
}

uint8_t ble_tracker_get_workout_profile(void)
{
    return s_workout_profile;
}
