"""Virtual devices that behave like hardware on MQTT.

The simulator discovers devices through the public API, publishes telemetry on
the same topics as an ESP32 would, and answers commands with acks. The backend
cannot tell it apart from real hardware.

Run from services/api (API and broker must be running):
    uv run --frozen python -m app.simulator
    uv run --frozen python -m app.simulator --include-hardware  # stand in for the ESP32
    uv run --frozen python -m app.simulator --hour 12           # fixed midday sun
"""

import argparse
import asyncio
import json
import logging
import math
import random
import ssl
import urllib.request
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import aiomqtt
from pydantic import TypeAdapter, ValidationError

from app.config import Settings
from app.energy import Role, role_of
from app.mqtt import tls_context
from app.platform import InvalidRequest, validate_command
from app.schemas import (
    AckStatus,
    Capability,
    CommandAck,
    CommandMessage,
    CommandRequest,
    CommandType,
    DeviceKind,
    DeviceOut,
    DeviceSource,
    DeviceState,
    Metrics,
    Telemetry,
)
from app.topics import Channel, device_topic, parse_device_topic

logger = logging.getLogger("simulator")

BATTERY_MIN_SOC = 10.0
BATTERY_MAX_SOC = 95.0
EV_BATTERY_WH = 60_000.0
# Unmetered base consumption per site, scaled by how busy the site is.
BASE_LOAD_W = {"Home": 350.0, "Workshop": 600.0, "Office": 3500.0}

command_adapter: TypeAdapter[CommandRequest] = TypeAdapter(CommandRequest)


def sun_factor(hour: float) -> float:
    """Clear-sky shape: 0 at night, 1 at solar noon (13:00 local)."""
    angle = (hour - 7.0) / 12.0 * math.pi
    return max(math.sin(angle), 0.0) ** 1.3 if 7.0 <= hour <= 19.0 else 0.0


def occupancy(site_name: str, hour: float) -> float:
    if site_name == "Home":
        return 1.0 if hour < 7 or hour > 17 else 0.5
    return 1.0 if 8 <= hour <= 18 else 0.25


@dataclass
class SimDevice:
    info: DeviceOut
    on: bool = True
    setpoint_w: float | None = None
    power_w: float = 0.0
    energy_wh: float = 0.0
    soc_pct: float | None = None

    @property
    def max_w(self) -> float:
        return self.info.limits.max_power_w or 100.0

    @property
    def controllable(self) -> bool:
        caps = self.info.capabilities
        return Capability.SWITCH in caps or Capability.POWER_SETPOINT in caps


@dataclass
class SimSite:
    id: UUID
    name: str
    timezone: str
    devices: list[SimDevice]
    rng: random.Random
    clouds: float = 1.0
    unmetered_w: float = 0.0
    extras: dict[str, float] = field(default_factory=dict)

    def local_hour(self, fixed_hour: float | None) -> float:
        if fixed_hour is not None:
            return fixed_hour
        try:
            now = datetime.now(ZoneInfo(self.timezone))
        except ZoneInfoNotFoundError:
            now = datetime.now(UTC)
        return now.hour + now.minute / 60

    def step(self, dt_s: float, hour: float) -> None:
        rng = self.rng
        self.clouds = min(1.0, max(0.35, self.clouds + rng.uniform(-0.05, 0.05)))
        busy = occupancy(self.name, hour)
        consumption = BASE_LOAD_W.get(self.name, 500.0) * busy * rng.uniform(0.9, 1.1)
        self.unmetered_w = consumption
        solar = 0.0
        for device in self.devices:
            role = role_of(device.info.kind)
            if role == Role.SOLAR:
                device.power_w = device.max_w * sun_factor(hour) * self.clouds
                solar += device.power_w
            elif role in (Role.EV, Role.LOAD):
                device.power_w = self._load_power(device, busy)
                consumption += device.power_w
        surplus = solar - consumption
        battery_total = 0.0
        for device in self.devices:
            if role_of(device.info.kind) == Role.BATTERY:
                device.power_w = self._battery_power(device, surplus, dt_s)
                surplus -= device.power_w
                battery_total += device.power_w
        grid = consumption + battery_total - solar
        for device in self.devices:
            role = role_of(device.info.kind)
            if role == Role.GRID:
                device.power_w = grid
                device.energy_wh += max(grid, 0.0) * dt_s / 3600
            elif role != Role.BATTERY:
                device.energy_wh += max(device.power_w, 0.0) * dt_s / 3600
            if role == Role.EV and device.soc_pct is not None:
                device.soc_pct = min(
                    100.0, device.soc_pct + device.power_w * dt_s / 3600 / EV_BATTERY_WH * 100
                )

    def _load_power(self, device: SimDevice, busy: float) -> float:
        if not device.on:
            return 0.0
        kind = device.info.kind
        if kind == DeviceKind.EV_CHARGER:
            if device.soc_pct is not None and device.soc_pct >= 100.0:
                return 0.0
            return device.setpoint_w if device.setpoint_w is not None else device.max_w
        if kind == DeviceKind.HVAC:
            target = device.setpoint_w if device.setpoint_w is not None else device.max_w * 0.5
            return target * busy * self.rng.uniform(0.9, 1.05)
        if kind == DeviceKind.BOILER:
            # Thermostat: heats at full power most of the time while enabled.
            return device.max_w if self.rng.random() < 0.85 else 0.0
        # Plugs, generic loads and the ESP32 stand-in fluctuate below their rating.
        return device.max_w * self.rng.uniform(0.35, 0.6)

    def _battery_power(self, device: SimDevice, surplus: float, dt_s: float) -> float:
        soc = device.soc_pct if device.soc_pct is not None else 50.0
        capacity = device.info.limits.capacity_wh or 10_000.0
        power = max(-device.max_w, min(device.max_w, surplus))
        if (power > 0 and soc >= BATTERY_MAX_SOC) or (power < 0 and soc <= BATTERY_MIN_SOC):
            power = 0.0
        device.soc_pct = min(100.0, max(0.0, soc + power * dt_s / 3600 / capacity * 100))
        return power


def initial_state(device: SimDevice, rng: random.Random) -> None:
    kind = device.info.kind
    if kind == DeviceKind.BATTERY:
        device.soc_pct = rng.uniform(40, 70)
    elif kind == DeviceKind.EV_CHARGER:
        device.soc_pct = rng.uniform(20, 60)
        device.on = rng.random() < 0.7
        device.setpoint_w = min(7400.0, device.max_w)
    elif kind == DeviceKind.HVAC:
        device.setpoint_w = device.max_w * 0.5
    elif kind == DeviceKind.SMART_PLUG:
        device.on = False


def metrics_for(device: SimDevice) -> tuple[Metrics, DeviceState | None]:
    kind = device.info.kind
    caps = device.info.capabilities
    power = round(device.power_w, 1)
    energy = round(device.energy_wh, 2) if Capability.MEASURE_ENERGY in caps else None
    soc = (
        round(device.soc_pct, 2)
        if kind == DeviceKind.BATTERY and device.soc_pct is not None
        else None
    )
    voltage = current = None
    if device.info.source == DeviceSource.HARDWARE:
        voltage = round(230 + random.uniform(-2, 2), 1)
        current = round(power / voltage, 3)
    metrics = Metrics(
        power_w=power, energy_wh=energy, soc_pct=soc, voltage_v=voltage, current_a=current
    )
    state = None
    if device.controllable:
        setpoint = device.setpoint_w if Capability.POWER_SETPOINT in caps else None
        state = DeviceState(on=device.on, setpoint_w=setpoint)
    return metrics, state


def fetch_json(url: str) -> Any:
    with urllib.request.urlopen(url, timeout=5) as response:  # noqa: S310 (operator-supplied URL)
        return json.loads(response.read())


def load_sites(
    api_url: str, names: set[str] | None, include_hardware: bool, rng: random.Random
) -> list[SimSite]:
    sites = []
    for site in fetch_json(f"{api_url}/api/v1/sites"):
        if names and site["name"].lower() not in names:
            continue
        snapshot = fetch_json(f"{api_url}/api/v1/sites/{site['id']}")
        devices = []
        for raw in snapshot["devices"]:
            info = DeviceOut.model_validate(raw)
            if info.source == DeviceSource.HARDWARE and not include_hardware:
                continue
            device = SimDevice(info)
            initial_state(device, rng)
            devices.append(device)
        if devices:
            sites.append(SimSite(UUID(site["id"]), site["name"], site["timezone"], devices, rng))
    return sites


class Simulator:
    def __init__(
        self, sites: list[SimSite], prefix: str, interval_s: float, hour: float | None
    ) -> None:
        self.sites = sites
        self.prefix = prefix
        self.interval_s = interval_s
        self.hour = hour
        self.devices = {(s.id, d.info.id): d for s in sites for d in s.devices}

    async def publish_telemetry(
        self, client: aiomqtt.Client, site_id: UUID, device: SimDevice
    ) -> None:
        metrics, state = metrics_for(device)
        telemetry = Telemetry(
            version=1,
            site_id=site_id,
            device_id=device.info.id,
            message_id=uuid4(),
            observed_at=datetime.now(UTC),
            metrics=metrics,
            state=state,
        )
        topic = device_topic(self.prefix, site_id, device.info.id, Channel.TELEMETRY)
        await client.publish(topic, telemetry.model_dump_json(exclude_none=True), qos=1)

    async def telemetry_loop(self, client: aiomqtt.Client) -> None:
        while True:
            for site in self.sites:
                site.step(self.interval_s, site.local_hour(self.hour))
                for device in site.devices:
                    await self.publish_telemetry(client, site.id, device)
            await asyncio.sleep(self.interval_s)

    async def handle_command(self, client: aiomqtt.Client, topic: str, payload: Any) -> None:
        parts = parse_device_topic(self.prefix, topic)
        if parts is None or parts.channel != Channel.COMMAND:
            return
        device = self.devices.get((parts.site_id, parts.device_id))
        if device is None:
            return  # Not ours (e.g. the real ESP32 is online).
        try:
            message = CommandMessage.model_validate_json(payload)
        except ValidationError as error:
            logger.warning("Ignoring malformed command on %s: %s", topic, error)
            return
        status, reason = AckStatus.APPLIED, None
        try:
            if message.expires_at < datetime.now(UTC):
                raise InvalidRequest("Command expired before it arrived")
            request = command_adapter.validate_python(
                {"type": message.type, "params": message.params}
            )
            validate_command(device.info, request)
            if message.type == CommandType.SWITCH:
                device.on = bool(message.params["on"])
            else:
                power = float(message.params["power_w"])
                device.on, device.setpoint_w = power > 0, power or device.setpoint_w
        except (InvalidRequest, ValidationError) as error:
            status, reason = AckStatus.REJECTED, str(error)[:200]
        ack = CommandAck(
            version=1,
            command_id=message.command_id,
            status=status,
            reason=reason,
            observed_at=datetime.now(UTC),
        )
        logger.info("%s %s -> %s", device.info.name, message.type, status)
        ack_topic = device_topic(self.prefix, parts.site_id, parts.device_id, Channel.ACK)
        await client.publish(ack_topic, ack.model_dump_json(), qos=1)
        # Report the new state right away, as firmware should.
        site = next(s for s in self.sites if s.id == parts.site_id)
        site.step(0.0, site.local_hour(self.hour))
        await self.publish_telemetry(client, parts.site_id, device)

    async def run(
        self,
        host: str,
        port: int,
        username: str | None,
        password: str | None,
        tls: ssl.SSLContext | None = None,
    ) -> None:
        delay = 1.0
        while True:
            try:
                async with aiomqtt.Client(
                    host, port, username=username, password=password, tls_context=tls
                ) as c:
                    for site in self.sites:
                        await c.subscribe(f"{self.prefix}/sites/{site.id}/devices/+/command", qos=1)
                    logger.info(
                        "Simulating %d devices on %d sites", len(self.devices), len(self.sites)
                    )
                    delay = 1.0
                    async with asyncio.TaskGroup() as group:
                        group.create_task(self.telemetry_loop(c))
                        async for message in c.messages:
                            await self.handle_command(c, str(message.topic), message.payload)
            except* aiomqtt.MqttError as errors:
                logger.warning("MQTT error (%s); retrying in %.0fs", errors.exceptions[0], delay)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 30.0)


def main() -> None:
    settings = Settings()
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--api", default="http://127.0.0.1:8000", help="API base URL")
    parser.add_argument("--mqtt-host", default=settings.mqtt_host or "127.0.0.1")
    parser.add_argument("--mqtt-port", type=int, default=settings.mqtt_port)
    parser.add_argument("--site", action="append", help="Only simulate this site (repeatable)")
    parser.add_argument("--include-hardware", action="store_true", help="Simulate hardware too")
    parser.add_argument("--interval", type=float, default=2.0, help="Seconds between readings")
    parser.add_argument("--hour", type=float, help="Fix the local hour of day (0-24)")
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    rng = random.Random(args.seed)
    names = {name.lower() for name in args.site} if args.site else None
    sites = load_sites(args.api.rstrip("/"), names, args.include_hardware, rng)
    if not sites:
        raise SystemExit("No devices to simulate. Did you run `python -m app.seed`?")
    simulator = Simulator(sites, settings.mqtt_topic_prefix, args.interval, args.hour)
    password = settings.mqtt_password.get_secret_value() if settings.mqtt_password else None
    # Same TLS settings as the API's bridge, so credentials never go out in plain text.
    tls = tls_context(settings)
    try:
        asyncio.run(
            simulator.run(
                args.mqtt_host,
                args.mqtt_port,
                settings.mqtt_username.get_secret_value() if settings.mqtt_username else None,
                password,
                tls,
            )
        )
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
