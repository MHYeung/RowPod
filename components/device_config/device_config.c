#include "device_config.h"

#include <ctype.h>
#include <stdio.h>
#include <string.h>

#include "esp_check.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_random.h"
#include "nvs.h"
#include "nvs_flash.h"

static const char *TAG = "device_cfg";
static const char *NVS_NS = "pod";

static uint16_t s_pod_id;
static char s_custom_name[DEVICE_CONFIG_NAME_MAX + 1];
static bool s_has_custom_name;
static bool s_ready;
static int8_t s_oar_sign = 1;
static bool s_oar_zeroed;
static uint8_t s_oar_axis = 2;
static int16_t s_oar_feather;

static bool name_char_ok(char c)
{
    return isalnum((unsigned char)c) || c == '-' || c == '_' || c == ' ';
}

static esp_err_t validate_name(const char *name, size_t *out_len)
{
    if (!name) {
        return ESP_ERR_INVALID_ARG;
    }
    size_t len = strnlen(name, DEVICE_CONFIG_NAME_MAX + 1);
    if (len > DEVICE_CONFIG_NAME_MAX) {
        return ESP_ERR_INVALID_SIZE;
    }
    for (size_t i = 0; i < len; i++) {
        if (!name_char_ok(name[i])) {
            return ESP_ERR_INVALID_ARG;
        }
    }
    if (out_len) {
        *out_len = len;
    }
    return ESP_OK;
}

static uint16_t make_pod_id(void)
{
    uint8_t mac[6] = {0};
    if (esp_read_mac(mac, ESP_MAC_BT) == ESP_OK) {
        return (uint16_t)((mac[4] << 8) | mac[5]);
    }
    return (uint16_t)(esp_random() & 0xffffu);
}

static esp_err_t save_u16(nvs_handle_t h, const char *key, uint16_t v)
{
    return nvs_set_u16(h, key, v);
}

static esp_err_t persist(void)
{
    nvs_handle_t h;
    ESP_RETURN_ON_ERROR(nvs_open(NVS_NS, NVS_READWRITE, &h), TAG, "nvs open");
    esp_err_t err = save_u16(h, "pod_id", s_pod_id);
    if (err == ESP_OK) {
        if (s_has_custom_name) {
            err = nvs_set_str(h, "name", s_custom_name);
        } else {
            err = nvs_erase_key(h, "name");
            if (err == ESP_ERR_NVS_NOT_FOUND) {
                err = ESP_OK;
            }
        }
    }
    if (err == ESP_OK) {
        err = nvs_commit(h);
    }
    nvs_close(h);
    return err;
}

esp_err_t device_config_init(void)
{
    nvs_handle_t h;
    esp_err_t err = nvs_open(NVS_NS, NVS_READWRITE, &h);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "nvs open: %s", esp_err_to_name(err));
        return err;
    }

    if (nvs_get_u16(h, "pod_id", &s_pod_id) != ESP_OK || s_pod_id == 0) {
        s_pod_id = make_pod_id();
        if (s_pod_id == 0) {
            s_pod_id = 1;
        }
        (void)save_u16(h, "pod_id", s_pod_id);
        (void)nvs_commit(h);
    }

    size_t len = sizeof(s_custom_name);
    err = nvs_get_str(h, "name", s_custom_name, &len);
    if (err == ESP_OK && s_custom_name[0] != '\0' &&
        validate_name(s_custom_name, NULL) == ESP_OK) {
        s_has_custom_name = true;
    } else {
        s_custom_name[0] = '\0';
        s_has_custom_name = false;
    }
    int8_t sign = 1;
    uint8_t axis = 2;
    uint8_t zeroed = 0;
    int16_t feather = 0;
    (void)nvs_get_i8(h, "oar_sign", &sign);
    (void)nvs_get_u8(h, "oar_axis", &axis);
    (void)nvs_get_u8(h, "oar_zero", &zeroed);
    (void)nvs_get_i16(h, "oar_fref", &feather);
    nvs_close(h);
    s_oar_sign = (sign < 0) ? -1 : 1;
    s_oar_axis = (axis > 2) ? 2 : axis;
    s_oar_zeroed = (zeroed != 0);
    s_oar_feather = feather;

    s_ready = true;
    ESP_LOGI(TAG, "fixed single-node pod_id=0x%04X custom=%s",
             s_pod_id,
             s_has_custom_name ? s_custom_name : "(none)");
    return ESP_OK;
}

device_mode_t device_config_get_mode(void)
{
    return DEVICE_MODE_SINGLE;
}

uint16_t device_config_get_pod_id(void)
{
    return s_pod_id;
}

esp_err_t device_config_get_adv_name(char *out, size_t out_len)
{
    ESP_RETURN_ON_FALSE(out && out_len > 0, ESP_ERR_INVALID_ARG, TAG, "buf");
    ESP_RETURN_ON_FALSE(s_ready, ESP_ERR_INVALID_STATE, TAG, "not ready");

    if (s_has_custom_name) {
        snprintf(out, out_len, "%s", s_custom_name);
        return ESP_OK;
    }
    snprintf(out, out_len, "C3-T-%04X", s_pod_id);
    return ESP_OK;
}

bool device_config_has_custom_name(void)
{
    return s_has_custom_name;
}

esp_err_t device_config_set_name(const char *name)
{
    ESP_RETURN_ON_FALSE(s_ready, ESP_ERR_INVALID_STATE, TAG, "not ready");
    if (!name || name[0] == '\0') {
        s_custom_name[0] = '\0';
        s_has_custom_name = false;
        return persist();
    }

    size_t len = 0;
    ESP_RETURN_ON_ERROR(validate_name(name, &len), TAG, "bad name");
    memcpy(s_custom_name, name, len);
    s_custom_name[len] = '\0';
    s_has_custom_name = true;
    ESP_LOGI(TAG, "custom name=\"%s\"", s_custom_name);
    return persist();
}

esp_err_t device_config_get_oar(int8_t *sign, bool *zeroed, uint8_t *axis,
                                int16_t *feather_ddeg)
{
    if (sign) {
        *sign = s_oar_sign;
    }
    if (zeroed) {
        *zeroed = s_oar_zeroed;
    }
    if (axis) {
        *axis = s_oar_axis;
    }
    if (feather_ddeg) {
        *feather_ddeg = s_oar_feather;
    }
    return ESP_OK;
}

esp_err_t device_config_set_oar(int8_t sign, bool zeroed, uint8_t axis,
                                int16_t feather_ddeg)
{
    s_oar_sign = (sign < 0) ? -1 : 1;
    s_oar_zeroed = zeroed;
    s_oar_axis = (axis > 2) ? 2 : axis;
    s_oar_feather = feather_ddeg;
    nvs_handle_t h;
    ESP_RETURN_ON_ERROR(nvs_open(NVS_NS, NVS_READWRITE, &h), TAG, "nvs open");
    esp_err_t err = nvs_set_i8(h, "oar_sign", s_oar_sign);
    if (err == ESP_OK) {
        err = nvs_set_u8(h, "oar_axis", s_oar_axis);
    }
    if (err == ESP_OK) {
        err = nvs_set_u8(h, "oar_zero", s_oar_zeroed ? 1 : 0);
    }
    if (err == ESP_OK) {
        err = nvs_set_i16(h, "oar_fref", s_oar_feather);
    }
    if (err == ESP_OK) {
        err = nvs_commit(h);
    }
    nvs_close(h);
    return err;
}
