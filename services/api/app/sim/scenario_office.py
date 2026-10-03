"""Office scenario: one working day, 07:00-19:00 Europe/Sofia, in 15-minute steps.

Prices are the real Bulgarian day-ahead prices for 30 September 2026 (15-minute
resolution, EUR/MWh, source: api.energy-charts.info/price?bzn=BG).
Everything else (roof size, loads, cars, fees) is an ASSUMPTION that still needs review.

Run `uv run python -m app.sim.scenario_office` from services/api to print the comparison.
"""

import math
import time
from datetime import UTC, datetime

import numpy as np

from app.sim.core import EV, Battery, Controller, Scenario, baseline, run
from app.sim.optimizer import autopilot, optimum

# EUR/MWh for 00:00 -> 23:45 local time on 2026-09-30.
DAY_AHEAD_EUR_MWH = [
    188.99, 186.19, 177.32, 174.05, 156.11, 145.92, 122.3, 127.1, 136.92, 117.24, 116.2, 138.76,
    146.52, 145.55, 149.54, 146.67, 153.87, 156.18, 152.1, 163.05, 164.08, 160.77, 164.33, 180.21,
    181.14, 190.49, 197.78, 225.16, 209.97, 231.48, 226.64, 227.85, 227.94, 219.52, 218.15, 213.11,
    229.18, 210.63, 189.3, 149.55, 54.99, 25.04, 60.0, 60.01, 48.83, 59.99, 39.34, 22.42,
    40.99, 22.12, 12.77, 11.0, 10.16, 9.99, 9.87, 9.66, 10.14, 10.23, 10.0, 10.0,
    10.22, 12.23, 12.78, 12.78, 36.94, 85.21, 103.59, 113.68, 108.54, 133.3, 174.35, 202.37,
    175.8, 196.65, 213.48, 172.62, 174.21, 174.21, 181.3, 174.19, 174.22, 173.13, 165.32, 171.35,
    173.0, 173.82, 174.22, 174.17, 182.0, 175.48, 184.0, 181.13, 192.0, 198.79, 187.94, 172.08,
]  # fmt: skip

STEP_MINUTES = 15
START_LOCAL_MINUTE = 7 * 60
END_LOCAL_MINUTE = 19 * 60
START_UTC = datetime(2026, 9, 30, 4, 0, tzinfo=UTC)  # 07:00 in Sofia (UTC+3)

CARS: tuple[tuple[str, str, str, str, float], ...] = (
    ("ev1", "Иван", "07:30", "16:00", 30),
    ("ev2", "Мария", "07:45", "17:00", 22),
    ("ev3", "Георги", "08:00", "17:30", 35),
    ("ev4", "Елена", "08:00", "16:30", 15),
    ("ev5", "Петър", "08:15", "18:00", 28),
    ("ev6", "Ани", "08:30", "17:00", 19),
    ("ev7", "Николай", "08:45", "18:30", 32),
    ("ev8", "Деси", "09:00", "17:30", 12),
    ("ev9", "Виктор", "09:15", "18:00", 25),
    ("ev10", "Яна", "09:45", "18:30", 20),
)


def step_of(local_time: str) -> int:
    hours, minutes = map(int, local_time.split(":"))
    return (hours * 60 + minutes - START_LOCAL_MINUTE) // STEP_MINUTES


def office(
    fees_eur_kwh: float = 0.07, cloud: bool = True, early_leaver: bool = True, roof_kwp: float = 45
) -> Scenario:
    steps = (END_LOCAL_MINUTE - START_LOCAL_MINUTE) // STEP_MINUTES
    hours = np.array([(START_LOCAL_MINUTE + STEP_MINUTES * i) / 60 for i in range(steps)])

    # Clear early-October day in Sofia: sunrise about 07:25, sunset about 19:05 local time.
    sunrise, sunset = 7.42, 19.08
    x = np.clip((hours + STEP_MINUTES / 120 - sunrise) / (sunset - sunrise), 0, 1)
    forecast = roof_kwp * 0.68 * np.sin(math.pi * x) ** 1.3
    actual = forecast.copy()
    if cloud:  # a cloud bank the forecast did not see
        actual[(hours >= 12.5) & (hours < 14.25)] *= 0.3

    # Inflexible load: lights and IT, plus HVAC around midday.
    base = np.where((hours >= 8) & (hours < 18), 6.0, 3.0)
    hvac = np.where((hours >= 11) & (hours < 17), 3.0, 0.0)
    load = base + hvac + 1.5 * np.sin(np.linspace(0, 6, steps))

    first = START_LOCAL_MINUTE // STEP_MINUTES
    day_ahead = np.array(DAY_AHEAD_EUR_MWH[first : first + steps]) / 1000.0  # EUR/kWh

    evs = []
    for car_id, name, arrive, depart, need in CARS:
        if early_leaver and car_id == "ev5":  # at 12:00 this driver says they leave at 14:30
            evs.append(
                EV(
                    car_id,
                    name,
                    step_of(arrive),
                    step_of(depart),
                    need,
                    notice=step_of("12:00"),
                    new_depart=step_of("14:30"),
                )
            )
        else:
            evs.append(EV(car_id, name, step_of(arrive), step_of(depart), need))

    return Scenario(
        id="office",
        name="Офис с 10 електромобила",
        start=START_UTC,
        step_minutes=STEP_MINUTES,
        solar_forecast_kw=forecast,
        solar_actual_kw=actual,
        load_kw=load,
        price_buy=day_ahead + fees_eur_kwh,
        price_sell=np.maximum(day_ahead * 0.9, 0.0),
        battery=Battery(),
        evs=tuple(evs),
        n_chargers=3,
        grid_limit_kw=30.0,
    )


def main() -> None:
    scenario = office()
    controllers: tuple[tuple[str, Controller], ...] = (
        ("no management", baseline),
        ("Autopilot", autopilot),
        ("optimum (knows the future)", optimum),
    )
    print(f"{scenario.name}: {scenario.steps} steps of {scenario.step_minutes} min")
    for label, controller in controllers:
        started = time.perf_counter()
        result = run(scenario, controller).score
        print(
            f"{label:28s} {result.total_eur:6.2f} EUR | import {result.grid_import_kwh:6.1f} kWh"
            f" | peak {result.peak_kw:4.1f} kW | cars ready {result.evs_ready}/{result.evs_total}"
            f" | battery cycles {result.battery_cycles:.2f}"
            f" | {(time.perf_counter() - started) * 1000:.0f} ms"
        )


if __name__ == "__main__":
    main()
