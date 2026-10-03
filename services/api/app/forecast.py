"""Transparent demo forecasts: hourly solar, load and prices for the next 24 h.

Deliberately simple so every number can be explained (issue #12). The response
lists its assumptions, and the contract (ForecastOut) stays stable when a learned
forecaster replaces these functions.

- Solar: clear-sky curve x installed inverter capacity x a fixed derate.
- Load: the average measured consumption at that hour of day over the past
  week; hours without history fall back to the current consumption (persistence).
- Prices: the site's tariff.
"""

import math
from collections.abc import Mapping
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.schemas import DeviceKind, DeviceOut, ForecastInterval, ForecastOut, SiteOut
from app.tariff import Tariff

# Typical losses (soiling, temperature, inverter) relative to the nameplate rating.
CLEAR_SKY_DERATE = 0.85
HORIZON_HOURS = 24


def sun_factor(hour: float) -> float:
    """Clear-sky shape: 0 at night, 1 at solar noon (13:00 local)."""
    angle = (hour - 7.0) / 12.0 * math.pi
    return max(math.sin(angle), 0.0) ** 1.3 if 7.0 <= hour <= 19.0 else 0.0


def site_zone(timezone: str) -> ZoneInfo:
    try:
        return ZoneInfo(timezone)
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def solar_capacity_w(devices: list[DeviceOut]) -> float:
    return sum(d.limits.max_power_w or 0.0 for d in devices if d.kind == DeviceKind.SOLAR_INVERTER)


def build_forecast(
    site: SiteOut,
    devices: list[DeviceOut],
    tariff: Tariff,
    now: datetime,
    load_by_hour: Mapping[int, float],
) -> ForecastOut:
    """Hourly intervals starting at the current local hour.

    `load_by_hour` maps local hour of day (0-23) to average measured consumption, W.
    """
    zone = site_zone(site.timezone)
    local_now = now.astimezone(zone)
    start = local_now.replace(minute=0, second=0, microsecond=0)
    capacity = solar_capacity_w(devices)
    current_load = site.summary.consumption_w
    intervals: list[ForecastInterval] = []
    persisted = 0
    for i in range(HORIZON_HOURS):
        # Step in UTC so DST transitions neither skip nor repeat an hour.
        begin = (start.astimezone(ZoneInfo("UTC")) + timedelta(hours=i)).astimezone(zone)
        hour = begin.hour
        solar = capacity * sun_factor(hour + 0.5) * CLEAR_SKY_DERATE if capacity else None
        load = load_by_hour.get(hour)
        if load is None and current_load is not None:
            load, persisted = current_load, persisted + 1
        intervals.append(
            ForecastInterval(
                start=begin,
                end=begin + timedelta(hours=1),
                solar_w=solar,
                load_w=load,
                import_price=tariff.import_price(hour),
                export_price=tariff.export_price,
            )
        )

    assumptions = [
        f"Prices: {tariff.name} tariff in {tariff.currency}/kWh, local time ({site.timezone}).",
    ]
    if capacity:
        assumptions.append(
            f"Solar: clear-sky curve for {capacity / 1000:g} kW of inverters, "
            f"derated to {CLEAR_SKY_DERATE:.0%}. Clouds are not forecast."
        )
    else:
        assumptions.append("Solar: no inverter registered, so no production is expected.")
    history = HORIZON_HOURS - persisted - sum(1 for x in intervals if x.load_w is None)
    assumptions.append(
        f"Load: {history} of {HORIZON_HOURS} hours from the past week's average at that hour; "
        f"{persisted} use the current consumption."
    )
    return ForecastOut(
        site_id=site.id,
        timezone=site.timezone,
        currency=tariff.currency,
        tariff=tariff.name,
        generated_at=now,
        interval_minutes=60,
        intervals=intervals,
        assumptions=assumptions,
    )
