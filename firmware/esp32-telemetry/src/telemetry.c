#include "telemetry.h"
#include <math.h>
#include <stdio.h>
#include <string.h>

bool telemetry_uuid_valid(const char *value)
{
    if (!value || strlen(value) != 36) return false;
    for (size_t i = 0; i < 36; ++i) {
        if (i == 8 || i == 13 || i == 18 || i == 23) {
            if (value[i] != '-') return false;
        } else if (!((value[i] >= '0' && value[i] <= '9') ||
                     (value[i] >= 'a' && value[i] <= 'f') ||
                     (value[i] >= 'A' && value[i] <= 'F'))) {
            return false;
        }
    }
    return true;
}

void telemetry_uuid_v4(const uint8_t random_bytes[16], char output[37])
{
    static const char hex[] = "0123456789abcdef";
    size_t position = 0;
    for (size_t i = 0; i < 16; ++i) {
        uint8_t value = random_bytes[i];
        if (i == 6) value = (value & 0x0f) | 0x40;
        if (i == 8) value = (value & 0x3f) | 0x80;
        if (i == 4 || i == 6 || i == 8 || i == 10) output[position++] = '-';
        output[position++] = hex[value >> 4];
        output[position++] = hex[value & 0x0f];
    }
    output[position] = '\0';
}

bool telemetry_utc(time_t observed_at, char output[21])
{
    // Never publish the default boot epoch. SNTP readiness is checked separately.
    if (observed_at < (time_t)1704067200) return false; // 2024-01-01 UTC
    struct tm utc;
#ifdef _WIN32
    if (gmtime_s(&utc, &observed_at) != 0) return false;
#else
    if (!gmtime_r(&observed_at, &utc)) return false;
#endif
    if (utc.tm_year > 8099) return false; // RFC3339 uses a four-digit year
    return strftime(output, 21, "%Y-%m-%dT%H:%M:%SZ", &utc) == 20;
}

double telemetry_energy_wh(double power_w, uint64_t elapsed_us)
{
    return power_w * ((double)elapsed_us / 3600000000.0);
}

int telemetry_encode(char *output, size_t capacity, const char *site_id,
                     const char *device_id, const char *message_id,
                     time_t observed_at, double power_w, double energy_wh)
{
    char timestamp[21];
    if (!output || capacity == 0 || !telemetry_uuid_valid(site_id) ||
        !telemetry_uuid_valid(device_id) || !telemetry_uuid_valid(message_id) ||
        !telemetry_utc(observed_at, timestamp) || !isfinite(power_w) ||
        power_w <= 0 || !isfinite(energy_wh) || energy_wh < 0) return -1;
    int length = snprintf(output, capacity,
        "{\"version\":1,\"site_id\":\"%s\",\"device_id\":\"%s\","
        "\"message_id\":\"%s\",\"observed_at\":\"%s\","
        "\"metrics\":{\"power_w\":%.3f,\"energy_wh\":%.6f}}",
        site_id, device_id, message_id, timestamp, power_w, energy_wh);
    return length >= 0 && (size_t)length < capacity ? length : -1;
}
