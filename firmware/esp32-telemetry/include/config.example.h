#pragma once

// Copy to config.local.h (ignored by Git). No operational values belong here.
#define WIFI_SSID "REPLACE_ME"
#define WIFI_PASSWORD "REPLACE_ME"
#define MQTT_HOST "broker.example.invalid" // DNS name matching the certificate
#define MQTT_PORT 8883
#define MQTT_USERNAME "REPLACE_ME"
#define MQTT_PASSWORD "REPLACE_ME"
#define SITE_ID "REPLACE_WITH_SITE_UUID"
#define DEVICE_ID "REPLACE_WITH_DEVICE_UUID"

// Paste the broker's trusted root CA PEM here; use C string literals with \n.
// Neither verification nor TLS can be disabled by configuration.
#define MQTT_CA_PEM "REPLACE_WITH_ROOT_CA_PEM"

// Optional mutual TLS, if required by your broker. Supply both, or neither.
#define MQTT_CLIENT_CERT_PEM ""
#define MQTT_CLIENT_KEY_PEM ""

#define NTP_SERVER "pool.ntp.org"
#define PUBLISH_INTERVAL_MS 5000 // Minimum 1000; maximum 60000
#define BASE_POWER_W 1200.0     // Constant positive consuming load
