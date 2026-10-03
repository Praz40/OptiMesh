#include "config.local.h"
#include "telemetry.h"
#include <math.h>
#include <stdio.h>
#include <string.h>
#include <sys/time.h>
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_netif_sntp.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "mqtt_client.h"
#include "nvs_flash.h"

#define WIFI_READY BIT0
#define MQTT_READY BIT1
#define TIME_UPDATED BIT2
#define US_PER_SECOND 1000000LL
#define TIME_VALID_US (2LL * 60 * 60 * US_PER_SECOND)

static EventGroupHandle_t events;
static const char *TAG = "telemetry";

static void wifi_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;
    (void)data;
    if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        xEventGroupSetBits(events, WIFI_READY);
        ESP_LOGI(TAG, "Wi-Fi has an IP address");
    } else if ((base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) ||
               (base == IP_EVENT && id == IP_EVENT_STA_LOST_IP)) {
        xEventGroupClearBits(events, WIFI_READY | MQTT_READY | TIME_UPDATED);
        ESP_LOGW(TAG, "Wi-Fi/IP lost; reconnect scheduled");
    }
}

static void time_updated(struct timeval *value)
{
    (void)value;
    xEventGroupSetBits(events, TIME_UPDATED);
}

static void mqtt_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;
    (void)base;
    esp_mqtt_event_handle_t event = data;
    switch ((esp_mqtt_event_id_t)id) {
    case MQTT_EVENT_CONNECTED:
        xEventGroupSetBits(events, MQTT_READY);
        ESP_LOGI(TAG, "MQTT connected with verified TLS");
        break;
    case MQTT_EVENT_DISCONNECTED:
        xEventGroupClearBits(events, MQTT_READY);
        ESP_LOGW(TAG, "MQTT disconnected; retry interval is 5 seconds");
        break;
    case MQTT_EVENT_PUBLISHED:
        // This is an MQTT PUBACK, not an OptiMesh command acknowledgement.
        ESP_LOGI(TAG, "Broker confirmed telemetry packet %d", event->msg_id);
        break;
    case MQTT_EVENT_DELETED:
        ESP_LOGW(TAG, "Unconfirmed telemetry expired from RAM outbox");
        break;
    case MQTT_EVENT_ERROR:
        // Do not echo SDK errors containing URLs, credentials, or payloads.
        ESP_LOGW(TAG, "MQTT error; check network, CA, hostname and authentication");
        break;
    default:
        break;
    }
}

static bool configured(void)
{
    bool cert = strlen(MQTT_CLIENT_CERT_PEM) > 0;
    bool key = strlen(MQTT_CLIENT_KEY_PEM) > 0;
    return strlen(WIFI_SSID) > 0 && strlen(WIFI_SSID) <= 32 &&
        strcmp(WIFI_SSID, "REPLACE_ME") != 0 && strlen(WIFI_PASSWORD) <= 64 &&
        strcmp(WIFI_PASSWORD, "REPLACE_ME") != 0 &&
        strlen(MQTT_HOST) > 0 && !strstr(MQTT_HOST, ":") &&
        !strstr(MQTT_HOST, "/") && !strstr(MQTT_HOST, "@") &&
        strcmp(MQTT_HOST, "broker.example.invalid") != 0 &&
        MQTT_PORT > 0 && MQTT_PORT <= 65535 &&
        telemetry_uuid_valid(SITE_ID) && telemetry_uuid_valid(DEVICE_ID) &&
        strstr(MQTT_CA_PEM, "-----BEGIN CERTIFICATE-----") && cert == key &&
        ((strlen(MQTT_USERNAME) > 0 && strlen(MQTT_PASSWORD) > 0 &&
          strcmp(MQTT_USERNAME, "REPLACE_ME") != 0 &&
          strcmp(MQTT_PASSWORD, "REPLACE_ME") != 0) || cert) &&
        strlen(NTP_SERVER) > 0 &&
        PUBLISH_INTERVAL_MS >= 1000 && PUBLISH_INTERVAL_MS <= 60000 &&
        isfinite(BASE_POWER_W) && BASE_POWER_W >= 0.001 && BASE_POWER_W <= 1000000;
}

void app_main(void)
{
    // Suppress SDK detail logs that could expose configuration. Our tag is safe.
    esp_log_level_set("*", ESP_LOG_NONE);
    esp_log_level_set(TAG, ESP_LOG_INFO);
    if (!configured()) {
        ESP_LOGE(TAG, "Invalid local configuration; telemetry disabled");
        return;
    }
    esp_err_t result = nvs_flash_init();
    if (result == ESP_ERR_NVS_NO_FREE_PAGES || result == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        result = nvs_flash_init();
    }
    ESP_ERROR_CHECK(result);
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    events = xEventGroupCreate();
    if (!events) {
        ESP_LOGE(TAG, "Cannot allocate network state");
        return;
    }
    if (!esp_netif_create_default_wifi_sta()) {
        ESP_LOGE(TAG, "Cannot allocate Wi-Fi interface");
        return;
    }
    wifi_init_config_t wifi_init = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&wifi_init));
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, ESP_EVENT_ANY_ID, wifi_event, NULL));
    wifi_config_t wifi = {0};
    memcpy(wifi.sta.ssid, WIFI_SSID, strlen(WIFI_SSID));
    memcpy(wifi.sta.password, WIFI_PASSWORD, strlen(WIFI_PASSWORD));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi));
    ESP_ERROR_CHECK(esp_wifi_start());

    char client_id[60];
    uint8_t mac[6];
    ESP_ERROR_CHECK(esp_wifi_get_mac(WIFI_IF_STA, mac));
    snprintf(client_id, sizeof(client_id), "optimesh-%s-%02x%02x%02x%02x%02x%02x",
             DEVICE_ID, mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    char topic[128];
    snprintf(topic, sizeof(topic), "optimesh/v1/sites/%s/devices/%s/telemetry", SITE_ID, DEVICE_ID);
    esp_mqtt_client_config_t mqtt_config = {0};
    mqtt_config.broker.address.hostname = MQTT_HOST;
    mqtt_config.broker.address.port = MQTT_PORT;
    mqtt_config.broker.address.transport = MQTT_TRANSPORT_OVER_SSL;
    mqtt_config.broker.verification.certificate = MQTT_CA_PEM;
    mqtt_config.broker.verification.skip_cert_common_name_check = false;
    // common_name stays NULL: ESP-TLS verifies the configured broker hostname.
    mqtt_config.credentials.client_id = client_id;
    if (strlen(MQTT_USERNAME) && strcmp(MQTT_USERNAME, "REPLACE_ME") != 0) {
        mqtt_config.credentials.username = MQTT_USERNAME;
        mqtt_config.credentials.authentication.password = MQTT_PASSWORD;
    }
    if (strlen(MQTT_CLIENT_CERT_PEM)) {
        mqtt_config.credentials.authentication.certificate = MQTT_CLIENT_CERT_PEM;
        mqtt_config.credentials.authentication.key = MQTT_CLIENT_KEY_PEM;
    }
    mqtt_config.session.protocol_ver = MQTT_PROTOCOL_V_3_1_1;
    mqtt_config.session.keepalive = 30;
    mqtt_config.session.message_retransmit_timeout = 5000;
    mqtt_config.network.reconnect_timeout_ms = 5000;
    mqtt_config.network.timeout_ms = 10000;
    mqtt_config.outbox.limit = 4096;
    esp_mqtt_client_handle_t mqtt = esp_mqtt_client_init(&mqtt_config);
    if (!mqtt) {
        ESP_LOGE(TAG, "Cannot allocate MQTT client");
        return;
    }
    ESP_ERROR_CHECK(esp_mqtt_client_register_event(mqtt, ESP_EVENT_ANY_ID, mqtt_event, NULL));

    bool mqtt_started = false, sntp_started = false, wifi_attempt = false;
    int64_t next_wifi_attempt = 0, wifi_deadline = 0, last_sync = -1;
    int64_t next_publish = 0, next_time_notice = 0;
    int64_t last_sample = esp_timer_get_time();
    int64_t wifi_backoff = US_PER_SECOND;
    double energy_wh = 0;
    ESP_LOGI(TAG, "Simulated consuming load ready; interval %d ms", PUBLISH_INTERVAL_MS);
    while (true) {
        int64_t now = esp_timer_get_time();
        energy_wh += telemetry_energy_wh(BASE_POWER_W, (uint64_t)(now - last_sample));
        last_sample = now;
        EventBits_t bits = xEventGroupGetBits(events);
        if (!(bits & WIFI_READY)) {
            if (mqtt_started) {
                // A broken transport can make the graceful disconnect fail.
                // Keep the client/outbox and retry stop instead of rebooting.
                mqtt_started = esp_mqtt_client_stop(mqtt) != ESP_OK;
            }
            if (sntp_started) {
                esp_netif_sntp_deinit();
                sntp_started = false;
            }
            last_sync = -1; // Require a fresh SNTP reply after network loss.
            xEventGroupClearBits(events, TIME_UPDATED | MQTT_READY);
            if (wifi_attempt && now >= wifi_deadline) {
                // Bound an association/DHCP attempt, then back off 1..30 seconds.
                esp_wifi_disconnect();
                wifi_attempt = false;
                next_wifi_attempt = now + wifi_backoff;
                wifi_backoff = wifi_backoff < 15 * US_PER_SECOND ?
                    wifi_backoff * 2 : 30 * US_PER_SECOND;
            }
            if (!wifi_attempt && now >= next_wifi_attempt) {
                result = esp_wifi_connect();
                wifi_attempt = true;
                wifi_deadline = now + (result == ESP_OK ? 20 : 1) * US_PER_SECOND;
                ESP_LOGI(TAG, "Wi-Fi connection attempt");
            }
            vTaskDelay(pdMS_TO_TICKS(100));
            continue;
        }
        wifi_attempt = false;
        wifi_backoff = US_PER_SECOND;
        next_wifi_attempt = now;
        if (!sntp_started) {
            esp_sntp_config_t sntp = ESP_NETIF_SNTP_DEFAULT_CONFIG(NTP_SERVER);
            sntp.sync_cb = time_updated;
            ESP_ERROR_CHECK(esp_netif_sntp_init(&sntp));
            sntp_started = true;
            next_time_notice = now;
        }
        // Atomically consume callbacks; only this task owns last_sync.
        bits = xEventGroupClearBits(events, TIME_UPDATED);
        if (bits & TIME_UPDATED) {
            char utc[21];
            if (telemetry_utc(time(NULL), utc)) {
                last_sync = now;
                ESP_LOGI(TAG, "UTC synchronized");
            }
        }
        if (last_sync < 0 || now - last_sync > TIME_VALID_US) {
            if (mqtt_started) {
                mqtt_started = esp_mqtt_client_stop(mqtt) != ESP_OK;
                xEventGroupClearBits(events, MQTT_READY);
            }
            if (now >= next_time_notice) {
                ESP_LOGW(TAG, "Waiting for valid UTC; publishing paused");
                next_time_notice = now + 30 * US_PER_SECOND;
            }
            vTaskDelay(pdMS_TO_TICKS(100));
            continue;
        }
        if (!mqtt_started) {
            ESP_ERROR_CHECK(esp_mqtt_client_start(mqtt));
            mqtt_started = true;
        }
        if ((xEventGroupGetBits(events) & MQTT_READY) && now >= next_publish) {
            next_publish = now + (int64_t)PUBLISH_INTERVAL_MS * 1000;
            // One observation in flight: bounded memory, no offline backlog.
            if (esp_mqtt_client_get_outbox_size(mqtt) == 0) {
                uint8_t random_bytes[16];
                char message_id[37], payload[512];
                esp_fill_random(random_bytes, sizeof(random_bytes));
                telemetry_uuid_v4(random_bytes, message_id);
                int length = telemetry_encode(payload, sizeof(payload), SITE_ID, DEVICE_ID,
                    message_id, time(NULL), BASE_POWER_W, energy_wh);
                int packet = length > 0 ? esp_mqtt_client_enqueue(mqtt, topic, payload,
                    length, 1, 0, true) : -1; // QoS 1; retain=false
                if (packet >= 0) {
                    ESP_LOGI(TAG, "Queued telemetry packet %d, power %.1f W, energy %.3f Wh",
                             packet, BASE_POWER_W, energy_wh);
                } else {
                    ESP_LOGW(TAG, "Telemetry was not queued");
                }
            } else {
                ESP_LOGW(TAG, "Awaiting broker confirmation; skipping new observation");
            }
        }
        vTaskDelay(pdMS_TO_TICKS(100));
    }
}
