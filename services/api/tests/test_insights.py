"""Tariff, forecast, costs, recommendations and their routes, without a database (issue #12).

Every test fixes `now`, so none depends on the wall-clock hour or on local midnight.
Demo day: Sunday 2026-10-04 in Europe/Sofia (summer time, UTC+3); demo 10:00,
semi-final 13:00, final 15:00.
"""

from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app import insights
from app.config import Settings
from app.costs import SAMPLE_PERIOD, MeterHour, build_costs, hour_energy
from app.forecast import HORIZON_HOURS, build_forecast
from app.main import create_app
from app.platform import NotFound, validate_command
from app.recommendations import MAX_RECOMMENDATIONS, recommend
from app.schemas import (
    Capability,
    DeviceKind,
    DeviceLimits,
    DeviceLive,
    DeviceOut,
    DeviceSource,
    DeviceState,
    ForecastInterval,
    ForecastOut,
    Metrics,
    Recommendation,
    SiteOut,
    SiteSnapshot,
    SiteSummary,
)
from app.tariff import DEFAULT_TARIFF, Tariff

SOFIA = ZoneInfo("Europe/Sofia")
DEMO_DAY = date(2026, 10, 4)
SITE_ID = UUID("5e000000-0000-4000-8000-0000000000aa")
FLAT = Tariff(
    name="Единна тарифа (тест)", currency="EUR", import_bands=((0, 0.2),), export_price=0.06
)

C = Capability
METER = [C.MEASURE_POWER, C.MEASURE_ENERGY]
CHARGER = [C.MEASURE_POWER, C.CHARGING, C.SWITCH, C.POWER_SETPOINT]
SWITCHED = [C.MEASURE_POWER, C.SWITCH]


def local(hour: int, minute: int = 0, day: date = DEMO_DAY) -> datetime:
    return datetime.combine(day, time(hour, minute), SOFIA)


def device(
    kind: DeviceKind, name: str, capabilities: list[Capability], **limits: float
) -> DeviceOut:
    return DeviceOut(
        id=uuid4(),
        site_id=SITE_ID,
        name=name,
        kind=kind,
        source=DeviceSource.SIMULATOR,
        capabilities=capabilities,
        limits=DeviceLimits(**limits),
    )


def grid_meter() -> DeviceOut:
    return device(DeviceKind.GRID_METER, "Grid meter", METER)


def inverter(max_power_w: float) -> DeviceOut:
    return device(DeviceKind.SOLAR_INVERTER, "Solar", METER, max_power_w=max_power_w)


def charger(capabilities: list[Capability] = CHARGER) -> DeviceOut:
    return device(
        DeviceKind.EV_CHARGER, "EV charger 1", capabilities, min_power_w=1400, max_power_w=11000
    )


def plug(name: str = "Washing machine plug", max_power_w: float = 2000) -> DeviceOut:
    return device(DeviceKind.SMART_PLUG, name, SWITCHED, max_power_w=max_power_w)


def boiler(capabilities: list[Capability] = SWITCHED) -> DeviceOut:
    return device(DeviceKind.BOILER, "Water boiler", capabilities, max_power_w=2000)


def hvac() -> DeviceOut:
    return device(
        DeviceKind.HVAC,
        "HVAC",
        [C.MEASURE_POWER, C.SWITCH, C.POWER_SETPOINT],
        min_power_w=2000,
        max_power_w=15000,
    )


def live(
    item: DeviceOut,
    power: float | None = None,
    on: bool | None = None,
    setpoint: float | None = None,
    online: bool = True,
) -> DeviceLive:
    has_state = on is not None or setpoint is not None
    return DeviceLive(
        device_id=item.id,
        online=online,
        observed_at=None,
        received_at=None,
        metrics=Metrics(power_w=power) if power is not None else None,
        state=DeviceState(on=on, setpoint_w=setpoint) if has_state else None,
    )


def site(
    grid_w: float | None = None,
    consumption_w: float | None = None,
    timezone: str = "Europe/Sofia",
) -> SiteOut:
    summary = SiteSummary(
        solar_w=None,
        grid_w=grid_w,
        battery_w=None,
        battery_soc_pct=None,
        ev_w=None,
        loads_w=None,
        consumption_w=consumption_w,
        unmeasured_w=None,
        devices_online=0,
        devices_total=0,
        updated_at=None,
    )
    return SiteOut(id=SITE_ID, name="Test", timezone=timezone, currency="EUR", summary=summary)


def snapshot(
    readings: list[tuple[DeviceOut, DeviceLive | None]],
    grid_w: float | None = None,
    consumption_w: float | None = None,
) -> SiteSnapshot:
    return SiteSnapshot(
        site=site(grid_w, consumption_w),
        devices=[item for item, _ in readings],
        live=[reading for _, reading in readings if reading is not None],
    )


def advise(
    now: datetime,
    grid_w: float,
    *readings: tuple[DeviceOut, DeviceLive | None],
    tariff: Tariff = DEFAULT_TARIFF,
    consumption_w: float | None = None,
) -> list[Recommendation]:
    snap = snapshot(list(readings), grid_w, consumption_w)
    forecast = build_forecast(snap.site, snap.devices, tariff, now, {})
    found = recommend(snap, tariff, forecast, now)
    by_id = {item.id: item for item in snap.devices}
    for recommendation in found:
        # Never a command the API would refuse.
        validate_command(by_id[recommendation.device_id], recommendation.action)
    return found


def rules(found: list[Recommendation]) -> list[str]:
    return [r.rule for r in found]


# --- tariff ----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("hour", "price"),
    [
        (0, 0.11),
        (6.99, 0.11),
        (7, 0.19),
        (10.99, 0.19),
        (11, 0.13),
        (14.99, 0.13),
        (15, 0.21),
        (16.99, 0.21),
        (17, 0.32),
        (20.99, 0.32),
        (21, 0.14),
        (23.99, 0.14),
    ],
)
def test_default_tariff_band_edges(hour: float, price: float) -> None:
    assert DEFAULT_TARIFF.import_price(hour) == price


def test_tariff_text_is_bulgarian_and_admits_it_is_invented() -> None:
    assert DEFAULT_TARIFF.name == "Демо тарифа по часови зони"
    assert "измислена" in DEFAULT_TARIFF.note
    assert DEFAULT_TARIFF.format_price(0.32) == "0,32 EUR/kWh"


# --- hour_energy -----------------------------------------------------------------


def meter_hour(
    *,
    energy: tuple[float, float, float, float] | None = None,
    import_w: float = 0.0,
    export_w: float = 0.0,
    minutes: int = 60,
    hour: datetime | None = None,
    device_id: UUID | None = None,
) -> MeterHour:
    """`energy` = (first, min, max, last) counter values in the hour."""
    begin = hour or local(10)
    first, low, high, last = energy if energy is not None else (None, None, None, None)
    return MeterHour(
        device_id=device_id or uuid4(),
        hour=begin,
        min_energy_wh=low,
        max_energy_wh=high,
        first_energy_wh=first,
        last_energy_wh=last,
        avg_import_w=import_w,
        avg_export_w=export_w,
        first=begin,
        last=begin + timedelta(minutes=minutes) - SAMPLE_PERIOD,
    )


def test_hour_energy_uses_the_counter_when_it_only_rose() -> None:
    row = meter_hour(energy=(1000, 1000, 1600, 1600), import_w=5000)
    assert hour_energy(row) == (600, 0)


def test_hour_energy_falls_back_to_power_after_a_counter_reset() -> None:
    # 5000 -> 5400, device restarts, 0 -> 200: max - min would claim 5400 Wh.
    row = meter_hour(energy=(5000, 0, 5400, 200), import_w=1200)
    assert hour_energy(row) == (1200, 0)


def test_hour_energy_without_counter_uses_power_over_the_covered_part_of_the_hour() -> None:
    row = meter_hour(import_w=2000, export_w=400, minutes=15)
    assert hour_energy(row) == pytest.approx((500, 100))


def test_hour_energy_never_counts_more_than_one_hour() -> None:
    row = meter_hour(import_w=1000, minutes=90)
    assert hour_energy(row) == (1000, 0)


# --- build_costs -----------------------------------------------------------------


def costs_for(
    rows: list[MeterHour],
    now: datetime,
    *,
    tariff: Tariff = DEFAULT_TARIFF,
    has_meter: bool = True,
    forecast: ForecastOut | None = None,
):
    day_start = now.astimezone(SOFIA).replace(hour=0, minute=0, second=0, microsecond=0)
    return build_costs(site(), tariff, now, day_start, rows, has_meter, forecast)


def test_costs_price_imported_and_exported_energy_per_hour() -> None:
    meter = uuid4()
    rows = [
        meter_hour(device_id=meter, hour=local(10), energy=(0, 0, 2000, 2000), import_w=2000),
        meter_hour(device_id=meter, hour=local(12), energy=(2000, 2000, 2000, 2000), export_w=3000),
    ]
    costs = costs_for(rows, local(12, 59))
    assert [(i.start, i.import_wh, i.export_wh) for i in costs.intervals] == [
        (local(10), 2000, 0),
        (local(12), 0, 3000),
    ]
    assert [i.import_price for i in costs.intervals] == [0.19, 0.13]
    assert costs.intervals[0].cost == pytest.approx(0.38)
    assert costs.intervals[1].cost == pytest.approx(-0.18)
    assert (costs.import_wh, costs.export_wh) == (2000, 3000)
    assert costs.import_cost == pytest.approx(0.38)
    assert costs.export_revenue == pytest.approx(0.18)
    assert costs.cost == pytest.approx(0.20)
    assert costs.tariff == DEFAULT_TARIFF.name and costs.currency == "EUR"
    assert costs.day_start == local(0) and costs.timezone == "Europe/Sofia"


def test_costs_add_up_several_meters_in_the_same_hour() -> None:
    rows = [
        meter_hour(energy=(0, 0, 1000, 1000)),
        meter_hour(energy=(50, 50, 550, 550)),
    ]
    costs = costs_for(rows, local(11))
    assert [i.import_wh for i in costs.intervals] == [1500]


def forecast_of(now: datetime, *hours: tuple[float | None, float | None]) -> ForecastOut:
    """Hand-made forecast from the start of `now`'s local hour: (load_w, solar_w) per hour."""
    start = now.astimezone(SOFIA).replace(minute=0).astimezone(UTC)
    intervals = []
    for i, (load, solar) in enumerate(hours):
        begin = start + timedelta(hours=i)
        intervals.append(
            ForecastInterval(
                start=begin.astimezone(SOFIA),
                end=(begin + timedelta(hours=1)).astimezone(SOFIA),
                solar_w=solar,
                load_w=load,
                import_price=DEFAULT_TARIFF.import_price(begin.astimezone(SOFIA).hour),
                export_price=DEFAULT_TARIFF.export_price,
            )
        )
    return ForecastOut(
        site_id=SITE_ID,
        timezone="Europe/Sofia",
        currency="EUR",
        tariff=DEFAULT_TARIFF.name,
        generated_at=now,
        interval_minutes=60,
        intervals=intervals,
        assumptions=[],
    )


def test_projected_day_adds_the_forecast_net_load_for_the_rest_of_today() -> None:
    now = local(21, 30)
    rows = [meter_hour(hour=local(10), energy=(0, 0, 1000, 1000))]  # 0.19 so far
    forecast = forecast_of(
        now,
        (1000, 3000),  # 21:30-22:00: exports 1000 Wh at 0.06
        (2000, None),  # 22-23: 2000 Wh at 0.14
        (1000, None),  # 23-24: 1000 Wh at 0.14
        (5000, None),  # tomorrow: ignored
    )
    costs = costs_for(rows, now, forecast=forecast)
    assert costs.projected_day_cost == pytest.approx(0.19 - 0.06 + 0.28 + 0.14)
    assert any("Очакван разход" in a for a in costs.assumptions)


def test_projected_day_is_unknown_when_a_forecast_hour_has_no_load() -> None:
    now = local(22, 0)
    forecast = forecast_of(now, (1000, None), (None, None))
    assert costs_for([], now, forecast=forecast).projected_day_cost is None


def test_site_without_a_meter_has_no_cost_and_says_why() -> None:
    now = local(15)
    costs = costs_for([], now, has_meter=False, forecast=forecast_of(now, (1000, None)))
    assert costs.has_meter is False
    assert costs.intervals == [] and costs.cost == 0
    assert costs.projected_day_cost is None
    assert any("няма електромер" in a for a in costs.assumptions)


def test_projected_day_counts_the_repeated_hour_when_summer_time_ends() -> None:
    # 2026-10-25 has 25 hours in Sofia. From 01:00, 24 one-hour intervals end at midnight.
    now = local(1, day=date(2026, 10, 25))
    forecast = build_forecast(site(consumption_w=1000), [], FLAT, now, {})
    costs = costs_for([], now, tariff=FLAT, forecast=forecast)
    assert costs.projected_day_cost == pytest.approx(24 * 1.0 * 0.2)


# --- build_forecast --------------------------------------------------------------


def test_forecast_uses_history_where_it_exists_and_current_load_elsewhere() -> None:
    now = local(10, 20)
    forecast = build_forecast(
        site(consumption_w=1200), [grid_meter(), inverter(6000)], DEFAULT_TARIFF, now, {12: 800}
    )
    assert len(forecast.intervals) == HORIZON_HOURS
    assert forecast.intervals[0].start == local(10)
    loads = {i.start.hour: i.load_w for i in forecast.intervals}
    assert loads[12] == 800
    assert {load for hour, load in loads.items() if hour != 12} == {1200}
    assert forecast.timezone == "Europe/Sofia" and forecast.currency == "EUR"
    assert forecast.generated_at == now and forecast.interval_minutes == 60
    assert any("1 от 24 часа" in a and "23 са по текущата" in a for a in forecast.assumptions)
    assert DEFAULT_TARIFF.note in forecast.assumptions


def test_forecast_without_history_or_current_load_says_so() -> None:
    forecast = build_forecast(site(), [], DEFAULT_TARIFF, local(9), {})
    assert {i.load_w for i in forecast.intervals} == {None}
    assert any("за 24 няма данни" in a for a in forecast.assumptions)


def test_forecast_solar_follows_the_inverter_capacity() -> None:
    forecast = build_forecast(site(), [inverter(6000)], DEFAULT_TARIFF, local(0), {})
    solar = {i.start.hour: i.solar_w or 0.0 for i in forecast.intervals}
    assert solar[2] == 0 and solar[22] == 0
    assert 0 < max(solar.values()) <= 6000 * 0.85
    assert max(solar, key=lambda hour: solar[hour]) in (12, 13)
    assert any("6 kW инвертори" in a for a in forecast.assumptions)


def test_forecast_without_an_inverter_expects_no_solar() -> None:
    forecast = build_forecast(site(), [grid_meter()], DEFAULT_TARIFF, local(12), {})
    assert {i.solar_w for i in forecast.intervals} == {None}
    assert any("няма регистриран инвертор" in a for a in forecast.assumptions)


@pytest.mark.parametrize(
    ("day", "local_hours"),
    [
        # Summer time ends 04:00 -> 03:00: the local hour 3 occurs twice.
        (date(2026, 10, 25), [0, 1, 2, 3, 3, 4, 5]),
        # Summer time starts 03:00 -> 04:00: there is no local hour 3.
        (date(2026, 3, 29), [0, 1, 2, 4, 5, 6, 7]),
    ],
)
def test_forecast_neither_skips_nor_repeats_an_hour_on_a_dst_day(
    day: date, local_hours: list[int]
) -> None:
    forecast = build_forecast(site(consumption_w=500), [], DEFAULT_TARIFF, local(0, 30, day), {})
    starts = [i.start.astimezone(UTC) for i in forecast.intervals]
    ends = [i.end.astimezone(UTC) for i in forecast.intervals]
    assert len(set(starts)) == HORIZON_HOURS
    assert all(end - start == timedelta(hours=1) for start, end in zip(starts, ends, strict=True))
    assert starts[1:] == ends[:-1]
    assert [i.start.hour for i in forecast.intervals[:7]] == local_hours


# --- recommendations: each rule --------------------------------------------------


def test_absorb_surplus_raises_the_ev_limit_while_exporting() -> None:
    ev = charger()
    found = advise(local(13), -3000, (ev, live(ev, 1400, on=True, setpoint=1400)))
    assert rules(found) == ["absorb-surplus"]
    assert found[0].action.params.model_dump() == {"power_w": 4400}
    assert found[0].title == "Увеличете „EV charger 1“ до 4,4 kW"
    assert found[0].id == f"absorb-surplus:{ev.id}" and found[0].currency == "EUR"


def test_absorb_surplus_ignores_a_small_export_or_a_charger_at_its_limit() -> None:
    ev = charger()
    assert advise(local(13), -300, (ev, live(ev, 1400, on=True, setpoint=1400))) == []
    assert advise(local(13), -3000, (ev, live(ev, 11000, on=True, setpoint=11000))) == []


def test_run_on_surplus_switches_on_an_idle_plug() -> None:
    item = plug()
    found = advise(local(13), -1500, (item, live(item, 0, on=False)))
    assert rules(found) == ["run-on-surplus"]
    assert found[0].action.params.model_dump() == {"on": True}
    assert found[0].title == "Включете „Washing machine plug“ сега"
    assert found[0].detail.startswith("1,5 kW слънчева енергия се отдава към мрежата")


def test_run_on_surplus_needs_half_the_rated_power_and_an_idle_plug() -> None:
    item = plug()
    assert advise(local(13), -900, (item, live(item, 0, on=False))) == []
    assert advise(local(13), -3000, (item, live(item, 1800, on=True))) == []


def test_defer_ev_slows_charging_until_a_cheaper_hour() -> None:
    ev = charger()
    found = advise(local(17, 30), 5000, (ev, live(ev, 7400, on=True, setpoint=7400)))
    assert rules(found) == ["defer-ev"]
    assert found[0].action.params.model_dump() == {"power_w": 1400}
    assert found[0].title == "Забавете „EV charger 1“ до 21:00"
    assert "0,32 EUR/kWh сега" in found[0].detail
    assert found[0].saving_per_hour == pytest.approx(6 * (0.32 - 0.14))


def test_defer_ev_needs_a_cheaper_hour_and_room_to_slow_down() -> None:
    ev = charger()
    charging = live(ev, 7400, on=True, setpoint=7400)
    assert advise(local(17, 30), 5000, (ev, charging), tariff=FLAT) == []
    assert advise(local(17, 30), 5000, (ev, live(ev, 1400, on=True, setpoint=1400))) == []


def test_pause_boiler_at_the_evening_peak() -> None:
    item = boiler()
    found = advise(local(18), 3000, (item, live(item, 2000, on=True)))
    assert rules(found) == ["pause-boiler"]
    assert found[0].action.params.model_dump() == {"on": False}
    assert found[0].title == "Изключете „Water boiler“ до 21:00"


def test_pause_boiler_not_off_peak_or_when_it_is_off() -> None:
    item = boiler()
    assert advise(local(15), 3000, (item, live(item, 2000, on=True))) == []
    assert advise(local(18), 3000, (item, live(item, 0, on=False))) == []


def test_trim_hvac_at_the_evening_peak() -> None:
    unit = hvac()
    found = advise(local(18), 6000, (unit, live(unit, 10000, on=True, setpoint=10000)))
    assert rules(found) == ["trim-hvac"]
    assert found[0].action.params.model_dump() == {"power_w": 7500}
    assert found[0].title == "Ограничете „HVAC“ до 7,5 kW през пика"


def test_trim_hvac_not_off_peak_or_near_its_minimum() -> None:
    unit = hvac()
    assert advise(local(15), 6000, (unit, live(unit, 10000, on=True, setpoint=10000))) == []
    assert advise(local(18), 6000, (unit, live(unit, 2400, on=True, setpoint=2400))) == []


# --- recommendations: safety -----------------------------------------------------


def test_offline_or_silent_devices_get_no_recommendation() -> None:
    offline, silent = plug("Offline plug"), plug("Silent plug")
    found = advise(
        local(13), -5000, (offline, live(offline, 0, on=False, online=False)), (silent, None)
    )
    assert found == []


def test_never_more_than_five_recommendations_best_first() -> None:
    plugs = [plug(f"Plug {n}", max_power_w=1000 + 500 * n) for n in range(7)]
    found = advise(local(13), -10000, *[(item, live(item, 0, on=False)) for item in plugs])
    assert len(found) == MAX_RECOMMENDATIONS
    assert [r.device_name for r in found] == [f"Plug {n}" for n in (6, 5, 4, 3, 2)]
    savings = [r.saving_per_hour for r in found]
    assert savings == sorted(savings, reverse=True)


def test_a_command_the_api_would_reject_is_never_proposed() -> None:
    # A charger without power_setpoint cannot take the absorb-surplus setpoint.
    ev = charger([C.MEASURE_POWER, C.CHARGING, C.SWITCH])
    assert advise(local(13), -3000, (ev, live(ev, 1400, on=True, setpoint=1400))) == []
    # A boiler that cannot be switched cannot be paused.
    item = boiler([C.MEASURE_POWER])
    assert advise(local(18), 3000, (item, live(item, 2000, on=True))) == []


# --- which rules can fire at the demo times (10:00, 13:00, 15:00 Europe/Sofia) ---

DEMO_TIMES = [(hour, minute) for hour in (10, 13, 15) for minute in (0, 59)]


@pytest.mark.parametrize(("hour", "minute"), DEMO_TIMES)
def test_peak_price_rules_cannot_fire_at_demo_times(hour: int, minute: int) -> None:
    item, unit = boiler(), hvac()
    found = advise(
        local(hour, minute),
        8000,
        (item, live(item, 2000, on=True)),
        (unit, live(unit, 10000, on=True, setpoint=10000)),
    )
    assert found == []  # pause-boiler and trim-hvac need >= 0.28, only 17:00-21:00


@pytest.mark.parametrize(("hour", "minute"), DEMO_TIMES)
def test_surplus_rules_fire_at_demo_times(hour: int, minute: int) -> None:
    ev, item = charger(), plug()
    found = advise(
        local(hour, minute),
        -4000,
        (ev, live(ev, 1400, on=True, setpoint=1400)),
        (item, live(item, 0, on=False)),
    )
    assert sorted(rules(found)) == ["absorb-surplus", "run-on-surplus"]


@pytest.mark.parametrize(("hour", "until"), [(10, "11:00"), (15, "21:00")])
@pytest.mark.parametrize("minute", [0, 59])
def test_defer_ev_fires_at_10_and_15(hour: int, minute: int, until: str) -> None:
    ev = charger()
    found = advise(local(hour, minute), 5000, (ev, live(ev, 7400, on=True, setpoint=7400)))
    assert rules(found) == ["defer-ev"]
    assert found[0].title.endswith(f"до {until}")


@pytest.mark.parametrize("minute", [0, 59])
def test_defer_ev_at_13_only_with_a_forecast_solar_surplus(minute: int) -> None:
    # 13:00 costs 0.13; no import band is 0.05 cheaper, only a solar surplus hour is.
    ev = charger()
    charging = (ev, live(ev, 7400, on=True, setpoint=7400))
    assert advise(local(13, minute), 5000, charging, consumption_w=8000) == []
    big, small = inverter(30000), inverter(2000)
    found = advise(local(13, minute), 5000, charging, (big, live(big, 3000)), consumption_w=8000)
    assert rules(found) == ["defer-ev"] and found[0].title.endswith("до 14:00")
    poor = advise(local(13, minute), 5000, charging, (small, live(small, 1500)), consumption_w=8000)
    assert poor == []


# --- issue #12 criterion 3: flat tariff, variable tariff, poor solar ---------------


def test_scenario_flat_tariff() -> None:
    now = local(18)
    forecast = build_forecast(site(consumption_w=3000), [], FLAT, now, {})
    assert {i.import_price for i in forecast.intervals} == {0.2}
    rows = [
        meter_hour(hour=local(10), energy=(0, 0, 1000, 1000)),
        meter_hour(hour=local(17), energy=(1000, 1000, 2000, 2000)),
    ]
    assert [i.cost for i in costs_for(rows, now, tariff=FLAT).intervals] == [0.2, 0.2]
    # Nothing to shift to: no cheaper hour and never a peak price.
    ev, item, unit = charger(), boiler(), hvac()
    found = advise(
        now,
        9000,
        (ev, live(ev, 7400, on=True, setpoint=7400)),
        (item, live(item, 2000, on=True)),
        (unit, live(unit, 10000, on=True, setpoint=10000)),
        tariff=FLAT,
    )
    assert found == []


def test_scenario_variable_tariff() -> None:
    now = local(18)
    forecast = build_forecast(site(consumption_w=3000), [], DEFAULT_TARIFF, now, {})
    assert {i.import_price for i in forecast.intervals} == {0.11, 0.19, 0.13, 0.21, 0.32, 0.14}
    rows = [
        meter_hour(hour=local(10), energy=(0, 0, 1000, 1000)),
        meter_hour(hour=local(17), energy=(1000, 1000, 2000, 2000)),
    ]
    assert [i.cost for i in costs_for(rows, now).intervals] == [0.19, 0.32]
    ev, item, unit = charger(), boiler(), hvac()
    found = advise(
        now,
        9000,
        (ev, live(ev, 7400, on=True, setpoint=7400)),
        (item, live(item, 2000, on=True)),
        (unit, live(unit, 10000, on=True, setpoint=10000)),
    )
    assert sorted(rules(found)) == ["defer-ev", "pause-boiler", "trim-hvac"]


def test_scenario_poor_solar() -> None:
    now = local(11)
    rest_of_day = [(1000.0, None)] * 13
    without = build_forecast(site(consumption_w=1000), [grid_meter()], DEFAULT_TARIFF, now, {})
    small = build_forecast(
        site(consumption_w=1000), [grid_meter(), inverter(1000)], DEFAULT_TARIFF, now, {}
    )
    assert {i.solar_w for i in without.intervals} == {None}
    assert max(i.solar_w or 0 for i in small.intervals) <= 850
    # Without solar the projection buys every remaining kWh; a small inverter only trims it.
    expected = costs_for([], now, forecast=forecast_of(now, *rest_of_day)).projected_day_cost
    assert costs_for([], now, forecast=without).projected_day_cost == pytest.approx(expected)
    small_cost = costs_for([], now, forecast=small).projected_day_cost
    assert small_cost is not None and expected is not None and 0 < small_cost < expected
    # Nothing is exported, so no surplus recommendation.
    item = plug()
    assert advise(now, 300, (item, live(item, 0, on=False)), consumption_w=1000) == []


# --- insights: platform glue and the load profile cache --------------------------


class FakePlatform:
    """The three Platform reads insights.py uses, in memory."""

    def __init__(
        self,
        snap: SiteSnapshot,
        hourly: dict[UUID, dict[int, float]] | None = None,
        rows: list[MeterHour] | None = None,
    ) -> None:
        self.snap = snap
        self.hourly = hourly or {}
        self.rows = rows or []
        self.calls: list[tuple] = []

    def snapshot(self, site_id: UUID) -> SiteSnapshot:
        if site_id != self.snap.site.id:
            raise NotFound("Site not found")
        return self.snap

    def hourly_power(self, site_id: UUID, timezone: str, since: datetime):
        self.calls.append(("hourly_power", site_id, timezone, since))
        return self.hourly

    def meter_hours(self, site_id: UUID, device_ids: list[UUID], timezone: str, since: datetime):
        self.calls.append(("meter_hours", site_id, tuple(device_ids), timezone, since))
        return [row for row in self.rows if row.device_id in device_ids]


def test_load_profile_needs_every_balance_device_in_that_hour() -> None:
    grid, solar, battery, load = (
        grid_meter(),
        inverter(6000),
        device(DeviceKind.BATTERY, "Battery", [C.MEASURE_POWER]),
        plug(),
    )
    hourly = {
        grid.id: {9: 500.0, 10: -1000.0, 11: 0.0},
        solar.id: {10: 4000.0, 11: 0.0},
        battery.id: {10: 1000.0, 11: 300.0},
        load.id: {12: 2000.0},  # not part of the balance
    }
    profile = insights.load_profile(hourly, [grid, solar, battery, load])
    assert profile == {10: 2000.0, 11: 0.0}  # 11: -300 W clamps to 0; 9 lacks solar
    assert insights.load_profile(hourly, [solar, battery]) == {}  # no grid meter


def demo_site() -> tuple[FakePlatform, DeviceOut, DeviceOut, DeviceOut]:
    grid, solar, item = grid_meter(), inverter(6000), plug()
    snap = snapshot(
        [(grid, live(grid, -3000)), (solar, live(solar, 4000)), (item, live(item, 0, on=False))],
        grid_w=-3000,
        consumption_w=1000,
    )
    hourly = {grid.id: {10: -3000.0, 12: 500.0}, solar.id: {10: 4000.0, 12: 1500.0}}
    rows = [
        meter_hour(device_id=grid.id, hour=local(9), energy=(10000, 10000, 11000, 11000)),
        meter_hour(
            device_id=grid.id,
            hour=local(10),
            energy=(11000, 11000, 11000, 11000),
            export_w=3000,
            minutes=30,
        ),
    ]
    return FakePlatform(snap, hourly, rows), grid, solar, item


def test_insights_forecast_reads_a_week_of_history_in_the_site_timezone() -> None:
    platform, *_ = demo_site()
    now = local(10, 30)
    forecast = insights.forecast(platform, SITE_ID, now)  # type: ignore[arg-type]
    assert platform.calls == [("hourly_power", SITE_ID, "Europe/Sofia", now - timedelta(days=7))]
    loads = {i.start.hour: i.load_w for i in forecast.intervals}
    assert (loads[10], loads[12], loads[15]) == (1000, 2000, 1000)
    assert forecast.tariff == DEFAULT_TARIFF.name


@pytest.mark.parametrize("now", [local(0, 0), local(0, 30), local(23, 59)])
def test_insights_costs_start_at_local_midnight(now: datetime) -> None:
    platform, grid, *_ = demo_site()
    costs = insights.costs(platform, SITE_ID, now)  # type: ignore[arg-type]
    assert costs.day_start == local(0)
    assert ("meter_hours", SITE_ID, (grid.id,), "Europe/Sofia", local(0)) in platform.calls
    assert costs.has_meter is True


def test_insights_costs_for_a_site_without_a_meter() -> None:
    item = plug()
    platform = FakePlatform(snapshot([(item, live(item, 0, on=False))]))
    costs = insights.costs(platform, SITE_ID, local(12))  # type: ignore[arg-type]
    assert costs.has_meter is False and costs.intervals == []
    assert platform.calls == [("meter_hours", SITE_ID, (), "Europe/Sofia", local(0))]


def test_insights_recommendations_use_the_live_snapshot() -> None:
    platform, _, _, item = demo_site()
    found = insights.recommendations(platform, SITE_ID, local(10, 30))  # type: ignore[arg-type]
    assert [(r.rule, r.device_id) for r in found] == [("run-on-surplus", item.id)]


def test_insights_unknown_site_is_not_found() -> None:
    platform, *_ = demo_site()
    with pytest.raises(NotFound):
        insights.forecast(platform, uuid4(), local(10))  # type: ignore[arg-type]


def history_reads(platform: FakePlatform) -> int:
    return sum(1 for call in platform.calls if call[0] == "hourly_power")


def test_load_profile_is_cached_per_site_for_a_few_minutes() -> None:
    platform, *_ = demo_site()
    now = local(10)
    insights.forecast(platform, SITE_ID, now)  # type: ignore[arg-type]
    insights.costs(platform, SITE_ID, now + timedelta(minutes=1))  # type: ignore[arg-type]
    insights.recommendations(platform, SITE_ID, now + timedelta(minutes=4))  # type: ignore[arg-type]
    assert history_reads(platform) == 1
    insights.forecast(platform, SITE_ID, now + insights.PROFILE_TTL)  # type: ignore[arg-type]
    assert history_reads(platform) == 2
    # A clock that went backwards does not reuse a profile from its future.
    insights.forecast(platform, SITE_ID, now)  # type: ignore[arg-type]
    assert history_reads(platform) == 3


def test_load_profile_cache_is_per_platform_and_follows_device_changes() -> None:
    platform, *_ = demo_site()
    other, *_ = demo_site()
    now = local(10)
    insights.forecast(platform, SITE_ID, now)  # type: ignore[arg-type]
    insights.forecast(other, SITE_ID, now)  # type: ignore[arg-type]
    assert (history_reads(platform), history_reads(other)) == (1, 1)
    battery = device(DeviceKind.BATTERY, "Battery", [C.MEASURE_POWER])
    platform.snap = platform.snap.model_copy(update={"devices": [*platform.snap.devices, battery]})
    insights.forecast(platform, SITE_ID, now)  # type: ignore[arg-type]
    assert history_reads(platform) == 2


def test_site_without_a_grid_meter_never_queries_history() -> None:
    item = plug()
    platform = FakePlatform(snapshot([(item, live(item, 0, on=False))], consumption_w=500))
    forecast = insights.forecast(platform, SITE_ID, local(10))  # type: ignore[arg-type]
    assert platform.calls == []
    assert {i.load_w for i in forecast.intervals} == {500}


# --- routes ----------------------------------------------------------------------

ROUTES = ["forecast", "costs", "recommendations"]


@pytest.mark.parametrize("route", ROUTES)
def test_routes_answer_503_without_a_database(route: str) -> None:
    with TestClient(create_app(Settings(_env_file=None, database_url=None))) as client:
        response = client.get(f"/api/v1/sites/{uuid4()}/{route}")
    assert response.status_code == 503
    assert response.json() == {"detail": "Database unavailable"}


@pytest.fixture
def routed(monkeypatch: pytest.MonkeyPatch):
    """The real routes over the in-memory platform, at 10:30 on the demo day."""
    monkeypatch.setattr("app.api.utc_now", lambda: local(10, 30).astimezone(UTC))
    application = create_app(Settings(_env_file=None, database_url=None))
    platform, grid, solar, item = demo_site()
    application.state.platform = platform
    with TestClient(application) as client:
        yield client, item


def test_forecast_route(routed) -> None:
    client, _ = routed
    body = client.get(f"/api/v1/sites/{SITE_ID}/forecast").json()
    assert body["timezone"] == "Europe/Sofia" and body["currency"] == "EUR"
    assert body["generated_at"] == "2026-10-04T07:30:00Z"
    assert body["intervals"][0]["start"] == "2026-10-04T10:00:00+03:00"
    assert len(body["intervals"]) == 24 and len(body["assumptions"]) == 4


def test_costs_route(routed) -> None:
    client, _ = routed
    body = client.get(f"/api/v1/sites/{SITE_ID}/costs").json()
    assert body["day_start"] == "2026-10-04T00:00:00+03:00"
    assert [(i["import_wh"], i["export_wh"]) for i in body["intervals"]] == [(1000, 0), (0, 1500)]
    assert body["cost"] == pytest.approx(0.19 - 0.09)
    assert body["projected_day_cost"] is not None


def test_recommendations_route(routed) -> None:
    client, item = routed
    body = client.get(f"/api/v1/sites/{SITE_ID}/recommendations").json()
    assert [(r["rule"], r["device_id"]) for r in body] == [("run-on-surplus", str(item.id))]
    assert body[0]["action"] == {"type": "switch", "params": {"on": True}}


@pytest.mark.parametrize("route", ROUTES)
def test_routes_answer_404_for_an_unknown_site(routed, route: str) -> None:
    client, _ = routed
    response = client.get(f"/api/v1/sites/{uuid4()}/{route}")
    assert response.status_code == 404
    assert response.json() == {"detail": "Site not found"}
