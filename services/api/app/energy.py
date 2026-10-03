"""Site energy balance from the latest device readings.

Sign conventions per device kind (also documented in docs/contracts.md):
- grid_meter: + import from grid, - export to grid
- solar_inverter: + production
- battery: + charging, - discharging
- every other kind: + consumption
"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from app.schemas import DeviceKind, SiteSummary


class Role(StrEnum):
    GRID = "grid"
    SOLAR = "solar"
    BATTERY = "battery"
    EV = "ev"
    LOAD = "load"


ROLE_BY_KIND = {
    DeviceKind.GRID_METER: Role.GRID,
    DeviceKind.SOLAR_INVERTER: Role.SOLAR,
    DeviceKind.BATTERY: Role.BATTERY,
    DeviceKind.EV_CHARGER: Role.EV,
}


def role_of(kind: DeviceKind) -> Role:
    return ROLE_BY_KIND.get(kind, Role.LOAD)


@dataclass(frozen=True)
class Reading:
    kind: DeviceKind
    online: bool
    power_w: float | None = None
    soc_pct: float | None = None
    capacity_wh: float | None = None
    observed_at: datetime | None = None


def _total(readings: list[Reading], role: Role) -> float | None:
    values = [
        r.power_w
        for r in readings
        if r.online and r.power_w is not None and role_of(r.kind) == role
    ]
    return sum(values) if values else None


def _complete(readings: list[Reading], role: Role) -> bool:
    """True when every device with this role is online and reports power."""
    return all(r.online and r.power_w is not None for r in readings if role_of(r.kind) == role)


def _battery_soc(readings: list[Reading]) -> float | None:
    batteries = [
        r
        for r in readings
        if r.online and r.soc_pct is not None and role_of(r.kind) == Role.BATTERY
    ]
    if not batteries:
        return None
    capacities = [r.capacity_wh for r in batteries]
    if all(c is not None for c in capacities):
        total = sum(c for c in capacities if c is not None)
        return sum((r.soc_pct or 0) * (r.capacity_wh or 0) for r in batteries) / total
    return sum(r.soc_pct or 0 for r in batteries) / len(batteries)


def summarize(readings: Iterable[Reading]) -> SiteSummary:
    items = list(readings)
    solar = _total(items, Role.SOLAR)
    grid = _total(items, Role.GRID)
    battery = _total(items, Role.BATTERY)
    ev = _total(items, Role.EV)
    loads = _total(items, Role.LOAD)

    has_grid = any(role_of(r.kind) == Role.GRID for r in items)
    balance_known = (
        has_grid
        and _complete(items, Role.GRID)
        and _complete(items, Role.SOLAR)
        and _complete(items, Role.BATTERY)
    )
    measured = None if ev is None and loads is None else (ev or 0) + (loads or 0)
    if balance_known:
        balance = (grid or 0) + (solar or 0) - (battery or 0)
        consumption: float | None = balance
        unmeasured: float | None = max(balance - (measured or 0), 0.0)
    else:
        consumption, unmeasured = measured, None

    timestamps = [r.observed_at for r in items if r.online and r.observed_at is not None]
    return SiteSummary(
        solar_w=solar,
        grid_w=grid,
        battery_w=battery,
        battery_soc_pct=_battery_soc(items),
        ev_w=ev,
        loads_w=loads,
        consumption_w=consumption,
        unmeasured_w=unmeasured,
        devices_online=sum(1 for r in items if r.online),
        devices_total=len(items),
        updated_at=max(timestamps) if timestamps else None,
    )
