// Compile together with src/telemetry.c; no ESP32 SDK or network is required.
#include "telemetry.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

int main(void)
{
    const char *site = "11111111-1111-4111-8111-111111111111";
    const char *device = "22222222-2222-4222-8222-222222222222";
    uint8_t bytes[16] = {0};
    char uuid[37], utc[21], payload[512];
    telemetry_uuid_v4(bytes, uuid);
    assert(strcmp(uuid, "00000000-0000-4000-8000-000000000000") == 0);
    memset(bytes, 255, sizeof(bytes));
    telemetry_uuid_v4(bytes, uuid);
    assert(strcmp(uuid, "ffffffff-ffff-4fff-bfff-ffffffffffff") == 0);
    assert(telemetry_uuid_valid(site));
    assert(!telemetry_uuid_valid("../device/#"));
    assert(!telemetry_uuid_valid(NULL));
    assert(!telemetry_uuid_valid("11111111-1111-4111-8111-11111111111g"));
    assert(!telemetry_utc(0, utc));
    assert(!telemetry_utc(1704067199, utc));
    assert(telemetry_utc(1704067200, utc));
    assert(strcmp(utc, "2024-01-01T00:00:00Z") == 0);
    assert(telemetry_utc(1709251199, utc));
    assert(strcmp(utc, "2024-02-29T23:59:59Z") == 0);
    assert(telemetry_utc(1709251200, utc));
    assert(strcmp(utc, "2024-03-01T00:00:00Z") == 0);
    assert(fabs(telemetry_energy_wh(1200, 3600000000ULL) - 1200) < 1e-9);
    assert(fabs(telemetry_energy_wh(1200, 5000000ULL) - 5.0 / 3.0) < 1e-9);
    assert(telemetry_energy_wh(1200, 0) == 0);
    assert(fabs(telemetry_energy_wh(1200, 86400000000ULL) - 28800) < 1e-9);
    assert(telemetry_encode(payload, 10, site, device, uuid, 1709251199, 1200, 0) == -1);
    assert(telemetry_encode(payload, sizeof(payload), "bad", device, uuid, 1709251199, 1200, 0) == -1);
    assert(telemetry_encode(payload, sizeof(payload), site, device, uuid, 0, 1200, 0) == -1);
    assert(telemetry_encode(payload, sizeof(payload), site, device, uuid, 1709251199, NAN, 0) == -1);
    assert(telemetry_encode(payload, sizeof(payload), site, device, uuid, 1709251199, INFINITY, 0) == -1);
    assert(telemetry_encode(payload, sizeof(payload), site, device, uuid, 1709251199, 1200, -1) == -1);
    assert(telemetry_encode(payload, sizeof(payload), site, device, uuid, 1709251199, 1200, INFINITY) == -1);
    for (unsigned i = 0; i < 256; ++i) {
        // Controlled entropy exercises all RFC4122 variant input bits. On-device
        // entropy comes from esp_fill_random while the Wi-Fi radio is enabled.
        for (unsigned j = 0; j < 16; ++j) bytes[j] = (uint8_t)(i + j);
        telemetry_uuid_v4(bytes, uuid);
        int length = telemetry_encode(payload, sizeof(payload), site, device,
            uuid, (time_t)1709251199 + 5 * i, 1200,
            telemetry_energy_wh(1200, 5000000ULL * i));
        assert(length > 0 && length < 4096);
        // Re-encoding an observation must preserve every byte.
        char repeated[512];
        assert(telemetry_encode(repeated, sizeof(repeated), site, device, uuid,
            (time_t)1709251199 + 5 * i, 1200,
            telemetry_energy_wh(1200, 5000000ULL * i)) == length);
        assert(strcmp(payload, repeated) == 0);
        puts(payload);
    }
    return 0;
}
