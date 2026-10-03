"""Deterministic simulator for one site and one day.

Everything here is a pure function of its inputs: the same scenario and the same actions
always give the same result. The physics in `step()` never trusts a controller; every
limit (battery power and energy window, charger count, EV demand) is enforced there.

Units inside this package are kW and kWh. Convert to W / Wh at the API boundary.

Sign conventions (same as docs/contracts.md):
    solar_kw   >= 0  generating
    load_kw    >= 0  consuming
    battery_kw  > 0  charging,  < 0 discharging
    grid_kw     > 0  importing, < 0 exporting
    balance:   solar + grid = load + ev + battery
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Literal

import numpy as np
import numpy.typing as npt

FloatArray = npt.NDArray[np.float64]
BatteryMode = Literal["auto", "charge", "discharge", "idle"]

EPS = 1e-6


@dataclass(frozen=True)
class EV:
    id: str
    name: str
    arrive: int  # first step the car can charge
    depart: int  # step the car leaves (exclusive)
    need_kwh: float  # energy the car must receive before it leaves
    max_kw: float = 11.0
    # Optional "leaves early" event: from step `notice` on, everyone learns the new departure.
    notice: int | None = None
    new_depart: int | None = None

    def depart_known_at(self, t: int) -> int:
        """Departure as known to a controller at step t. Never reveals a future event."""
        if self.notice is not None and self.new_depart is not None and t >= self.notice:
            return self.new_depart
        return self.depart

    @property
    def depart_real(self) -> int:
        if self.notice is not None and self.new_depart is not None:
            return self.new_depart
        return self.depart


@dataclass(frozen=True)
class Battery:
    capacity_kwh: float = 30.0
    max_kw: float = 15.0
    efficiency: float = 0.95  # one way; round trip is efficiency squared
    soc_min: float = 0.10
    soc_max: float = 1.00
    soc_start: float = 0.30
    wear_eur_per_kwh: float = 0.02  # planning cost of moving 1 kWh through the battery


@dataclass(frozen=True, eq=False)
class Scenario:
    id: str
    name: str
    start: datetime  # timezone-aware instant of step 0
    step_minutes: int
    solar_forecast_kw: FloatArray
    solar_actual_kw: FloatArray
    load_kw: FloatArray  # inflexible load: lights, IT, HVAC
    price_buy: FloatArray  # EUR per kWh imported
    price_sell: FloatArray  # EUR per kWh exported
    battery: Battery
    evs: tuple[EV, ...]
    n_chargers: int = 3
    grid_limit_kw: float = 30.0  # contracted connection power
    ev_efficiency: float = 0.92
    missing_kwh_price: float = 0.60  # EUR per kWh a car leaves without (public fast charger)
    overload_penalty_eur: float = 5.0  # per step above the grid limit
    plan_margin_steps: int = 2  # the planner aims to finish every car this many steps early

    def __post_init__(self) -> None:
        if self.start.tzinfo is None:
            raise ValueError("Scenario.start must be timezone-aware")
        lengths = {
            len(self.solar_forecast_kw),
            len(self.solar_actual_kw),
            len(self.load_kw),
            len(self.price_buy),
            len(self.price_sell),
        }
        if len(lengths) != 1:
            raise ValueError("All scenario series must have the same number of steps")

    @property
    def steps(self) -> int:
        return len(self.load_kw)

    @property
    def dt_h(self) -> float:
        return self.step_minutes / 60.0

    def time_at(self, t: int) -> datetime:
        """UTC instant at which step t begins."""
        return (self.start + timedelta(minutes=self.step_minutes * t)).astimezone(UTC)


@dataclass(frozen=True)
class State:
    t: int
    battery_kwh: float
    ev_kwh: dict[str, float]  # energy delivered into each car so far


@dataclass(frozen=True)
class Action:
    battery_kw: float = 0.0  # > 0 charge, < 0 discharge
    ev_kw: dict[str, float] = field(default_factory=dict)  # at most n_chargers cars


@dataclass(frozen=True)
class StepResult:
    t: int
    time: datetime
    solar_kw: float
    load_kw: float
    ev_kw: float
    ev_by_car: dict[str, float]
    battery_kw: float
    grid_kw: float
    battery_soc_pct: float
    cost_eur: float
    overload: bool


@dataclass(frozen=True)
class Score:
    total_eur: float
    grid_import_kwh: float
    grid_export_kwh: float
    peak_kw: float
    solar_kwh: float
    solar_used_pct: float
    battery_cycles: float
    evs_ready: int
    evs_total: int
    missing_kwh: float
    missed: tuple[str, ...]
    overload_steps: int


@dataclass(frozen=True)
class RunResult:
    timeline: list[StepResult]
    score: Score


Controller = Callable[[Scenario, State], Action]


def initial_state(s: Scenario) -> State:
    return State(0, s.battery.capacity_kwh * s.battery.soc_start, {e.id: 0.0 for e in s.evs})


def ev_remaining(st: State, e: EV) -> float:
    return max(0.0, e.need_kwh - st.ev_kwh[e.id])


def ev_present(e: EV, t: int) -> bool:
    return e.arrive <= t < e.depart_real


def battery_feasible(s: Scenario, st: State, want_kw: float) -> float:
    """What the battery can really do this step when asked for `want_kw`."""
    b, dt = s.battery, s.dt_h
    bat = float(np.clip(want_kw, -b.max_kw, b.max_kw))
    lo, hi = b.capacity_kwh * b.soc_min, b.capacity_kwh * b.soc_max
    if bat > 0:
        bat = min(bat, max(0.0, hi - st.battery_kwh) / (b.efficiency * dt))
    else:
        bat = -min(-bat, max(0.0, st.battery_kwh - lo) * b.efficiency / dt)
    return 0.0 if abs(bat) < 1e-9 else bat


def step(s: Scenario, st: State, a: Action) -> tuple[State, StepResult]:
    """Apply one action and advance one step. Every physical limit is enforced here."""
    if not 0 <= st.t < s.steps:
        raise ValueError("The scenario has no step to simulate")
    t, dt, b = st.t, s.dt_h, s.battery

    ev_kw: dict[str, float] = {}
    for e in s.evs:
        p = float(a.ev_kw.get(e.id, 0.0))
        if p <= EPS or not ev_present(e, t) or len(ev_kw) >= s.n_chargers:
            continue
        p = min(p, e.max_kw, ev_remaining(st, e) / (dt * s.ev_efficiency))
        if p > EPS:
            ev_kw[e.id] = p
    ev_total = sum(ev_kw.values())

    bat = battery_feasible(s, st, a.battery_kw)
    stored = bat * b.efficiency * dt if bat > 0 else bat / b.efficiency * dt
    new_kwh = st.battery_kwh + stored

    solar, load = float(s.solar_actual_kw[t]), float(s.load_kw[t])
    grid = load + ev_total + bat - solar
    imported, exported = max(grid, 0.0), max(-grid, 0.0)

    new_ev = dict(st.ev_kwh)
    for car, p in ev_kw.items():
        new_ev[car] += p * dt * s.ev_efficiency

    result = StepResult(
        t=t,
        time=s.time_at(t),
        solar_kw=solar,
        load_kw=load,
        ev_kw=ev_total,
        ev_by_car=ev_kw,
        battery_kw=bat,
        grid_kw=grid,
        battery_soc_pct=100.0 * new_kwh / b.capacity_kwh,
        cost_eur=(imported * float(s.price_buy[t]) - exported * float(s.price_sell[t])) * dt,
        overload=imported > s.grid_limit_kw + EPS,
    )
    return State(t + 1, new_kwh, new_ev), result


def limit_guard(s: Scenario, st: State, battery_kw: float, ev_kw: dict[str, float]) -> Action:
    """Keep the import under the connection limit: the battery helps first, then cars slow down."""
    t = st.t
    bat = battery_feasible(s, st, battery_kw)
    over = (
        float(s.load_kw[t])
        + sum(ev_kw.values())
        + bat
        - float(s.solar_actual_kw[t])
        - s.grid_limit_kw
    )
    if over > 0:
        new_bat = battery_feasible(s, st, bat - over)
        over -= bat - new_bat
        bat = new_bat
    if over > 1e-9 and ev_kw:
        total = sum(ev_kw.values())
        scale = max(0.0, total - over) / total
        ev_kw = {car: p * scale for car, p in ev_kw.items()}
    return Action(battery_kw=bat, ev_kw=ev_kw)


def baseline(s: Scenario, st: State) -> Action:
    """No energy management: first come first served at full power, self-consumption battery."""
    t = st.t
    waiting = sorted(
        (e for e in s.evs if ev_present(e, t) and ev_remaining(st, e) > EPS),
        key=lambda e: e.arrive,
    )
    ev_kw = {e.id: e.max_kw for e in waiting[: s.n_chargers]}
    solar, load = float(s.solar_actual_kw[t]), float(s.load_kw[t])
    # Static load management that ordinary chargers already have: stay under the connection.
    room = s.grid_limit_kw + solar - load
    total = sum(ev_kw.values())
    if room <= 0:
        ev_kw = {}
    elif total > room:
        ev_kw = {car: p * room / total for car, p in ev_kw.items()}
    surplus = solar - load - sum(ev_kw.values())
    return Action(battery_kw=surplus, ev_kw=ev_kw)


def player_action(
    s: Scenario, st: State, battery: BatteryMode = "auto", cars: Sequence[str] = ()
) -> Action:
    """Turn a person's choices into an Action. `cars` are the ids plugged in right now."""
    t = st.t
    by_id = {e.id: e for e in s.evs}
    ev_kw = {
        car: by_id[car].max_kw
        for car in list(cars)[: s.n_chargers]
        if car in by_id and ev_present(by_id[car], t) and ev_remaining(st, by_id[car]) > EPS
    }
    if battery == "charge":
        bat = s.battery.max_kw
    elif battery == "discharge":
        bat = -s.battery.max_kw
    elif battery == "idle":
        bat = 0.0
    else:
        bat = float(s.solar_actual_kw[t]) - float(s.load_kw[t]) - sum(ev_kw.values())
    return limit_guard(s, st, bat, ev_kw)


def run(s: Scenario, controller: Controller) -> RunResult:
    st, timeline = initial_state(s), []
    for _ in range(s.steps):
        st, result = step(s, st, controller(s, st))
        timeline.append(result)
    return RunResult(timeline=timeline, score=score(s, st, timeline))


def score(s: Scenario, st: State, timeline: Sequence[StepResult]) -> Score:
    """One formula for every controller, so runs of the same scenario are comparable."""
    dt, b = s.dt_h, s.battery
    imported = sum(max(r.grid_kw, 0.0) for r in timeline) * dt
    exported = sum(max(-r.grid_kw, 0.0) for r in timeline) * dt
    solar = sum(r.solar_kw for r in timeline) * dt
    energy_cost = sum(r.cost_eur for r in timeline)
    # Final state of charge differs between runs: value the difference at the average price.
    stored_value = (st.battery_kwh - b.capacity_kwh * b.soc_start) * float(np.mean(s.price_buy))
    missing = {e.name: ev_remaining(st, e) for e in s.evs if ev_remaining(st, e) > 0.05}
    missing_kwh = sum(missing.values())
    overloads = sum(1 for r in timeline if r.overload)
    throughput = sum(abs(r.battery_kw) for r in timeline) * dt
    total = (
        energy_cost
        - stored_value
        + missing_kwh * s.missing_kwh_price
        + overloads * s.overload_penalty_eur
    )
    return Score(
        total_eur=round(total, 2),
        grid_import_kwh=round(imported, 1),
        grid_export_kwh=round(exported, 1),
        peak_kw=round(max((max(r.grid_kw, 0.0) for r in timeline), default=0.0), 1),
        solar_kwh=round(solar, 1),
        solar_used_pct=round(100 * (1 - exported / solar), 1) if solar > 0 else 0.0,
        battery_cycles=round(throughput / (2 * b.capacity_kwh), 2),
        evs_ready=len(s.evs) - len(missing),
        evs_total=len(s.evs),
        missing_kwh=round(missing_kwh, 1),
        missed=tuple(missing),
        overload_steps=overloads,
    )
