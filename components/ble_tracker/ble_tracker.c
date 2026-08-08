#include "ble_tracker.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

#include "battery.h"
#include "device_config.h"
#include "esp_check.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "host/ble_hs.h"
#include "host/ble_uuid.h"
#include "host/util/util.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
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

static uint8_t s_own_addr_type;
static uint16_t s_conn_handle = BLE_HS_CONN_HANDLE_NONE;
static uint16_t s_data_val_handle;
static uint16_t s_meta_val_handle;
static uint16_t s_info_val_handle;
static uint16_t s_name_val_handle;
static uint16_t s_sync_val_handle;
static uint16_t s_batt_val_handle;
static bool s_notify_enabled;
static volatile bool s_advertising;
static volatile bool s_stack_running;
static ble_tracker_link_cb_t s_link_cb;
static char s_adv_name[DEVICE_CONFIG_NAME_MAX + 1];
static uint8_t s_sync_rsp[SENSOR_PROTO_CFG_SYNC_RSP_LEN];
static bool s_sync_rsp_valid;

static struct ble_npl_event s_notify_ev;
static sensor_proto_frame_t s_pending_frame;
static volatile bool s_frame_pending;

static esp_err_t start_advertise(void);
static int gap_event(struct ble_gap_event *event, void *arg);
static esp_err_t init_stack(void);
static void host_task(void *param);

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

static void load_adv_name(void)
{
    if (device_config_get_adv_name(s_adv_name, sizeof(s_adv_name)) != ESP_OK) {
        snprintf(s_adv_name, sizeof(s_adv_name), "C3-Tracker");
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
        if (device_config_get_mode() == DEVICE_MODE_MULTI) {
            meta.flags |= SENSOR_PROTO_FLAG_MULTI;
        }
        uint8_t buf[SENSOR_PROTO_META_LEN];
        sensor_proto_pack_meta(buf, &meta);
        return os_mbuf_append(ctxt->om, buf, sizeof(buf)) == 0
                   ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    if (attr_handle == s_data_val_handle) {
        sensor_proto_frame_t frame = {0};
        if (sensor_stream_get_latest(&frame) != ESP_OK) {
            return BLE_ATT_ERR_UNLIKELY;
        }
        uint8_t buf[SENSOR_PROTO_FRAME_LEN];
        sensor_proto_pack_frame(buf, &frame);
        return os_mbuf_append(ctxt->om, buf, sizeof(buf)) == 0
                   ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    return BLE_ATT_ERR_UNLIKELY;
}

static int cfg_access(uint16_t conn_handle, uint16_t attr_handle,
                      struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    (void)conn_handle;
    (void)arg;

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
            uint16_t seq = 0;
            sensor_proto_frame_t frame = {0};
            if (sensor_stream_get_latest(&frame) == ESP_OK) {
                seq = frame.seq;
            }
            memset(s_sync_rsp, 0, sizeof(s_sync_rsp));
            memcpy(&s_sync_rsp[0], &client_ms, sizeof(client_ms));
            memcpy(&s_sync_rsp[8], &device_us, sizeof(device_us));
            s_sync_rsp[16] = (uint8_t)(seq & 0xff);
            s_sync_rsp[17] = (uint8_t)(seq >> 8);
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
            { 0 },
        },
    },
    { 0 },
};

static void notify_ev_cb(struct ble_npl_event *ev)
{
    (void)ev;
    if (!s_notify_enabled || s_conn_handle == BLE_HS_CONN_HANDLE_NONE ||
        !s_frame_pending) {
        return;
    }
    sensor_proto_frame_t frame = s_pending_frame;
    s_frame_pending = false;

    uint8_t buf[SENSOR_PROTO_FRAME_LEN];
    sensor_proto_pack_frame(buf, &frame);
    struct os_mbuf *om = ble_hs_mbuf_from_flat(buf, sizeof(buf));
    if (!om) {
        return;
    }
    int rc = ble_gatts_notify_custom(s_conn_handle, s_data_val_handle, om);
    if (rc != 0) {
        ESP_LOGW(TAG, "notify rc=%d", rc);
    }
}

static void on_frame(const sensor_proto_frame_t *frame, void *ctx)
{
    (void)ctx;
    if (!s_notify_enabled) {
        return;
    }
    s_pending_frame = *frame;
    s_frame_pending = true;
    ble_npl_eventq_put(nimble_port_get_dflt_eventq(), &s_notify_ev);
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
            s_advertising = false;
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
        s_advertising = false;
        s_notify_enabled = false;
        sensor_stream_set_enabled(false);
        if (start_advertise() != ESP_OK) {
            ESP_LOGE(TAG, "failed to advertise after disconnect");
        }
        break;
    case BLE_GAP_EVENT_SUBSCRIBE:
        if (event->subscribe.attr_handle == s_data_val_handle) {
            s_notify_enabled = event->subscribe.cur_notify;
            ESP_LOGI(TAG, "motion notify %s",
                     s_notify_enabled ? "ON" : "OFF");
            sensor_stream_set_enabled(s_notify_enabled);
            set_ui_state(s_notify_enabled ? UI_STATE_STREAMING
                                           : UI_STATE_CONNECTED);
        }
        break;
    case BLE_GAP_EVENT_MTU:
        ESP_LOGI(TAG, "MTU update conn=%d mtu=%d",
                 event->mtu.conn_handle, event->mtu.value);
        break;
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
    s_frame_pending = false;
    s_advertising = false;
    s_sync_rsp_valid = false;
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
    sensor_stream_set_frame_cb(on_frame, NULL);
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
    s_frame_pending = false;
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
