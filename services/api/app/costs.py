"""Today's energy cost from interval energy at the grid meter (issue #12).

Import energy comes from the meter's lifetime counter (energy_wh) where it is
consistent; otherwise, and for export, from average power over the covered part
of the hour. Never from a single instantaneous reading.
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
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
    hour: datetime  # start of the local hour, timezone-aware (fold set when summer time ends)
    min_energy_wh: float | None
    max_energy_wh: float | None
    first_energy_wh: float | None  # counter at the hour's first reading that has one
    last_energy_wh: float | None  # ... and at its last
    avg_import_w: float  # mean of max(power, 0)
    avg_export_w: float  # mean of max(-power, 0)
    first: datetime
    last: datetime


def hour_energy(row: MeterHour) -> tuple[float, float]:
    """(import_wh, export_wh) for one meter-hour."""
    covered_h = min((row.last - row.first + SAMPLE_PERIOD).total_seconds(), 3600) / 3600
    by_power = row.avg_import_w * covered_h
    # The counter resets when the device restarts (docs/contracts.md). A counter that
    # only rose starts at its minimum and ends at its maximum; anything else means a
    # reset inside the hour, and max - min would count the energy before it again.
    first, last = row.first_energy_wh, row.last_energy_wh
    if first is not None and last is not None:
        rose = first == row.min_energy_wh and last == row.max_energy_wh
        import_wh = last - first if rose else by_power
    else:
        import_wh = by_power
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
    # Keyed in UTC: in one zone, 03:00 summer time and 03:00 winter time compare equal.
    per_hour: dict[datetime, list[float]] = defaultdict(lambda: [0.0, 0.0])
    for row in rows:
        import_wh, export_wh = hour_energy(row)
        per_hour[row.hour.astimezone(UTC)][0] += import_wh
        per_hour[row.hour.astimezone(UTC)][1] += export_wh

    intervals = []
    for hour in sorted(per_hour):
        import_wh, export_wh = per_hour[hour]
        start = hour.astimezone(zone)
        import_price = tariff.import_price(start.hour)
        export_price = tariff.export_price
        intervals.append(
            CostInterval(
                start=start,
                end=(hour + timedelta(hours=1)).astimezone(zone),
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
            # In UTC: two times in the same zone subtract as wall-clock times, which gives 0 h
            # for the repeated hour when summer time ends.
            begin = max(interval.start, now).astimezone(UTC)
            share = (interval.end.astimezone(UTC) - begin).total_seconds() / 3600
            net_wh = (interval.load_w - (interval.solar_w or 0.0)) * share
            price = interval.import_price if net_wh > 0 else interval.export_price
            projected += net_wh / 1000 * price

    assumptions = [
        "Енергията се измерва на електромера към мрежата: взетата от мрежата — по брояча му "
        "на енергия (при липса или нулиране — по средната мощност), отдадената — по средната "
        "мощност за всеки час.",
        f"Цени: {tariff.name}; отдадената енергия се изкупува по "
        f"{tariff.format_price(tariff.export_price)}.",
        "Часовете, за които електромерът не е изпратил данни, липсват и не се оценяват.",
    ]
    if tariff.note:
        assumptions.append(tariff.note)
    if not has_meter:
        assumptions.append("Обектът няма електромер към мрежата, затова разходът не се измерва.")
    if projected is not None:
        assumptions.append(
            "Очакван разход за деня: разходът досега плюс прогнозното нетно потребление до "
            "края на деня, без батерията."
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
