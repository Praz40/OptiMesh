"""Rule-based recommendations for Assist mode.

Each recommendation is one concrete command for one online device, with the
reason and a rough saving, so the user can judge it before applying it. Rules
only use the live snapshot, the tariff and the forecast. A recommendation is a
proposal: nothing here sends commands.

Titles and details are shown verbatim in the dashboard, so they are Bulgarian.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from app.platform import InvalidRequest, validate_command
from app.schemas import (
    Capability,
    CommandType,
    DeviceKind,
    DeviceLive,
    DeviceOut,
    ForecastOut,
    PowerSetpointCommand,
    PowerSetpointParams,
    Recommendation,
    SiteSnapshot,
    SwitchCommand,
    SwitchParams,
)
from app.tariff import Tariff

# Thresholds, W. Below these the effect is noise rather than a decision.
SURPLUS_W = 500.0
IMPORT_W = 500.0
MIN_CHANGE_W = 500.0
# A later hour is "cheaper" when it saves at least this much per kWh.
CHEAPER_BY = 0.05
EXPENSIVE = 0.28
MAX_RECOMMENDATIONS = 5


@dataclass(frozen=True)
class Context:
    snapshot: SiteSnapshot
    tariff: Tariff
    forecast: ForecastOut
    now: datetime

    @property
    def grid_w(self) -> float | None:
        return self.snapshot.site.summary.grid_w

    @property
    def price_now(self) -> float:
        return self.forecast.intervals[0].import_price

    @property
    def export_w(self) -> float:
        grid = self.grid_w
        return -grid if grid is not None and grid < 0 else 0.0

    @property
    def import_w(self) -> float:
        grid = self.grid_w
        return grid if grid is not None and grid > 0 else 0.0

    def cheaper_later(self) -> tuple[datetime, float] | None:
        """First upcoming hour that is clearly cheaper, counting solar surplus as free-ish."""
        for interval in self.forecast.intervals[1:]:
            surplus = (interval.solar_w or 0.0) - (interval.load_w or 0.0)
            price = interval.export_price if surplus > 1000 else interval.import_price
            if price <= self.price_now - CHEAPER_BY:
                return interval.start, price
        return None

    def average_import_price(self) -> float:
        prices = [i.import_price for i in self.forecast.intervals]
        return sum(prices) / len(prices)


def _round_w(watts: float) -> float:
    return round(watts / 100) * 100


def _kw(watts: float) -> str:
    return f"{watts / 1000:.1f} kW".replace(".", ",")


def _price(context: Context, price: float) -> str:
    return context.tariff.format_price(price)


def _clock(context: Context, moment: datetime) -> str:
    return moment.astimezone(context.forecast.intervals[0].start.tzinfo).strftime("%H:%M")


Rule = Callable[[Context, DeviceOut, DeviceLive], Recommendation | None]


def _recommendation(
    context: Context,
    rule: str,
    device: DeviceOut,
    command: SwitchCommand | PowerSetpointCommand,
    title: str,
    detail: str,
    saving_per_hour: float,
) -> Recommendation | None:
    try:
        validate_command(device, command)
    except InvalidRequest:
        return None  # never propose something the API would refuse
    return Recommendation(
        id=f"{rule}:{device.id}",
        rule=rule,
        device_id=device.id,
        device_name=device.name,
        title=title,
        detail=detail,
        action=command,
        saving_per_hour=round(max(saving_per_hour, 0.0), 2),
        currency=context.tariff.currency,
    )


def absorb_surplus_with_ev(
    context: Context, device: DeviceOut, live: DeviceLive
) -> Recommendation | None:
    """Exporting while an EV charger is limited: raise its limit to soak up the surplus."""
    if device.kind != DeviceKind.EV_CHARGER or context.export_w < SURPLUS_W:
        return None
    state = live.state
    limit = device.limits.max_power_w
    if state is None or not state.on or state.setpoint_w is None or limit is None:
        return None
    target = min(limit, _round_w(state.setpoint_w + context.export_w))
    if target - state.setpoint_w < MIN_CHANGE_W:
        return None
    gain_w = target - state.setpoint_w
    value = context.average_import_price() - context.tariff.export_price
    return _recommendation(
        context,
        "absorb-surplus",
        device,
        PowerSetpointCommand(
            type=CommandType.POWER_SETPOINT, params=PowerSetpointParams(power_w=target)
        ),
        f"Увеличете „{device.name}“ до {_kw(target)}",
        f"{_kw(context.export_w)} слънчева енергия се отдава към мрежата по "
        f"{_price(context, context.tariff.export_price)}. Ако колата се зарежда с нея, "
        "няма да се налага тази енергия да се купува обратно по-късно.",
        gain_w / 1000 * value,
    )


def defer_ev_charging(
    context: Context, device: DeviceOut, live: DeviceLive
) -> Recommendation | None:
    """Importing at a high price while an EV charges: slow it until a cheaper hour."""
    if device.kind != DeviceKind.EV_CHARGER or context.import_w < IMPORT_W:
        return None
    power = live.metrics.power_w if live.metrics else None
    minimum = device.limits.min_power_w or 0.0
    later = context.cheaper_later()
    if power is None or later is None or power - minimum < MIN_CHANGE_W or minimum <= 0:
        return None
    start, later_price = later
    return _recommendation(
        context,
        "defer-ev",
        device,
        PowerSetpointCommand(
            type=CommandType.POWER_SETPOINT, params=PowerSetpointParams(power_w=minimum)
        ),
        f"Забавете „{device.name}“ до {_clock(context, start)}",
        f"Енергията от мрежата струва {_price(context, context.price_now)} сега и около "
        f"{_price(context, later_price)} от {_clock(context, start)}. При {_kw(minimum)} "
        "колата продължава да се зарежда; увеличете мощността отново по-късно.",
        (power - minimum) / 1000 * (context.price_now - later_price),
    )


def pause_boiler_at_peak(
    context: Context, device: DeviceOut, live: DeviceLive
) -> Recommendation | None:
    """A boiler heating on expensive grid energy can usually wait."""
    if device.kind != DeviceKind.BOILER or context.import_w < IMPORT_W:
        return None
    power = live.metrics.power_w if live.metrics else None
    later = context.cheaper_later()
    if not (live.state and live.state.on) or not power or later is None:
        return None
    if context.price_now < EXPENSIVE:
        return None
    start, later_price = later
    return _recommendation(
        context,
        "pause-boiler",
        device,
        SwitchCommand(type=CommandType.SWITCH, params=SwitchParams(on=False)),
        f"Изключете „{device.name}“ до {_clock(context, start)}",
        f"Уредът взема {_kw(power)} от мрежата при пикова цена "
        f"({_price(context, context.price_now)}). Топлата вода в бойлера стига за кратка пауза.",
        power / 1000 * (context.price_now - later_price),
    )


def run_load_on_surplus(
    context: Context, device: DeviceOut, live: DeviceLive
) -> Recommendation | None:
    """A switched-off deferrable load while solar is being exported: run it now."""
    if device.kind not in (DeviceKind.SMART_PLUG, DeviceKind.LOAD):
        return None
    rated = device.limits.max_power_w
    if rated is None or Capability.SWITCH not in device.capabilities:
        return None
    if live.state is None or live.state.on is not False or context.export_w < rated * 0.5:
        return None
    covered = min(context.export_w, rated)
    value = context.average_import_price() - context.tariff.export_price
    return _recommendation(
        context,
        "run-on-surplus",
        device,
        SwitchCommand(type=CommandType.SWITCH, params=SwitchParams(on=True)),
        f"Включете „{device.name}“ сега",
        f"{_kw(context.export_w)} слънчева енергия се отдава към мрежата. Ако уредът работи "
        "сега, използва нея вместо енергия от мрежата по-късно.",
        covered / 1000 * value,
    )


def trim_hvac_at_peak(
    context: Context, device: DeviceOut, live: DeviceLive
) -> Recommendation | None:
    """Expensive import with HVAC near full power: trim its limit for the peak hours."""
    if device.kind != DeviceKind.HVAC or context.import_w < IMPORT_W:
        return None
    if context.price_now < EXPENSIVE or live.state is None or not live.state.on:
        return None
    setpoint = live.state.setpoint_w
    minimum = device.limits.min_power_w or 0.0
    if setpoint is None:
        return None
    target = max(minimum, _round_w(setpoint * 0.75))
    if setpoint - target < MIN_CHANGE_W:
        return None
    return _recommendation(
        context,
        "trim-hvac",
        device,
        PowerSetpointCommand(
            type=CommandType.POWER_SETPOINT, params=PowerSetpointParams(power_w=target)
        ),
        f"Ограничете „{device.name}“ до {_kw(target)} през пика",
        f"Енергията от мрежата струва {_price(context, context.price_now)} до края на "
        "вечерния пик. Сградата задържа температурата си известно време при по-ниска мощност "
        "на климатизацията.",
        (setpoint - target) / 1000 * context.price_now,
    )


RULES: tuple[Rule, ...] = (
    absorb_surplus_with_ev,
    run_load_on_surplus,
    defer_ev_charging,
    pause_boiler_at_peak,
    trim_hvac_at_peak,
)


def recommend(
    snapshot: SiteSnapshot, tariff: Tariff, forecast: ForecastOut, now: datetime
) -> list[Recommendation]:
    if not forecast.intervals:
        return []
    context = Context(snapshot, tariff, forecast, now)
    live = {item.device_id: item for item in snapshot.live}
    found = []
    for device in snapshot.devices:
        reading = live.get(device.id)
        if reading is None or not reading.online:
            continue  # never propose commands for a device that cannot answer
        for rule in RULES:
            recommendation = rule(context, device, reading)
            if recommendation is not None:
                found.append(recommendation)
                break  # one proposal per device
    found.sort(key=lambda r: r.saving_per_hour, reverse=True)
    return found[:MAX_RECOMMENDATIONS]
