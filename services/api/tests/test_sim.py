from dataclasses import replace

import numpy as np
import pytest

from app.sim.core import (
    Action,
    Controller,
    baseline,
    initial_state,
    run,
    step,
)
from app.sim.optimizer import autopilot, optimum
from app.sim.scenario_office import (
    careful_human,
    comparisons,
    flat_tariff,
    office,
    without_battery,
)

# Every line printed by `python -m app.sim.scenario_office`: cost in EUR and cars ready.
PRINTED = (
    ("no management", 27.77, 10),
    ("Autopilot", 18.24, 10),
    ("optimum (knows the future)", 17.48, 10),
    ("one simple rule (a person)", 25.51, 8),
    ("Autopilot, no battery", 21.83, 10),
    ("flat tariff, no management", 34.35, 10),
    ("flat tariff, Autopilot", 34.23, 10),
)


@pytest.mark.parametrize("controller", [baseline, autopilot, optimum, careful_human])
def test_energy_is_conserved_and_limits_hold(controller: Controller) -> None:
    scenario = office()
    result = run(scenario, controller)
    assert len(result.timeline) == scenario.steps == 48
    for r in result.timeline:
        assert r.solar_kw + r.grid_kw == pytest.approx(r.load_kw + r.ev_kw + r.battery_kw)
        assert r.grid_kw <= scenario.grid_limit_kw + 1e-6
        assert 10.0 - 1e-6 <= r.battery_soc_pct <= 100.0 + 1e-6
        assert len(r.ev_by_car) <= scenario.n_chargers
        assert r.time.utcoffset() is not None
    assert result.score.overload_steps == 0


def test_office_day_reference_numbers() -> None:
    scenario = office()
    assert run(scenario, baseline).score.total_eur == pytest.approx(27.77, abs=0.01)
    assert run(scenario, autopilot).score.total_eur == pytest.approx(18.24, abs=0.05)
    assert run(scenario, optimum).score.total_eur == pytest.approx(17.48, abs=0.05)


def test_every_printed_comparison_is_pinned() -> None:
    runs = comparisons()
    assert [label for label, _, _ in runs] == [label for label, _, _ in PRINTED]
    for (label, scenario, controller), (_, cost_eur, ready) in zip(runs, PRINTED, strict=True):
        score = run(scenario, controller).score
        assert (score.total_eur, score.evs_ready, score.evs_total) == (cost_eur, ready, 10), label


def test_comparison_cases_change_only_what_they_say() -> None:
    day = office()
    simple_rule = run(day, careful_human).score
    assert simple_rule.missed == ("Петър", "Яна")
    no_battery = run(without_battery(day), autopilot)
    assert all(r.battery_kw == 0 for r in no_battery.timeline)
    assert no_battery.score.battery_cycles == 0
    flat = flat_tariff(day)
    assert np.all(flat.price_buy == 0.20) and np.all(flat.price_sell == 0.05)
    assert np.array_equal(flat.solar_actual_kw, day.solar_actual_kw)
    assert flat.evs == day.evs and flat.battery == day.battery


def test_autopilot_charges_every_car_and_beats_no_management() -> None:
    scenario = office()
    managed, unmanaged = run(scenario, autopilot).score, run(scenario, baseline).score
    assert managed.evs_ready == managed.evs_total == 10
    assert managed.missing_kwh == 0
    assert managed.total_eur < unmanaged.total_eur
    # With perfect knowledge of the future the bill can only be lower or equal.
    assert run(scenario, optimum).score.total_eur <= managed.total_eur + 0.01


def test_one_simple_rule_is_not_enough() -> None:
    human = run(office(), careful_human).score
    assert human.evs_ready < human.evs_total
    assert human.total_eur > run(office(), autopilot).score.total_eur


def test_runs_are_reproducible() -> None:
    assert run(office(), autopilot) == run(office(), autopilot)


def test_autopilot_cannot_see_the_future() -> None:
    """Changing what happens later must not change what the controller does now."""
    scenario = office()
    altered = scenario.solar_actual_kw.copy()
    altered[10:] *= 0.1
    other = replace(scenario, solar_actual_kw=altered)
    state = initial_state(scenario)
    for _ in range(10):
        action = autopilot(scenario, state)
        assert action == autopilot(other, state)
        state, _ = step(scenario, state, action)


def test_flat_tariff_gives_no_meaningful_saving() -> None:
    flat = flat_tariff(office())
    managed, unmanaged = run(flat, autopilot).score, run(flat, baseline).score
    assert managed.total_eur == pytest.approx(unmanaged.total_eur, rel=0.02)


def test_infeasible_demand_is_reported_not_hidden() -> None:
    scenario = office()
    heavy = replace(scenario, evs=tuple(replace(e, need_kwh=e.need_kwh * 3) for e in scenario.evs))
    for controller in (baseline, autopilot):
        result = run(heavy, controller).score
        assert result.evs_ready < result.evs_total
        assert result.missing_kwh > 0
        assert result.overload_steps == 0


def test_physics_ignores_impossible_requests() -> None:
    scenario = office()
    state = initial_state(scenario)
    # Nobody has arrived at step 0 and the battery cannot exceed its power.
    _, result = step(scenario, state, Action(battery_kw=999.0, ev_kw={"ev1": 50.0, "nope": 11.0}))
    assert result.ev_kw == 0
    assert result.battery_kw <= scenario.battery.max_kw
    with pytest.raises(ValueError):
        step(scenario, replace(state, t=scenario.steps), Action())


def test_scenario_rejects_inconsistent_series() -> None:
    scenario = office()
    with pytest.raises(ValueError):
        replace(scenario, load_kw=scenario.load_kw[:-1])
