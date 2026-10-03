import asyncio
import json
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from pydantic import TypeAdapter

from app.config import Settings
from app.energy import Reading, summarize
from app.live import EventHub, LiveState
from app.mqtt import MqttBridge
from app.platform import InvalidRequest, validate_command
from app.schemas import (
    Capability,
    CommandAck,
    CommandRequest,
    DeviceKind,
    DeviceLimits,
    DeviceOut,
    DeviceSource,
    Metrics,
    Telemetry,
)
from app.topics import Channel, device_topic, parse_device_topic

PREFIX = "optimesh/v1"
commands: TypeAdapter[CommandRequest] = TypeAdapter(CommandRequest)


def telemetry(site_id=None, device_id=None, at=None, power=100.0) -> Telemetry:
    return Telemetry(
        version=1,
        site_id=site_id or uuid4(),
        device_id=device_id or uuid4(),
        message_id=uuid4(),
        observed_at=at or datetime.now(UTC),
        metrics=Metrics(power_w=power),
    )


# --- topics ---------------------------------------------------------------------------


def test_topic_round_trip() -> None:
    site, device = uuid4(), uuid4()
    topic = device_topic(PREFIX, site, device, Channel.TELEMETRY)
    assert topic == f"optimesh/v1/sites/{site}/devices/{device}/telemetry"
    assert parse_device_topic(PREFIX, topic) == (site, device, Channel.TELEMETRY)


@pytest.mark.parametrize(
    "topic",
    [
        "optimesh/v2/sites/{s}/devices/{d}/telemetry",
        "optimesh/v1/sites/{s}/devices/{d}/unknown",
        "optimesh/v1/sites/not-a-uuid/devices/{d}/telemetry",
        "optimesh/v1/sites/{s}/devices/{d}/telemetry/extra",
        "optimesh/v1/site/{s}/devices/{d}/telemetry",
    ],
)
def test_malformed_topics_are_ignored(topic: str) -> None:
    assert parse_device_topic(PREFIX, topic.format(s=uuid4(), d=uuid4())) is None


# --- energy balance ---------------------------------------------------------------------


def test_balance_derives_total_consumption_and_unmeasured_load() -> None:
    summary = summarize(
        [
            Reading(DeviceKind.GRID_METER, True, power_w=-500),  # exporting
            Reading(DeviceKind.SOLAR_INVERTER, True, power_w=4000),
            Reading(DeviceKind.BATTERY, True, power_w=1500, soc_pct=60, capacity_wh=10000),
            Reading(DeviceKind.EV_CHARGER, True, power_w=1400),
            Reading(DeviceKind.BOILER, True, power_w=200),
        ]
    )
    assert summary.consumption_w == 2000  # -500 + 4000 - 1500
    assert summary.ev_w == 1400 and summary.loads_w == 200
    assert summary.unmeasured_w == 400
    assert summary.battery_soc_pct == 60
    assert summary.devices_online == summary.devices_total == 5


def test_balance_is_not_guessed_when_a_source_is_offline() -> None:
    summary = summarize(
        [
            Reading(DeviceKind.GRID_METER, True, power_w=1000),
            Reading(DeviceKind.SOLAR_INVERTER, False, power_w=3000),
            Reading(DeviceKind.HVAC, True, power_w=800),
        ]
    )
    assert summary.solar_w is None
    assert summary.consumption_w == 800  # measured loads only
    assert summary.unmeasured_w is None
    assert summary.devices_online == 2


def test_battery_soc_is_capacity_weighted() -> None:
    summary = summarize(
        [
            Reading(DeviceKind.BATTERY, True, power_w=0, soc_pct=100, capacity_wh=30000),
            Reading(DeviceKind.BATTERY, True, power_w=0, soc_pct=20, capacity_wh=10000),
        ]
    )
    assert summary.battery_soc_pct == 80


def test_empty_site() -> None:
    summary = summarize([])
    assert summary.consumption_w is None and summary.devices_total == 0


# --- command validation -----------------------------------------------------------------


def device(capabilities, **limits) -> DeviceOut:
    return DeviceOut(
        id=uuid4(),
        site_id=uuid4(),
        name="Test",
        kind=DeviceKind.EV_CHARGER,
        source=DeviceSource.SIMULATOR,
        capabilities=capabilities,
        limits=DeviceLimits(**limits),
    )


def test_switch_requires_switch_capability() -> None:
    switch = commands.validate_python({"type": "switch", "params": {"on": True}})
    validate_command(device([Capability.SWITCH]), switch)
    with pytest.raises(InvalidRequest):
        validate_command(device([Capability.MEASURE_POWER]), switch)


@pytest.mark.parametrize(("power", "ok"), [(0, True), (1400, True), (11000, True), (900, False)])
def test_setpoint_respects_device_limits(power: float, ok: bool) -> None:
    charger = device([Capability.POWER_SETPOINT], min_power_w=1400, max_power_w=11000)
    request = commands.validate_python({"type": "power_setpoint", "params": {"power_w": power}})
    if ok:
        validate_command(charger, request)
    else:
        with pytest.raises(InvalidRequest):
            validate_command(charger, request)


@pytest.mark.parametrize(
    "body",
    [
        {"type": "switch", "params": {"on": "maybe"}},
        {"type": "switch", "params": {}},
        {"type": "power_setpoint", "params": {"power_w": -5}},
        {"type": "power_setpoint", "params": {"power_w": float("inf")}},
        {"type": "reboot", "params": {}},
    ],
)
def test_malformed_commands_are_rejected(body: dict) -> None:
    with pytest.raises(ValueError):
        commands.validate_python(body)


# --- live state and fan-out ---------------------------------------------------------------


def test_device_goes_offline_by_server_clock() -> None:
    now = datetime(2026, 10, 3, 12, tzinfo=UTC)
    clock = [now]
    state = LiveState(stale_after_s=15, clock=lambda: clock[0])
    reading = telemetry(at=now - timedelta(days=365))  # device clock is wrong
    assert state.record(reading, received_at=now)
    assert state.device(reading.device_id).online
    clock[0] = now + timedelta(seconds=16)
    assert not state.device(reading.device_id).online


def test_out_of_order_readings_do_not_replace_newer_ones() -> None:
    state = LiveState(stale_after_s=15)
    now = datetime.now(UTC)
    newer = telemetry(at=now, power=10)
    older = telemetry(device_id=newer.device_id, at=now - timedelta(seconds=5), power=99)
    state.record(newer, now)
    assert not state.record(older, now)
    assert state.device(newer.device_id).metrics.power_w == 10  # type: ignore[union-attr]


def test_slow_subscriber_is_dropped_with_sentinel() -> None:
    async def scenario() -> None:
        hub = EventHub(queue_size=2)
        site = uuid4()
        async with hub.subscribe(site) as queue:
            for n in range(3):
                hub.publish(site, {"n": n})
            assert not hub.has_subscribers(site)
            items = [queue.get_nowait() for _ in range(queue.qsize())]
            assert items[-1] is None

    asyncio.run(scenario())


# --- MQTT dispatch ------------------------------------------------------------------------


class FakePlatform:
    def __init__(self) -> None:
        self.telemetry: list[Telemetry] = []
        self.acks: list[CommandAck] = []

    async def ingest_telemetry(self, value: Telemetry) -> bool:
        self.telemetry.append(value)
        return True

    async def handle_ack(self, site_id, device_id, ack: CommandAck) -> None:
        self.acks.append(ack)


def bridge() -> tuple[MqttBridge, FakePlatform]:
    fake = FakePlatform()
    settings = Settings(_env_file=None, mqtt_host="localhost")
    return MqttBridge(settings, fake), fake  # type: ignore[arg-type]


def test_bridge_dispatches_valid_telemetry_and_acks() -> None:
    mqtt, fake = bridge()
    reading = telemetry()
    topic = device_topic(PREFIX, reading.site_id, reading.device_id, Channel.TELEMETRY)
    ack = {
        "version": 1,
        "command_id": str(uuid4()),
        "status": "applied",
        "observed_at": "2026-10-03T12:00:00Z",
    }
    ack_topic = device_topic(PREFIX, reading.site_id, reading.device_id, Channel.ACK)

    async def scenario() -> None:
        await mqtt.handle(topic, reading.model_dump_json().encode())
        await mqtt.handle(ack_topic, json.dumps(ack).encode())

    asyncio.run(scenario())
    assert fake.telemetry == [reading]
    assert len(fake.acks) == 1


@pytest.mark.parametrize("payload", [b"not json", b"{}", b"[]", b"\xff"])
def test_bridge_survives_bad_payloads(payload: bytes) -> None:
    mqtt, fake = bridge()
    topic = device_topic(PREFIX, uuid4(), uuid4(), Channel.TELEMETRY)
    asyncio.run(mqtt.handle(topic, payload))
    assert fake.telemetry == []


def test_bridge_rejects_payload_for_another_device() -> None:
    mqtt, fake = bridge()
    reading = telemetry()
    spoofed = device_topic(PREFIX, reading.site_id, uuid4(), Channel.TELEMETRY)
    asyncio.run(mqtt.handle(spoofed, reading.model_dump_json().encode()))
    assert fake.telemetry == []
