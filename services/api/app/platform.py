"""Transport-independent core: telemetry ingestion, live snapshots and commands.

MQTT, HTTP and WebSocket adapters call into this; none of it knows whether a
device is physical or simulated.
"""

import asyncio
import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol
from uuid import UUID, uuid4

from sqlalchemy import Engine, Float, extract, func, select, text, update
from sqlalchemy.dialects.postgresql import ARRAY, aggregate_order_by, insert
from sqlalchemy.orm import Session

from app.costs import MeterHour
from app.energy import Reading, summarize
from app.forecast import site_zone
from app.live import EventHub, LiveState, utc_now
from app.models import Command, Device, Measurement, Site
from app.schemas import (
    AckStatus,
    Capability,
    CommandAck,
    CommandMessage,
    CommandOut,
    CommandRequest,
    CommandStatus,
    DeviceLimits,
    DeviceOut,
    PowerSetpointCommand,
    SiteOut,
    SiteSnapshot,
    SwitchCommand,
    Telemetry,
)

logger = logging.getLogger(__name__)

# Telemetry stamped further in the future than this is rejected as a clock fault.
MAX_CLOCK_SKEW = timedelta(minutes=5)
MAX_PAST_AGE = timedelta(hours=24)


class DatabaseUnavailable(Exception):
    pass


class NotFound(Exception):
    pass


class InvalidRequest(Exception):
    pass


class CommandPublisher(Protocol):
    async def publish_command(
        self, site_id: UUID, device_id: UUID, message: CommandMessage
    ) -> None: ...


def device_out(row: Device) -> DeviceOut:
    return DeviceOut.model_validate(
        {
            "id": row.id,
            "site_id": row.site_id,
            "name": row.name,
            "kind": row.kind,
            "source": row.source,
            "capabilities": row.capabilities,
            "limits": row.limits,
        }
    )


def command_out(row: Command) -> CommandOut:
    return CommandOut.model_validate(row, from_attributes=True)


def validate_command(device: DeviceOut, request: CommandRequest) -> None:
    if isinstance(request, SwitchCommand):
        if Capability.SWITCH not in device.capabilities:
            raise InvalidRequest("Device cannot be switched")
    elif isinstance(request, PowerSetpointCommand):
        if Capability.POWER_SETPOINT not in device.capabilities:
            raise InvalidRequest("Device does not accept a power setpoint")
        power = request.params.power_w
        limits: DeviceLimits = device.limits
        if limits.max_power_w is None:
            raise InvalidRequest("Device has no max_power_w configured")
        low = limits.min_power_w or 0
        if power != 0 and not low <= power <= limits.max_power_w:
            raise InvalidRequest(
                f"power_w must be 0 or between {low:g} and {limits.max_power_w:g} W"
            )


class Platform:
    def __init__(
        self,
        engine: Engine | None,
        *,
        stale_after_s: float,
        command_ttl_s: float,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self.engine = engine
        self.hub = EventHub()
        self.live = LiveState(stale_after_s, clock)
        self.publisher: CommandPublisher | None = None
        self._command_ttl = timedelta(seconds=command_ttl_s)
        self._clock = clock
        self._devices: dict[UUID, DeviceOut] = {}
        self._site_devices: dict[UUID, list[DeviceOut]] = {}

    # --- registry -----------------------------------------------------------------

    def _session(self) -> Session:
        if self.engine is None:
            raise DatabaseUnavailable
        return Session(self.engine, expire_on_commit=False)

    def _load_site_devices(self, site_id: UUID) -> list[DeviceOut]:
        with self._session() as session:
            rows = session.scalars(
                select(Device).where(Device.site_id == site_id).order_by(Device.name)
            ).all()
        devices = [device_out(row) for row in rows]
        self._site_devices[site_id] = devices
        self._devices.update((d.id, d) for d in devices)
        return devices

    def site_devices(self, site_id: UUID) -> list[DeviceOut]:
        cached = self._site_devices.get(site_id)
        return cached if cached is not None else self._load_site_devices(site_id)

    def find_device(self, site_id: UUID, device_id: UUID) -> DeviceOut | None:
        device = self._devices.get(device_id)
        if device is None:
            # Devices registered after startup are picked up on first contact.
            self._load_site_devices(site_id)
            device = self._devices.get(device_id)
        return device if device is not None and device.site_id == site_id else None

    def _site_out(self, site: Site) -> SiteOut:
        devices = self.site_devices(site.id)
        readings = []
        for device in devices:
            live = self.live.device(device.id)
            metrics = live.metrics
            readings.append(
                Reading(
                    kind=device.kind,
                    online=live.online,
                    power_w=metrics.power_w if metrics else None,
                    soc_pct=metrics.soc_pct if metrics else None,
                    capacity_wh=device.limits.capacity_wh,
                    observed_at=live.observed_at,
                )
            )
        return SiteOut(
            id=site.id,
            name=site.name,
            timezone=site.timezone,
            currency=site.currency,
            summary=summarize(readings),
        )

    def list_sites(self) -> list[SiteOut]:
        with self._session() as session:
            sites = session.scalars(select(Site).order_by(Site.created_at, Site.name)).all()
        return [self._site_out(site) for site in sites]

    def snapshot(self, site_id: UUID) -> SiteSnapshot:
        with self._session() as session:
            site = session.get(Site, site_id)
        if site is None:
            raise NotFound("Site not found")
        devices = self.site_devices(site_id)
        return SiteSnapshot(
            site=self._site_out(site),
            devices=devices,
            live=[self.live.device(d.id) for d in devices],
        )

    def measurements(self, site_id: UUID, device_id: UUID, limit: int) -> list[dict[str, Any]]:
        if self.find_device(site_id, device_id) is None:
            raise NotFound("Device not found")
        with self._session() as session:
            rows = session.scalars(
                select(Measurement)
                .where(Measurement.site_id == site_id, Measurement.device_id == device_id)
                .order_by(Measurement.observed_at.desc())
                .limit(limit)
            ).all()
        return [
            {
                "observed_at": r.observed_at,
                "power_w": r.power_w,
                "energy_wh": r.energy_wh,
                "soc_pct": r.soc_pct,
                "voltage_v": r.voltage_v,
                "current_a": r.current_a,
                "state": r.state,
            }
            for r in rows
        ]

    def hourly_power(
        self, site_id: UUID, timezone: str, since: datetime
    ) -> dict[UUID, dict[int, float]]:
        """Mean power per device per local hour of day (0-23) since `since`."""
        hour = func.extract("hour", func.timezone(timezone, Measurement.observed_at))
        with self._session() as session:
            rows: Any = session.execute(
                select(Measurement.device_id, hour, func.avg(Measurement.power_w))
                .where(
                    Measurement.site_id == site_id,
                    Measurement.observed_at >= since,
                    Measurement.power_w.is_not(None),
                )
                .group_by(Measurement.device_id, hour)
            ).all()
        result: dict[UUID, dict[int, float]] = {}
        for device_id, local_hour, mean in rows:
            result.setdefault(device_id, {})[int(local_hour)] = float(mean)
        return result

    def meter_hours(
        self, site_id: UUID, device_ids: list[UUID], timezone: str, since: datetime
    ) -> list[MeterHour]:
        """Readings of the given meters aggregated per local hour since `since`."""
        if not device_ids:
            return []
        local_time = func.timezone(timezone, Measurement.observed_at)
        local_hour = func.date_trunc("hour", local_time)
        # Seconds east of UTC: tells the two 03:00 hours apart when summer time ends.
        utc_offset = extract("epoch", local_time - func.timezone("UTC", Measurement.observed_at))
        power = func.coalesce(Measurement.power_w, 0.0)
        energy_by_time = func.array_agg(
            aggregate_order_by(Measurement.energy_wh, Measurement.observed_at), type_=ARRAY(Float)
        ).filter(Measurement.energy_wh.is_not(None))
        energy_backwards = func.array_agg(
            aggregate_order_by(Measurement.energy_wh, Measurement.observed_at.desc()),
            type_=ARRAY(Float),
        ).filter(Measurement.energy_wh.is_not(None))
        with self._session() as session:
            rows: Any = session.execute(
                select(
                    Measurement.device_id,
                    local_hour,
                    utc_offset,
                    func.min(Measurement.energy_wh),
                    func.max(Measurement.energy_wh),
                    energy_by_time[1],
                    energy_backwards[1],
                    func.avg(func.greatest(power, 0.0)),
                    func.avg(func.greatest(-power, 0.0)),
                    func.min(Measurement.observed_at),
                    func.max(Measurement.observed_at),
                )
                .where(
                    Measurement.site_id == site_id,
                    Measurement.device_id.in_(device_ids),
                    Measurement.observed_at >= since,
                )
                .group_by(Measurement.device_id, local_hour, utc_offset)
            ).all()
        zone = site_zone(timezone)
        return [
            MeterHour(
                device_id=device_id,
                hour=(hour - timedelta(seconds=float(offset))).replace(tzinfo=UTC).astimezone(zone),
                min_energy_wh=min_energy,
                max_energy_wh=max_energy,
                first_energy_wh=first_energy,
                last_energy_wh=last_energy,
                avg_import_w=float(avg_import or 0.0),
                avg_export_w=float(avg_export or 0.0),
                first=first,
                last=last,
            )
            for (
                device_id,
                hour,
                offset,
                min_energy,
                max_energy,
                first_energy,
                last_energy,
                avg_import,
                avg_export,
                first,
                last,
            ) in rows
        ]

    # --- telemetry ----------------------------------------------------------------

    def _store_measurement(self, telemetry: Telemetry) -> bool:
        metrics = telemetry.metrics
        statement = (
            insert(Measurement)
            .values(
                id=uuid4(),
                site_id=telemetry.site_id,
                device_id=telemetry.device_id,
                message_id=telemetry.message_id,
                observed_at=telemetry.observed_at,
                power_w=metrics.power_w,
                energy_wh=metrics.energy_wh,
                soc_pct=metrics.soc_pct,
                voltage_v=metrics.voltage_v,
                current_a=metrics.current_a,
                state=telemetry.state.model_dump(exclude_none=True) if telemetry.state else None,
            )
            .on_conflict_do_nothing(index_elements=["device_id", "message_id"])
            .returning(Measurement.id)
        )
        with self._session() as session, session.begin():
            session.execute(text("SET LOCAL statement_timeout = '5s'"))
            session.execute(text("SET LOCAL lock_timeout = '3s'"))
            return session.execute(statement).first() is not None

    def _accept_telemetry(self, telemetry: Telemetry, received_at: datetime) -> bool:
        # Inclusive UTC window; subtraction also handles extreme valid timestamps safely.
        age = received_at - telemetry.observed_at
        if age < -MAX_CLOCK_SKEW or age > MAX_PAST_AGE:
            raise InvalidRequest("observed_at outside freshness window; check the device clock")
        if self.find_device(telemetry.site_id, telemetry.device_id) is None:
            raise NotFound("Unknown device for this site")
        return self._store_measurement(telemetry)

    async def ingest_telemetry(self, telemetry: Telemetry) -> bool:
        """Persist and broadcast. Returns False for a duplicate delivery."""
        received_at = self._clock()
        stored = await asyncio.to_thread(self._accept_telemetry, telemetry, received_at)
        if not stored:
            return False
        if self.live.record(telemetry, received_at):
            await self.broadcast_snapshot(telemetry.site_id)
        return True

    async def broadcast_snapshot(self, site_id: UUID) -> None:
        if not self.hub.has_subscribers(site_id):
            return
        snapshot = await asyncio.to_thread(self.snapshot, site_id)
        self.hub.publish(site_id, {"type": "snapshot", "data": snapshot.model_dump(mode="json")})

    # --- commands -----------------------------------------------------------------

    def _insert_command(
        self, site_id: UUID, device_id: UUID, request: CommandRequest
    ) -> CommandOut:
        device = self.find_device(site_id, device_id)
        if device is None:
            raise NotFound("Device not found")
        validate_command(device, request)
        now = self._clock()
        row = Command(
            id=uuid4(),
            site_id=site_id,
            device_id=device_id,
            type=request.type.value,
            params=request.params.model_dump(mode="json"),
            status=CommandStatus.PENDING.value,
            created_at=now,
            expires_at=now + self._command_ttl,
        )
        with self._session() as session, session.begin():
            session.add(row)
        return command_out(row)

    def _set_status(
        self,
        command_id: UUID,
        status: CommandStatus,
        reason: str | None = None,
        acknowledged_at: datetime | None = None,
        only_from: frozenset[CommandStatus] | None = None,
    ) -> CommandOut | None:
        statement = update(Command).where(Command.id == command_id)
        if only_from is not None:
            statement = statement.where(Command.status.in_([s.value for s in only_from]))
        values: dict[str, Any] = {"status": status.value, "reason": reason}
        if acknowledged_at is not None:
            values["acknowledged_at"] = acknowledged_at
        with self._session() as session, session.begin():
            row = session.scalars(statement.values(**values).returning(Command)).first()
            return command_out(row) if row is not None else None

    def _publish_event(self, command: CommandOut) -> None:
        event = {"type": "command", "data": command.model_dump(mode="json")}
        self.hub.publish(command.site_id, event)

    async def send_command(
        self, site_id: UUID, device_id: UUID, request: CommandRequest
    ) -> CommandOut:
        command = await asyncio.to_thread(self._insert_command, site_id, device_id, request)
        self._publish_event(command)
        message = CommandMessage(
            version=1,
            command_id=command.id,
            issued_at=command.created_at,
            expires_at=command.expires_at,
            type=command.type,
            params=command.params,
        )
        status, reason = CommandStatus.SENT, None
        if self.publisher is None:
            status, reason = CommandStatus.FAILED, "MQTT is not configured"
        else:
            try:
                await self.publisher.publish_command(site_id, device_id, message)
            except Exception:
                logger.exception("Publishing command %s failed", command.id)
                status, reason = CommandStatus.FAILED, "Message broker unavailable"
        updated = await asyncio.to_thread(
            self._set_status,
            command.id,
            status,
            reason,
            only_from=frozenset({CommandStatus.PENDING}),
        )
        # A very fast device may already have acknowledged; keep its answer.
        result = updated
        if result is None:
            result = await asyncio.to_thread(self.get_command, site_id, command.id)
        self._publish_event(result)
        return result

    def get_command(self, site_id: UUID, command_id: UUID) -> CommandOut:
        with self._session() as session:
            row = session.get(Command, command_id)
        if row is None or row.site_id != site_id:
            raise NotFound("Command not found")
        return command_out(row)

    def list_commands(self, site_id: UUID, limit: int) -> list[CommandOut]:
        with self._session() as session:
            rows = session.scalars(
                select(Command)
                .where(Command.site_id == site_id)
                .order_by(Command.created_at.desc())
                .limit(limit)
            ).all()
        return [command_out(row) for row in rows]

    def _apply_ack(self, site_id: UUID, device_id: UUID, ack: CommandAck) -> CommandOut | None:
        with self._session() as session:
            row = session.get(Command, ack.command_id)
        if row is None or row.site_id != site_id or row.device_id != device_id:
            logger.warning("Ignoring ack for unknown command %s", ack.command_id)
            return None
        applied = ack.status == AckStatus.APPLIED
        status = CommandStatus.APPLIED if applied else CommandStatus.REJECTED
        # A late ack still overrides "expired": it reports what physically happened.
        return self._set_status(
            ack.command_id,
            status,
            ack.reason,
            acknowledged_at=self._clock(),
            only_from=frozenset({CommandStatus.PENDING, CommandStatus.SENT, CommandStatus.EXPIRED}),
        )

    async def handle_ack(self, site_id: UUID, device_id: UUID, ack: CommandAck) -> None:
        command = await asyncio.to_thread(self._apply_ack, site_id, device_id, ack)
        if command is not None:
            self._publish_event(command)

    def _expire_due(self) -> list[CommandOut]:
        statement = (
            update(Command)
            .where(
                Command.status.in_([CommandStatus.PENDING.value, CommandStatus.SENT.value]),
                Command.expires_at < self._clock(),
            )
            .values(status=CommandStatus.EXPIRED.value, reason="No acknowledgement from device")
            .returning(Command)
        )
        with self._session() as session, session.begin():
            return [command_out(row) for row in session.scalars(statement).all()]

    async def expire_due_commands(self) -> None:
        for command in await asyncio.to_thread(self._expire_due):
            self._publish_event(command)

    async def run_maintenance(self, interval_s: float = 1.0) -> None:
        while True:
            try:
                await self.expire_due_commands()
            except DatabaseUnavailable:
                return
            except Exception:
                logger.exception("Command expiry sweep failed")
            await asyncio.sleep(interval_s)
