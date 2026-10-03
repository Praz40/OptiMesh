"""Forecast, costs and recommendations for one site, read from the platform (issue #12).

The glue between the platform's queries and the pure builders in forecast.py,
costs.py and recommendations.py. It lives beside platform.py rather than in it
because recommendations.py imports platform.

`now` is always a parameter so every function is testable at any hour; only the
routes read the clock. The hourly load profile is a 7-day aggregate, so it is
cached per site for a few minutes: the dashboard may poll recommendations often.
"""

import threading
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID
from weakref import WeakKeyDictionary

from app.costs import build_costs
from app.energy import Role, role_of
from app.forecast import build_forecast, site_zone
from app.platform import Platform
from app.recommendations import recommend
from app.schemas import CostsOut, DeviceKind, DeviceOut, ForecastOut, Recommendation, SiteSnapshot
from app.tariff import DEFAULT_TARIFF

LOAD_HISTORY = timedelta(days=7)
PROFILE_TTL = timedelta(minutes=5)
# Same balance rule as energy.summarize: consumption = grid + solar - battery.
BALANCE_SIGN = {Role.GRID: 1.0, Role.SOLAR: 1.0, Role.BATTERY: -1.0}


@dataclass(frozen=True)
class _CachedProfile:
    key: tuple[str, frozenset[UUID]]
    computed_at: datetime
    profile: dict[int, float]


# Per Platform instance, so two apps (or tests) never share a profile.
_profiles: WeakKeyDictionary[Platform, dict[UUID, _CachedProfile]] = WeakKeyDictionary()
_profiles_lock = threading.Lock()


def load_profile(
    hourly: dict[UUID, dict[int, float]], devices: list[DeviceOut]
) -> dict[int, float]:
    """Mean consumption per local hour of day, W, from mean power per device and hour.

    An hour counts only when every grid meter, inverter and battery of the site has
    data for it; a site without a grid meter has no measured consumption at all.
    """
    if not any(d.kind == DeviceKind.GRID_METER for d in devices):
        return {}
    roles = {d.id: role_of(d.kind) for d in devices}
    signs = {device_id: BALANCE_SIGN[r] for device_id, r in roles.items() if r in BALANCE_SIGN}
    profile: dict[int, float] = {}
    for hour in range(24):
        means = {device_id: hourly.get(device_id, {}).get(hour) for device_id in signs}
        if any(mean is None for mean in means.values()):
            continue
        total = sum(signs[device_id] * (mean or 0.0) for device_id, mean in means.items())
        # Means over different sample counts can disagree slightly; load is never negative.
        profile[hour] = max(total, 0.0)
    return profile


def _site_profile(platform: Platform, snapshot: SiteSnapshot, now: datetime) -> dict[int, float]:
    site = snapshot.site
    if not any(d.kind == DeviceKind.GRID_METER for d in snapshot.devices):
        return {}  # nothing to query: consumption is unknown without a grid meter
    balance = frozenset(d.id for d in snapshot.devices if role_of(d.kind) in BALANCE_SIGN)
    key = (site.timezone, balance)
    with _profiles_lock:
        cached = _profiles.get(platform, {}).get(site.id)
    if (
        cached is not None
        and cached.key == key
        and cached.computed_at <= now < cached.computed_at + PROFILE_TTL
    ):
        return cached.profile
    hourly = platform.hourly_power(site.id, site.timezone, now - LOAD_HISTORY)
    profile = load_profile(hourly, snapshot.devices)
    with _profiles_lock:
        _profiles.setdefault(platform, {})[site.id] = _CachedProfile(key, now, profile)
    return profile


def _forecast(platform: Platform, snapshot: SiteSnapshot, now: datetime) -> ForecastOut:
    profile = _site_profile(platform, snapshot, now)
    return build_forecast(snapshot.site, snapshot.devices, DEFAULT_TARIFF, now, profile)


def forecast(platform: Platform, site_id: UUID, now: datetime) -> ForecastOut:
    return _forecast(platform, platform.snapshot(site_id), now)


def costs(platform: Platform, site_id: UUID, now: datetime) -> CostsOut:
    snapshot = platform.snapshot(site_id)
    site = snapshot.site
    day_start = now.astimezone(site_zone(site.timezone)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    meters = [d.id for d in snapshot.devices if d.kind == DeviceKind.GRID_METER]
    rows = platform.meter_hours(site.id, meters, site.timezone, day_start)
    return build_costs(
        site, DEFAULT_TARIFF, now, day_start, rows, bool(meters), _forecast(platform, snapshot, now)
    )


def recommendations(platform: Platform, site_id: UUID, now: datetime) -> list[Recommendation]:
    snapshot = platform.snapshot(site_id)
    return recommend(snapshot, DEFAULT_TARIFF, _forecast(platform, snapshot, now), now)
