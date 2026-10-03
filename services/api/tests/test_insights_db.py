"""Forecast, costs and recommendations from telemetry stored in PostgreSQL (issue #12).

The platform clock and the routes' clock are fixed at 10:30 Europe/Sofia on the demo
day, so the tests do not depend on the wall-clock hour or on local midnight.
Telemetry within 24 h of that clock goes through POST /api/v1/telemetry; older
history is written through the session because ingest rejects it.
"""

import os
from collections.abc import Iterator
from datetime import UTC, datetime
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.config import Settings
from app.database import build_engine
from app.main import create_app
from app.models import Device, Measurement, Site

pytestmark = pytest.mark.integration
database_url = os.environ.get("TEST_DATABASE_URL")
if not database_url:
    pytest.skip("TEST_DATABASE_URL is not configured", allow_module_level=True)

SOFIA = ZoneInfo("Europe/Sofia")
NOW = datetime(2026, 10, 4, 10, 30, tzinfo=SOFIA)


def local(hour: int, minute: int = 0, second: int = 0, day: int = 4) -> datetime:
    return datetime(2026, 10, day, hour, minute, second, tzinfo=SOFIA)


class Fixture:
    def __init__(self, client: TestClient, engine) -> None:
        self.client = client
        self.engine = engine
        self.now = NOW  # the platform's and the routes' clock
        self.site_id = uuid4()
        self.meter_id = uuid4()
        self.solar_id = uuid4()
        self.plug_id = uuid4()

    def post(self, device_id: UUID, at: datetime, **metrics: float) -> None:
        payload = {
            "version": 1,
            "site_id": str(self.site_id),
            "device_id": str(device_id),
            "message_id": str(uuid4()),
            "observed_at": at.isoformat(),
            "metrics": metrics,
        }
        if device_id == self.plug_id:
            payload["state"] = {"on": False}
        response = self.client.post("/api/v1/telemetry", json=payload)
        assert response.json() == {"stored": True}, response.text

    def store_old(self, device_id: UUID, at: datetime, power_w: float) -> None:
        with Session(self.engine) as session, session.begin():
            session.add(
                Measurement(
                    site_id=self.site_id,
                    device_id=device_id,
                    message_id=uuid4(),
                    observed_at=at,
                    power_w=power_w,
                )
            )

    def get(self, route: str):
        response = self.client.get(f"/api/v1/sites/{self.site_id}/{route}")
        assert response.status_code == 200, response.text
        return response.json()


@pytest.fixture
def env(monkeypatch: pytest.MonkeyPatch) -> Iterator[Fixture]:
    assert database_url is not None
    engine = build_engine(database_url)
    settings = Settings(_env_file=None, database_url=database_url)
    with TestClient(create_app(settings)) as client:
        fx = Fixture(client, engine)

        def clock() -> datetime:
            return fx.now.astimezone(UTC)

        monkeypatch.setattr("app.api.utc_now", clock)
        platform = client.app.state.platform  # type: ignore[attr-defined]
        platform._clock = clock  # ingest freshness window
        platform.live._clock = clock  # online/offline
        with Session(engine) as session, session.begin():
            session.add(
                Site(id=fx.site_id, owner_id=uuid4(), name="Insights", timezone="Europe/Sofia")
            )
            session.flush()
            session.add_all(
                [
                    Device(
                        id=fx.meter_id,
                        site_id=fx.site_id,
                        name="Grid meter",
                        kind="grid_meter",
                        source="simulator",
                        capabilities=["measure_power", "measure_energy"],
                    ),
                    Device(
                        id=fx.solar_id,
                        site_id=fx.site_id,
                        name="Rooftop solar",
                        kind="solar_inverter",
                        source="simulator",
                        capabilities=["measure_power"],
                        limits={"max_power_w": 6000},
                    ),
                    Device(
                        id=fx.plug_id,
                        site_id=fx.site_id,
                        name="Washing machine plug",
                        kind="smart_plug",
                        source="simulator",
                        capabilities=["measure_power", "switch"],
                        limits={"max_power_w": 2000},
                    ),
                ]
            )
        try:
            yield fx
        finally:
            with Session(engine) as session, session.begin():
                session.execute(delete(Site).where(Site.id == fx.site_id))
            engine.dispose()


def ingest_demo_morning(fx: Fixture) -> None:
    # 09:00-10:00 importing 1 kW; the counter rises 1000 Wh.
    fx.post(fx.meter_id, local(9), power_w=1000, energy_wh=10000)
    fx.post(fx.meter_id, local(9, 59, 58), power_w=1000, energy_wh=11000)
    # From 10:00 the sun is up: exporting 3 kW for half an hour, the import counter stands.
    fx.post(fx.meter_id, local(10), power_w=-3000, energy_wh=11000)
    fx.post(fx.meter_id, local(10, 29, 58), power_w=-3000, energy_wh=11000)
    fx.post(fx.solar_id, local(10, 29, 58), power_w=4000)
    fx.post(fx.plug_id, local(10, 29, 58), power_w=0)
    # Two days ago at 12:15 the site used 500 + 1500 = 2000 W.
    fx.store_old(fx.meter_id, local(12, 15, day=2), 500)
    fx.store_old(fx.solar_id, local(12, 15, day=2), 1500)


def test_costs_price_interval_energy_from_the_meter(env: Fixture) -> None:
    ingest_demo_morning(env)
    costs = env.get("costs")
    assert costs["day_start"] == "2026-10-04T00:00:00+03:00"
    assert costs["as_of"] == "2026-10-04T07:30:00Z"
    assert costs["has_meter"] is True and costs["currency"] == "EUR"
    hours = [(i["start"], i["import_wh"], i["export_wh"]) for i in costs["intervals"]]
    assert hours == [
        ("2026-10-04T09:00:00+03:00", 1000, 0),
        ("2026-10-04T10:00:00+03:00", 0, pytest.approx(1500)),
    ]
    assert costs["import_cost"] == pytest.approx(0.19)
    assert costs["export_revenue"] == pytest.approx(0.09)
    assert costs["cost"] == pytest.approx(0.10)
    assert costs["projected_day_cost"] is not None


def test_costs_fall_back_to_power_after_a_counter_reset(env: Fixture) -> None:
    env.post(env.meter_id, local(9), power_w=1200, energy_wh=5000)
    env.post(env.meter_id, local(9, 30), power_w=1200, energy_wh=5600)
    env.post(env.meter_id, local(9, 30, 2), power_w=1200, energy_wh=0)  # device restarted
    env.post(env.meter_id, local(9, 59, 58), power_w=1200, energy_wh=590)
    (hour,) = env.get("costs")["intervals"]
    assert hour["import_wh"] == pytest.approx(1200)  # not max - min = 5600


def test_costs_fall_back_to_power_when_the_counter_restarts_from_its_minimum(
    env: Fixture,
) -> None:
    # The first reading is the minimum and the last the maximum, yet the counter dropped.
    for at, energy in (
        (local(9), 0),
        (local(9, 20), 100),
        (local(9, 20, 2), 0),  # device restarted
        (local(9, 59, 58), 200),
    ):
        env.post(env.meter_id, at, power_w=600, energy_wh=energy)
    (hour,) = env.get("costs")["intervals"]
    assert hour["import_wh"] == pytest.approx(600)  # not last - first = 200


def test_costs_use_the_counter_when_readings_without_one_sit_between(env: Fixture) -> None:
    env.post(env.meter_id, local(9), power_w=900, energy_wh=1000)
    env.post(env.meter_id, local(9, 30), power_w=900)  # no counter in this reading
    env.post(env.meter_id, local(9, 59, 58), power_w=900, energy_wh=1800)
    (hour,) = env.get("costs")["intervals"]
    assert hour["import_wh"] == pytest.approx(800)


def test_costs_keep_the_two_repeated_hours_apart_when_summer_time_ends(env: Fixture) -> None:
    env.now = local(5, day=25)  # 2026-10-25: 04:00 summer time becomes 03:00 winter time
    env.post(env.meter_id, datetime(2026, 10, 25, 0, 10, tzinfo=UTC), power_w=1000)  # 03:10+03
    env.post(env.meter_id, datetime(2026, 10, 25, 1, 10, tzinfo=UTC), power_w=2000)  # 03:10+02
    hours = [(i["start"], i["end"]) for i in env.get("costs")["intervals"]]
    assert hours == [
        ("2026-10-25T03:00:00+03:00", "2026-10-25T03:00:00+02:00"),
        ("2026-10-25T03:00:00+02:00", "2026-10-25T04:00:00+02:00"),
    ]


def test_forecast_uses_the_week_of_history_and_current_load(env: Fixture) -> None:
    ingest_demo_morning(env)
    forecast = env.get("forecast")
    assert forecast["timezone"] == "Europe/Sofia"
    assert forecast["generated_at"] == "2026-10-04T07:30:00Z"
    intervals = forecast["intervals"]
    assert len(intervals) == 24
    assert intervals[0]["start"] == "2026-10-04T10:00:00+03:00"
    loads = {i["start"][11:13]: i["load_w"] for i in intervals}
    # 10 and 12 have history from every balance device; 09 lacks solar, so persistence.
    assert (loads["10"], loads["12"], loads["09"]) == (1000, 2000, 1000)
    assert any("2 от 24 часа" in a for a in forecast["assumptions"])
    assert intervals[0]["solar_w"] > 0 and intervals[12]["solar_w"] == 0


def test_recommendations_propose_running_the_idle_plug_on_surplus(env: Fixture) -> None:
    ingest_demo_morning(env)
    (recommendation,) = env.get("recommendations")
    assert recommendation["rule"] == "run-on-surplus"
    assert recommendation["device_id"] == str(env.plug_id)
    assert recommendation["action"] == {"type": "switch", "params": {"on": True}}
    command = env.client.post(
        f"/api/v1/sites/{env.site_id}/devices/{env.plug_id}/commands",
        json=recommendation["action"],
    )
    assert command.status_code == 202  # the API accepts what it proposed


@pytest.mark.parametrize("route", ["forecast", "costs", "recommendations"])
def test_unknown_site_is_404(env: Fixture, route: str) -> None:
    response = env.client.get(f"/api/v1/sites/{uuid4()}/{route}")
    assert response.status_code == 404
