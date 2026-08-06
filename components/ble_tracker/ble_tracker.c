#include "ble_tracker.h"

#include <assert.h>
#include <string.h>

#include "board_pins.h"
#include "esp_log.h"
#include "host/ble_hs.h"
#include "host/ble_uuid.h"
#include "host/util/util.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "nvs_flash.h"
#include "sensor_protocol.h"
#include "sensor_stream.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"
#include "ui.h"

static const char *TAG = "ble_tracker";

/* Nordic LED Button Service */
static const ble_uuid128_t uuid_lbs_svc =
    BLE_UUID128_INIT(0x23, 0xd1, 0xbc, 0xea, 0x5f, 0x78, 0x23, 0x15,
                     0xde, 0xef, 0x12, 0x12, 0x23, 0x15, 0x00, 0x00);
static const ble_uuid128_t uuid_lbs_led =
    BLE_UUID128_INIT(0x23, 0xd1, 0xbc, 0xea, 0x5f, 0x78, 0x23, 0x15,
                     0xde, 0xef, 0x12, 0x12, 0x25, 0x15, 0x00, 0x00);

static const ble_uuid128_t uuid_motion_svc =
    BLE_UUID128_INIT(0x00, 0x4f, 0xd5, 0xe6, 0xb2, 0x4b, 0x86, 0x9b,
                     0x71, 0x4f, 0x2f, 0x2b, 0x00, 0x10, 0x7e, 0x9b);
static const ble_uuid128_t uuid_motion_data =
    BLE_UUID128_INIT(0x00, 0x4f, 0xd5, 0xe6, 0xb2, 0x4b, 0x86, 0x9b,
                     0x71, 0x4f, 0x2f, 0x2b, 0x01, 0x10, 0x7e, 0x9b);
static const ble_uuid128_t uuid_motion_meta =
    BLE_UUID128_INIT(0x00, 0x4f, 0xd5, 0xe6, 0xb2, 0x4b, 0x86, 0x9b,
                     0x71, 0x4f, 0x2f, 0x2b, 0x02, 0x10, 0x7e, 0x9b);

static uint8_t s_own_addr_type;
static uint16_t s_conn_handle = BLE_HS_CONN_HANDLE_NONE;
static uint16_t s_led_val_handle;
static uint16_t s_data_val_handle;
static uint16_t s_meta_val_handle;
static bool s_notify_enabled;

static struct ble_npl_event s_notify_ev;
static sensor_proto_frame_t s_pending_frame;
static volatile bool s_frame_pending;

static void start_advertise(void);
static int gap_event(struct ble_gap_event *event, void *arg);

static int lbs_access(uint16_t conn_handle, uint16_t attr_handle,
                      struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    (void)conn_handle;
    (void)arg;
    if (attr_handle != s_led_val_handle) {
        return BLE_ATT_ERR_UNLIKELY;
    }
    if (ctxt->op == BLE_GATT_ACCESS_OP_READ_CHR) {
        uint8_t v = ui_get_led_mode();
        return os_mbuf_append(ctxt->om, &v, 1) == 0 ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    if (ctxt->op == BLE_GATT_ACCESS_OP_WRITE_CHR) {
        if (OS_MBUF_PKTLEN(ctxt->om) < 1) {
            return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
        }
        uint8_t v = 0;
        if (ble_hs_mbuf_to_flat(ctxt->om, &v, 1, NULL) != 0) {
            return BLE_ATT_ERR_UNLIKELY;
        }
        if (v > 3) {
            return BLE_ATT_ERR_UNLIKELY;
        }
        ui_set_led_mode(v);
        return 0;
    }
    return BLE_ATT_ERR_UNLIKELY;
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
        return os_mbuf_append(ctxt->om, buf, sizeof(buf)) == 0 ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    if (attr_handle == s_data_val_handle) {
        sensor_proto_frame_t frame = {0};
        if (sensor_stream_get_latest(&frame) != ESP_OK) {
            return BLE_ATT_ERR_UNLIKELY;
        }
        uint8_t buf[SENSOR_PROTO_FRAME_LEN];
        sensor_proto_pack_frame(buf, &frame);
        return os_mbuf_append(ctxt->om, buf, sizeof(buf)) == 0 ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    return BLE_ATT_ERR_UNLIKELY;
}

static const struct ble_gatt_svc_def gatt_svcs[] = {
    {
        .type = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid = &uuid_lbs_svc.u,
        .characteristics = (struct ble_gatt_chr_def[]) {
            {
                .uuid = &uuid_lbs_led.u,
                .access_cb = lbs_access,
                .flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_NO_RSP,
                .val_handle = &s_led_val_handle,
            },
            { 0 },
        },
    },
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
    { 0 },
};

static void notify_ev_cb(struct ble_npl_event *ev)
{
    (void)ev;
    if (!s_notify_enabled || s_conn_handle == BLE_HS_CONN_HANDLE_NONE || !s_frame_pending) {
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

static void start_advertise(void)
{
    struct ble_hs_adv_fields fields = {0};
    fields.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
    fields.uuids128 = (ble_uuid128_t *)&uuid_lbs_svc;
    fields.num_uuids128 = 1;
    fields.uuids128_is_complete = 1;

    int rc = ble_gap_adv_set_fields(&fields);
    if (rc != 0) {
        ESP_LOGE(TAG, "adv_set_fields rc=%d", rc);
        return;
    }

    struct ble_hs_adv_fields rsp = {0};
    rsp.name = (uint8_t *)BOARD_DEVICE_NAME;
    rsp.name_len = strlen(BOARD_DEVICE_NAME);
    rsp.name_is_complete = 1;
    rc = ble_gap_adv_rsp_set_fields(&rsp);
    if (rc != 0) {
        ESP_LOGE(TAG, "adv_rsp rc=%d", rc);
        return;
    }

    struct ble_gap_adv_params adv = {0};
    adv.conn_mode = BLE_GAP_CONN_MODE_UND;
    adv.disc_mode = BLE_GAP_DISC_MODE_GEN;
    adv.itvl_min = BLE_GAP_ADV_ITVL_MS(100);
    adv.itvl_max = BLE_GAP_ADV_ITVL_MS(100);

    rc = ble_gap_adv_start(s_own_addr_type, NULL, BLE_HS_FOREVER, &adv, gap_event, NULL);
    if (rc != 0) {
        ESP_LOGE(TAG, "adv_start rc=%d", rc);
        return;
    }
    ESP_LOGI(TAG, "advertising as \"%s\"", BOARD_DEVICE_NAME);
}

static int gap_event(struct ble_gap_event *event, void *arg)
{
    (void)arg;
    switch (event->type) {
    case BLE_GAP_EVENT_CONNECT:
        ESP_LOGI(TAG, "connect status=%d", event->connect.status);
        if (event->connect.status == 0) {
            s_conn_handle = event->connect.conn_handle;
        } else {
            s_conn_handle = BLE_HS_CONN_HANDLE_NONE;
            start_advertise();
        }
        break;
    case BLE_GAP_EVENT_DISCONNECT:
        ESP_LOGI(TAG, "disconnect reason=%d", event->disconnect.reason);
        s_conn_handle = BLE_HS_CONN_HANDLE_NONE;
        s_notify_enabled = false;
        sensor_stream_set_enabled(false);
        start_advertise();
        break;
    case BLE_GAP_EVENT_SUBSCRIBE:
        if (event->subscribe.attr_handle == s_data_val_handle) {
            s_notify_enabled = event->subscribe.cur_notify;
            ESP_LOGI(TAG, "motion notify %s", s_notify_enabled ? "ON" : "OFF");
            sensor_stream_set_enabled(s_notify_enabled);
        }
        break;
    case BLE_GAP_EVENT_MTU:
        ESP_LOGI(TAG, "MTU update conn=%d mtu=%d", event->mtu.conn_handle, event->mtu.value);
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
    start_advertise();
}

static void on_reset(int reason)
{
    ESP_LOGW(TAG, "nimble reset reason=%d", reason);
}

static void host_task(void *param)
{
    (void)param;
    nimble_port_run();
    nimble_port_freertos_deinit();
}

esp_err_t ble_tracker_init(void)
{
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    ret = nimble_port_init();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "nimble_port_init: %s", esp_err_to_name(ret));
        return ret;
    }

    ble_hs_cfg.reset_cb = on_reset;
    ble_hs_cfg.sync_cb = on_sync;
    ble_svc_gap_device_name_set(BOARD_DEVICE_NAME);
    ble_svc_gap_init();
    ble_svc_gatt_init();

    int rc = ble_gatts_count_cfg(gatt_svcs);
    if (rc != 0) {
        return ESP_FAIL;
    }
    rc = ble_gatts_add_svcs(gatt_svcs);
    if (rc != 0) {
        return ESP_FAIL;
    }

    ble_npl_event_init(&s_notify_ev, notify_ev_cb, NULL);
    sensor_stream_set_frame_cb(on_frame, NULL);

    nimble_port_freertos_init(host_task);
    ESP_LOGI(TAG, "NimBLE host started");
    return ESP_OK;
}
