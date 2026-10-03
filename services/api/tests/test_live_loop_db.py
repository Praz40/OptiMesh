"""End-to-end tests of telemetry -> DB -> WebSocket and command -> ack, against PostgreSQL."""

import os
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.orm import Session
from starlette.websockets import WebSocketDisconnect

from app.config import Settings
from app.database import build_engine
from app.main import create_app
from app.models import Device, Site
from app.schemas import CommandAck, CommandMessage
from app.seed import DEVICES, SITES, seed

pytestmark = pytest.mark.integration
database_url = os.environ.get("TEST_DATABASE_URL")
if not database_url:
    pytest.skip("TEST_DATABASE_URL is not configured", allow_module_level=True)


class FakePublisher:
    def __init__(self) -> None:
        self.sent: list[tuple[UUID, UUID, CommandMessage]] = []

    async def publish_command(self, site_id: UUID, device_id: UUID, message: CommandMessage):
        self.sent.append((site_id, device_id, message))


class Fixture:
    def __init__(self, client: TestClient, publisher: FakePublisher) -> None:
        self.client = client
        self.publisher = publisher
        self.platform = client.app.state.platform  # type: ignore[attr-defined]
        self.site_id = uuid4()
        self.meter_id = uuid4()
        self.plug_id = uuid4()


@pytest.fixture
def env() -> Iterator[Fixture]:
    assert database_url is not None
    engine = build_engine(database_url)
    settings = Settings(_env_file=None, database_url=database_url, command_ttl_s=15)
    with TestClient(create_app(settings)) as client:
        publisher = FakePublisher()
        client.app.state.platform.publisher = publisher  # type: ignore[attr-defined]
        fx = Fixture(client, publisher)
        with Session(engine) as session, session.begin():
            session.add(Site(id=fx.site_id, owner_id=uuid4(), name="Test site"))
            session.flush()
            session.add_all(
                [
                    Device(
                        id=fx.meter_id,
                        site_id=fx.site_id,
                        name="Grid",
                        kind="grid_meter",
                        source="hardware",
                        capabilities=["measure_power"],
                    ),
                    Device(
                        id=fx.plug_id,
                        site_id=fx.site_id,
                        name="Plug",
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


def reading(fx: Fixture, device_id: UUID, power: float, **extra) -> dict:
    return {
        "version": 1,
        "site_id": str(fx.site_id),
        "device_id": str(device_id),
        "message_id": str(uuid4()),
        "observed_at": datetime.now(UTC).isoformat(),
        "metrics": {"power_w": power},
        **extra,
    }


def test_telemetry_is_stored_once_and_streamed(env: Fixture) -> None:
    client = env.client
    with client.websocket_connect(f"/api/v1/sites/{env.site_id}/live") as ws:
        first = ws.receive_json()
        assert first["type"] == "snapshot"
        assert first["data"]["site"]["summary"]["devices_online"] == 0

        payload = reading(env, env.plug_id, 120.5, state={"on": True})
        assert client.post("/api/v1/telemetry", json=payload).json() == {"stored": True}
        assert client.post("/api/v1/telemetry", json=payload).json() == {"stored": False}

        event = ws.receive_json()
        assert event["type"] == "snapshot"
        live = {item["device_id"]: item for item in event["data"]["live"]}
        assert live[str(env.plug_id)]["online"] is True
        assert live[str(env.plug_id)]["metrics"]["power_w"] == 120.5
        assert live[str(env.plug_id)]["state"]["on"] is True
        assert event["data"]["site"]["summary"]["loads_w"] == 120.5

    history = client.get(f"/api/v1/sites/{env.site_id}/devices/{env.plug_id}/measurements")
    assert history.status_code == 200
    assert [row["power_w"] for row in history.json()] == [120.5]


def test_telemetry_for_unknown_or_foreign_device_is_rejected(env: Fixture) -> None:
    unknown = reading(env, uuid4(), 1.0)
    assert env.client.post("/api/v1/telemetry", json=unknown).status_code == 404
    foreign = {**reading(env, env.plug_id, 1.0), "site_id": str(uuid4())}
    assert env.client.post("/api/v1/telemetry", json=foreign).status_code == 404


def test_telemetry_from_the_future_is_rejected(env: Fixture) -> None:
    future = reading(env, env.plug_id, 1.0)
    future["observed_at"] = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
    assert env.client.post("/api/v1/telemetry", json=future).status_code == 422


def test_command_lifecycle_sent_then_applied(env: Fixture) -> None:
    client = env.client
    url = f"/api/v1/sites/{env.site_id}/devices/{env.plug_id}/commands"
    with client.websocket_connect(f"/api/v1/sites/{env.site_id}/live") as ws:
        ws.receive_json()
        response = client.post(url, json={"type": "switch", "params": {"on": False}})
        assert response.status_code == 202
        command = response.json()
        assert command["status"] == "sent"
        assert [ws.receive_json()["data"]["status"] for _ in range(2)] == ["pending", "sent"]

        site_id, device_id, message = env.publisher.sent[0]
        assert (site_id, device_id) == (env.site_id, env.plug_id)
        assert message.params == {"on": False}
        assert str(message.command_id) == command["id"]

        ack = CommandAck(
            version=1,
            command_id=message.command_id,
            status="applied",
            observed_at=datetime.now(UTC),
        )
        client.portal.call(env.platform.handle_ack, env.site_id, env.plug_id, ack)  # type: ignore[union-attr]
        event = ws.receive_json()
        assert event["type"] == "command"
        assert event["data"]["status"] == "applied"

    stored = client.get(f"/api/v1/sites/{env.site_id}/commands/{command['id']}").json()
    assert stored["status"] == "applied" and stored["acknowledged_at"] is not None


def test_ack_from_a_different_device_is_ignored(env: Fixture) -> None:
    url = f"/api/v1/sites/{env.site_id}/devices/{env.plug_id}/commands"
    command = env.client.post(url, json={"type": "switch", "params": {"on": True}}).json()
    ack = CommandAck(
        version=1, command_id=command["id"], status="applied", observed_at=datetime.now(UTC)
    )
    env.client.portal.call(env.platform.handle_ack, env.site_id, env.meter_id, ack)  # type: ignore[union-attr]
    stored = env.client.get(f"/api/v1/sites/{env.site_id}/commands/{command['id']}").json()
    assert stored["status"] == "sent"


def test_commands_are_validated_against_capabilities(env: Fixture) -> None:
    meter = f"/api/v1/sites/{env.site_id}/devices/{env.meter_id}/commands"
    response = env.client.post(meter, json={"type": "switch", "params": {"on": True}})
    assert response.status_code == 422
    missing = f"/api/v1/sites/{env.site_id}/devices/{uuid4()}/commands"
    assert (
        env.client.post(missing, json={"type": "switch", "params": {"on": True}}).status_code == 404
    )
    assert env.publisher.sent == []


def test_command_fails_visibly_without_broker(env: Fixture) -> None:
    env.platform.publisher = None
    url = f"/api/v1/sites/{env.site_id}/devices/{env.plug_id}/commands"
    command = env.client.post(url, json={"type": "switch", "params": {"on": True}}).json()
    assert command["status"] == "failed"
    assert command["reason"] == "MQTT is not configured"


def test_unacknowledged_command_expires_and_late_ack_still_counts(env: Fixture) -> None:
    env.platform._command_ttl = timedelta(seconds=-1)
    url = f"/api/v1/sites/{env.site_id}/devices/{env.plug_id}/commands"
    command = env.client.post(url, json={"type": "switch", "params": {"on": True}}).json()
    env.client.portal.call(env.platform.expire_due_commands)  # type: ignore[union-attr]
    path = f"/api/v1/sites/{env.site_id}/commands/{command['id']}"
    assert env.client.get(path).json()["status"] == "expired"

    ack = CommandAck(
        version=1,
        command_id=command["id"],
        status="rejected",
        reason="busy",
        observed_at=datetime.now(UTC),
    )
    env.client.portal.call(env.platform.handle_ack, env.site_id, env.plug_id, ack)  # type: ignore[union-attr]
    stored = env.client.get(path).json()
    assert stored["status"] == "rejected" and stored["reason"] == "busy"


def test_unknown_site_is_404_for_rest_and_websocket(env: Fixture) -> None:
    assert env.client.get(f"/api/v1/sites/{uuid4()}").status_code == 404
    with (
        pytest.raises(WebSocketDisconnect) as closed,
        env.client.websocket_connect(f"/api/v1/sites/{uuid4()}/live") as ws,
    ):
        ws.receive_json()
    assert closed.value.code == 4404


def test_seed_is_idempotent() -> None:
    assert database_url is not None
    engine = build_engine(database_url)
    try:
        with engine.connect() as connection:
            transaction = connection.begin()
            with Session(bind=connection) as session:
                seed(session)
                seed(session)
                session.flush()
                ids = [site_id for site_id, _, _ in SITES]
                assert session.query(Site).filter(Site.id.in_(ids)).count() == len(SITES)
                device_ids = [d["id"] for d in DEVICES]
                assert session.query(Device).filter(Device.id.in_(device_ids)).count() == len(
                    DEVICES
                )
            transaction.rollback()
    finally:
        engine.dispose()
