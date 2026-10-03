"""Autopilot: rolling-horizon linear programme (model predictive control).

Every step it plans the rest of the day from the forecast, executes only the first step,
then measures again and re-plans. It never reads the future: `solar_actual_kw` is used
only for the current step, which a real controller can measure.
"""

import numpy as np
from scipy.optimize import linprog

from app.sim.core import (
    EPS,
    EV,
    Action,
    FloatArray,
    Scenario,
    State,
    baseline,
    ev_present,
    ev_remaining,
    limit_guard,
)


def solar_expectation(s: Scenario, t: int, perfect_foresight: bool = False) -> FloatArray:
    """Solar the planner assumes for steps t.. : measured now, forecast afterwards."""
    if perfect_foresight:
        return s.solar_actual_kw[t:].copy()
    solar = s.solar_forecast_kw[t:].copy()
    solar[0] = s.solar_actual_kw[t]
    # Nowcast: if the sky is darker or brighter than forecast right now, expect the same
    # for the next hour, fading back to the forecast.
    if s.solar_forecast_kw[t] > 0.5:
        ratio = float(np.clip(s.solar_actual_kw[t] / s.solar_forecast_kw[t], 0.0, 1.5))
        for k, weight in enumerate((1.0, 0.75, 0.5, 0.25), start=1):
            if k < len(solar):
                solar[k] *= 1 + weight * (ratio - 1)
    return solar


def plan(s: Scenario, st: State, solar_kw: FloatArray) -> tuple[list[EV], FloatArray, FloatArray]:
    """Solve the rest of the day. Returns (cars, battery_kw[H], ev_kw[N, H]).

    Raises ValueError when the solver cannot produce a plan.
    """
    t0, dt, b = st.t, s.dt_h, s.battery
    horizon = s.steps - t0
    if horizon <= 0:
        raise ValueError("Nothing left to plan")
    evs = [e for e in s.evs if ev_remaining(st, e) > EPS and e.depart_known_at(t0) > t0]
    n = len(evs)
    # Variable layout: import[H] export[H] charge[H] discharge[H] ev[N*H] shortfall[N] peak[1]
    o_imp, o_exp, o_ch, o_dis, o_ev = 0, horizon, 2 * horizon, 3 * horizon, 4 * horizon
    o_short, o_peak = 4 * horizon + n * horizon, 4 * horizon + n * horizon + n
    n_vars = o_peak + 1

    cost = np.zeros(n_vars)
    cost[o_imp : o_imp + horizon] = s.price_buy[t0:] * dt
    cost[o_exp : o_exp + horizon] = -s.price_sell[t0:] * dt
    # Energy left in the battery at the end is worth roughly the average price.
    end_price = float(np.mean(s.price_buy))
    cost[o_ch : o_ch + horizon] = b.wear_eur_per_kwh * dt - end_price * b.efficiency * dt
    cost[o_dis : o_dis + horizon] = b.wear_eur_per_kwh * dt + end_price / b.efficiency * dt
    cost[o_short : o_short + n] = 10 * s.missing_kwh_price  # only when physically unavoidable
    cost[o_peak] = 0.002  # tie-breaker: between equal plans prefer the flatter import
    for i in range(n):  # tiny preference for charging earlier at equal price
        cost[o_ev + i * horizon : o_ev + (i + 1) * horizon] += 1e-5 * np.arange(horizon)

    bounds: list[tuple[float, float | None]] = []
    bounds += [(0.0, s.grid_limit_kw)] * horizon
    bounds += [(0.0, None)] * horizon
    bounds += [(0.0, b.max_kw)] * horizon
    bounds += [(0.0, b.max_kw)] * horizon
    for e in evs:
        # Aim to finish early: covers what the LP does not model (n_chargers cars at once).
        deadline = max(e.depart_known_at(t0) - s.plan_margin_steps, t0 + 1)
        for k in range(horizon):
            bounds.append((0.0, e.max_kw if e.arrive <= t0 + k < deadline else 0.0))
    bounds += [(0.0, None)] * n + [(0.0, None)]

    a_eq = np.zeros((horizon, n_vars))
    b_eq = np.zeros(horizon)
    a_ub: list[FloatArray] = []
    b_ub: list[float] = []
    for k in range(horizon):  # import - export - charge + discharge - sum(ev) = load - solar
        a_eq[k, [o_imp + k, o_dis + k]] = 1
        a_eq[k, [o_exp + k, o_ch + k]] = -1
        for i in range(n):
            a_eq[k, o_ev + i * horizon + k] = -1
        b_eq[k] = float(s.load_kw[t0 + k]) - float(solar_kw[k])
    low, high = b.capacity_kwh * b.soc_min, b.capacity_kwh * b.soc_max
    for k in range(horizon):  # battery energy stays inside its window
        row = np.zeros(n_vars)
        row[o_ch : o_ch + k + 1] = b.efficiency * dt
        row[o_dis : o_dis + k + 1] = -dt / b.efficiency
        a_ub.append(row)
        b_ub.append(high - st.battery_kwh)
        a_ub.append(-row)
        b_ub.append(st.battery_kwh - low)
    charger_kw = s.n_chargers * max((e.max_kw for e in evs), default=0.0)
    for k in range(horizon):  # total power the chargers can deliver
        row = np.zeros(n_vars)
        for i in range(n):
            row[o_ev + i * horizon + k] = 1
        a_ub.append(row)
        b_ub.append(charger_kw)
    for i, e in enumerate(evs):  # every car gets its energy, or the shortfall is paid
        row = np.zeros(n_vars)
        row[o_ev + i * horizon : o_ev + (i + 1) * horizon] = -dt * s.ev_efficiency
        row[o_short + i] = -1
        a_ub.append(row)
        b_ub.append(-ev_remaining(st, e))
    for k in range(horizon):  # peak >= import
        row = np.zeros(n_vars)
        row[o_imp + k], row[o_peak] = 1, -1
        a_ub.append(row)
        b_ub.append(0.0)

    result = linprog(
        cost,
        A_ub=np.array(a_ub),
        b_ub=np.array(b_ub),
        A_eq=a_eq,
        b_eq=b_eq,
        bounds=bounds,
        method="highs",
    )
    if not result.success:
        raise ValueError(f"No feasible plan: {result.message}")
    x: FloatArray = np.asarray(result.x, dtype=np.float64)
    battery_kw = x[o_ch : o_ch + horizon] - x[o_dis : o_dis + horizon]
    ev_kw = x[o_ev : o_ev + n * horizon].reshape(n, horizon)
    return evs, battery_kw, ev_kw


def autopilot(s: Scenario, st: State, perfect_foresight: bool = False) -> Action:
    """Plan, then act for one step. Falls back to no management if the solver fails."""
    t = st.t
    try:
        evs, battery_kw, ev_plan = plan(s, st, solar_expectation(s, t, perfect_foresight))
    except ValueError:
        return baseline(s, st)

    # The LP decides HOW MUCH power the cars get now; least laxity first decides WHICH cars.
    budget = float(ev_plan[:, 0].sum()) if evs else 0.0

    def laxity(e: EV) -> float:  # hours of slack before the car must charge flat out
        hours_left = (e.depart_known_at(t) - t) * s.dt_h
        return hours_left - ev_remaining(st, e) / (e.max_kw * s.ev_efficiency)

    present = sorted((e for e in evs if ev_present(e, t)), key=laxity)
    ev_kw: dict[str, float] = {}
    for e in present[: s.n_chargers]:
        urgent = laxity(e) <= s.dt_h + 1e-9  # no slack left: charge whatever the budget says
        wanted = ev_remaining(st, e) / (s.dt_h * s.ev_efficiency)
        power = min(e.max_kw, wanted, e.max_kw if urgent else budget)
        if power > EPS:
            ev_kw[e.id] = power
            budget = max(0.0, budget - power)
    return limit_guard(s, st, float(battery_kw[0]), ev_kw)


def optimum(s: Scenario, st: State) -> Action:
    """Reference only: the same controller with perfect knowledge of the future."""
    return autopilot(s, st, perfect_foresight=True)
