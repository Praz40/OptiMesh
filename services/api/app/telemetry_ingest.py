"""Validate telemetry and persist it using the existing PostgreSQL schema."""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import NamedTuple
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Device, Measurement
from app.schemas import Telemetry

MAX_PAYLOAD_BYTES = 4096
MAX_PAST_AGE = timedelta(hours=24)
MAX_FUTURE_SKEW = timedelta(minutes=5)


def _utc_now() -> datetime:
    return datetime.now(UTC)


class PermanentRejection(ValueError):
    """An invalid delivery must be acknowledged without storing it."""


class IngestOutcome(StrEnum):
    STORED = "stored"
    DUPLICATE = "duplicate"


class TelemetryTopic(NamedTuple):
    site_id: UUID
    device_id: UUID


def parse_telemetry_topic(topic: str) -> TelemetryTopic:
    parts = topic.split("/")
    if (
        len(parts) != 7
        or parts[:3] != ["optimesh", "v1", "sites"]
        or parts[4] != "devices"
        or parts[6:] != ["telemetry"]
    ):
        raise PermanentRejection("Invalid telemetry topic")
    try:
        site_id, device_id = UUID(parts[3]), UUID(parts[5])
    except ValueError:
        raise PermanentRejection("Invalid topic identifiers") from None
    if str(site_id) != parts[3] or str(device_id) != parts[5]:
        raise PermanentRejection("Use canonical UUIDs in telemetry topics")
    return TelemetryTopic(site_id, device_id)


def validate_delivery(topic: str, payload: bytes) -> Telemetry:
    ids = parse_telemetry_topic(topic)
    if not 0 < len(payload) <= MAX_PAYLOAD_BYTES:
        raise PermanentRejection("Invalid payload size")
    try:
        telemetry = Telemetry.model_validate_json(payload.decode("utf-8"))
    except (ValueError, OverflowError, RecursionError):
        # Never include a Pydantic exception: it can contain the original payload.
        raise PermanentRejection("Invalid telemetry payload") from None
    if (telemetry.site_id, telemetry.device_id) != ids:
        raise PermanentRejection("Topic and payload identifiers differ")
    # Bounds are inclusive. Compare ages rather than adding/subtracting from
    # datetimes, so even extreme valid UTC timestamps are rejected safely.
    age = _utc_now() - telemetry.observed_at
    if age > MAX_PAST_AGE or age < -MAX_FUTURE_SKEW:
        raise PermanentRejection("Telemetry timestamp outside accepted freshness window")
    return telemetry


class TelemetryIngestor:
    def __init__(self, session_factory: Callable[[], Session]) -> None:
        self._session_factory = session_factory

    def ingest(self, topic: str, payload: bytes) -> IngestOutcome:
        telemetry = validate_delivery(topic, payload)
        try:
            with self._session_factory() as session, session.begin():
                # Bound query/lock waits on this worker without changing REST sessions.
                session.execute(text("SET LOCAL statement_timeout = '5s'"))
                session.execute(text("SET LOCAL lock_timeout = '3s'"))
                device_id = session.scalar(
                    select(Device.id).where(
                        Device.id == telemetry.device_id, Device.site_id == telemetry.site_id
                    )
                )
                if device_id is None:
                    raise PermanentRejection("Unregistered device for this site")
                statement = (
                    insert(Measurement)
                    .values(
                        site_id=telemetry.site_id,
                        device_id=telemetry.device_id,
                        message_id=telemetry.message_id,
                        observed_at=telemetry.observed_at,
                        power_w=telemetry.metrics.power_w,
                        energy_wh=telemetry.metrics.energy_wh,
                        soc_pct=telemetry.metrics.soc_pct,
                    )
                    .on_conflict_do_nothing(constraint="uq_measurements_device_message")
                    .returning(Measurement.id)
                )
                stored = session.scalar(statement) is not None
            # The context manager has committed before a success is returned.
            return IngestOutcome.STORED if stored else IngestOutcome.DUPLICATE
        except IntegrityError as error:
            if getattr(error.orig, "sqlstate", None) == "23503":
                # A registry deletion between lookup and insertion is permanent too.
                raise PermanentRejection("Unregistered device for this site") from None
            raise
