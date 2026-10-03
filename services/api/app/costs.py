"""Today's energy cost from interval energy at the grid meter (issue #12).

Import energy comes from the meter's lifetime counter (energy_wh) where it is
consistent; otherwise, and for export, from average power over the covered part
of the hour. Never from a single instantaneous reading.
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from app.forecast import site_zone
from app.schemas import CostInterval, CostsOut, ForecastOut, SiteOut
from app.tariff import Tariff

# One telemetry period, added to the observed span so a full hour of 2 s readings counts as 1 h.
SAMPLE_PERIOD = timedelta(seconds=2)


@dataclass(frozen=True)
class MeterHour:
    """Aggregated readings of one grid meter in one local hour."""

    device_id: UUID
    hour: datetime  # local, timezone-aware, on the hour
    min_energy_wh: float | None
    max_energy_wh: float | None
    avg_import_w: float  # mean of max(power, 0)
    avg_export_w: float  # mean of max(-power, 0)
    first: datetime
    last: datetime


def hour_energy(row: MeterHour) -> tuple[float, float]:
    """(import_wh, export_wh) for one meter-hour."""
    covered_h = min((row.last - row.first + SAMPLE_PERIOD).total_seconds(), 3600) / 3600
    by_power = row.avg_import_w * covered_h
    counter = (
        row.max_energy_wh - row.min_energy_wh
        if row.min_energy_wh is not None and row.max_energy_wh is not None
        else None
    )
    # A counter that went backwards was reset (device restart): fall back to power.
    import_wh = counter if counter is not None and counter >= 0 else by_power
    return import_wh, row.avg_export_w * covered_h


def build_costs(
    site: SiteOut,
    tariff: Tariff,
    now: datetime,
    day_start: datetime,
    rows: list[MeterHour],
    has_meter: bool,
    forecast: ForecastOut | None,
) -> CostsOut:
    zone = site_zone(site.timezone)
    per_hour: dict[datetime, list[float]] = defaultdict(lambda: [0.0, 0.0])
    for row in rows:
        import_wh, export_wh = hour_energy(row)
        per_hour[row.hour][0] += import_wh
        per_hour[row.hour][1] += export_wh

    intervals = []
    for hour in sorted(per_hour):
        import_wh, export_wh = per_hour[hour]
        import_price = tariff.import_price(hour.astimezone(zone).hour)
        export_price = tariff.export_price
        intervals.append(
            CostInterval(
                start=hour,
                end=hour + timedelta(hours=1),
                import_wh=import_wh,
                export_wh=export_wh,
                import_price=import_price,
                export_price=export_price,
                cost=import_wh / 1000 * import_price - export_wh / 1000 * export_price,
            )
        )

    import_cost = sum(i.import_wh / 1000 * i.import_price for i in intervals)
    export_revenue = sum(i.export_wh / 1000 * i.export_price for i in intervals)
    cost = import_cost - export_revenue

    # Rest of today from the forecast: net load at the meter, battery ignored.
    projected = None
    day_end = day_start + timedelta(days=1)
    if has_meter and forecast is not None:
        projected = cost
        for interval in forecast.intervals:
            if interval.start >= day_end or interval.end <= now:
                continue
            if interval.load_w is None:
                projected = None
                break
            share = (interval.end - max(interval.start, now)).total_seconds() / 3600
            net_wh = (interval.load_w - (interval.solar_w or 0.0)) * share
            price = interval.import_price if net_wh > 0 else interval.export_price
            projected += net_wh / 1000 * price

    assumptions = [
        "Energy is measured at the grid meter: import from its energy counter, export from "
        "average power over each hour.",
        f"Prices: {tariff.name}; export earns {tariff.export_price:.2f} {tariff.currency}/kWh.",
        "Hours the meter did not report are missing, not estimated.",
    ]
    if projected is not None:
        assumptions.append(
            "Projected day: cost so far plus the forecast net load for the rest of today, "
            "ignoring the battery."
        )
    return CostsOut(
        site_id=site.id,
        timezone=site.timezone,
        currency=tariff.currency,
        tariff=tariff.name,
        day_start=day_start,
        as_of=now,
        has_meter=has_meter,
        intervals=intervals,
        import_wh=sum(i.import_wh for i in intervals),
        export_wh=sum(i.export_wh for i in intervals),
        import_cost=import_cost,
        export_revenue=export_revenue,
        cost=cost,
        projected_day_cost=projected,
        assumptions=assumptions,
    )
