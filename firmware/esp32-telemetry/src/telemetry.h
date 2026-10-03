#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <time.h>

// Canonical UUIDs prevent topic separators/wildcards and unsafe JSON characters.
bool telemetry_uuid_valid(const char *value);
void telemetry_uuid_v4(const uint8_t random_bytes[16], char output[37]);
bool telemetry_utc(time_t observed_at, char output[21]);
double telemetry_energy_wh(double power_w, uint64_t elapsed_us);
// Returns payload length, or -1 for invalid input / insufficient capacity.
int telemetry_encode(char *output, size_t capacity, const char *site_id,
                     const char *device_id, const char *message_id,
                     time_t observed_at, double power_w, double energy_wh);
