import json
from datetime import UTC, datetime
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from app.models import Measurement
from app.telemetry_ingest import (
    IngestOutcome,
    PermanentRejection,
    TelemetryIngestor,
    parse_telemetry_topic,
    validate_delivery,
)


def reading(site_id=None, device_id=None):
    return {
        "version": 1,
        "site_id": str(site_id or uuid4()),
        "device_id": str(device_id or uuid4()),
        "message_id": str(uuid4()),
        "observed_at": "2026-10-03T12:00:00+03:00",
        "metrics": {"power_w": 1200.0, "energy_wh": 1.666667},
    }


def topic(data):
    return f"optimesh/v1/sites/{data['site_id']}/devices/{data['device_id']}/telemetry"


def test_valid_delivery_preserves_metrics_and_normalizes_time():
    data = reading()
    ids = parse_telemetry_topic(topic(data))
    telemetry = validate_delivery(topic(data), json.dumps(data).encode())
    assert (telemetry.site_id, telemetry.device_id) == ids
    assert telemetry.observed_at == datetime(2026, 10, 3, 9, tzinfo=UTC)
    assert telemetry.metrics.power_w == 1200
    assert telemetry.metrics.energy_wh == 1.666667
    assert telemetry.metrics.soc_pct is None


@pytest.mark.parametrize(
    "change",
    [
        lambda value: value + "/extra",
        lambda value: value.replace("/v1/", "/v2/"),
        lambda value: value.replace("/sites/", "/site/"),
        lambda value: value.replace("/devices/", "/device/"),
        lambda value: value.replace("/telemetry", "/ack"),
        lambda value: value.replace("/telemetry", "/command"),
        lambda value: value.replace("/telemetry", ""),
        lambda value: "prefix/" + value,
        lambda value: value.replace(value.split("/")[3], "not-a-uuid"),
        lambda value: value.replace(value.split("/")[5], "+"),
        lambda value: value.replace(value.split("/")[3], "{" + value.split("/")[3] + "}"),
    ],
)
def test_invalid_topics_are_permanent_rejections(change):
    with pytest.raises(PermanentRejection):
        parse_telemetry_topic(change(topic(reading())))


@pytest.mark.parametrize("payload", [b"", b"not json", b"[]", b"{}", b"\xff", b"x" * 4097])
def test_bad_payloads_are_permanent_rejections(payload):
    with pytest.raises(PermanentRejection):
        validate_delivery(topic(reading()), payload)


@pytest.mark.parametrize(
    "changes",
    [
        {"version": 2},
        {"observed_at": "2026-10-03T12:00:00"},
        {"observed_at": "0001-01-01T00:00:00+14:00"},
        {"state": {"on": True}},
        {"metrics": {}},
        {"metrics": {"power_w": float("inf")}},
        {"metrics": {"energy_wh": -1}},
        {"metrics": {"soc_pct": 101}},
        {"metrics": {"voltage_v": 240}},
        {"site_id": "bad-id"},
    ],
)
def test_schema_failures_are_permanent_rejections(changes):
    data = reading()
    with pytest.raises(PermanentRejection):
        validate_delivery(topic(data), json.dumps({**data, **changes}).encode())


@pytest.mark.parametrize("field", ["site_id", "device_id"])
def test_topic_and_payload_ids_must_match(field):
    data = reading()
    original = topic(data)
    data[field] = str(uuid4())
    with pytest.raises(PermanentRejection):
        validate_delivery(original, json.dumps(data).encode())


def fake_ingestor(results):
    session = MagicMock(spec=Session)
    session.__enter__.return_value = session
    transaction = MagicMock()
    session.begin.return_value = transaction
    session.scalar.side_effect = results
    return TelemetryIngestor(lambda: session), session, transaction


@pytest.mark.parametrize("stored", [True, False])
def test_insert_uses_existing_constraint_and_returns_only_after_commit(stored):
    data = reading()
    ingestor, session, transaction = fake_ingestor([uuid4(), uuid4() if stored else None])
    committed = []
    transaction.__exit__.side_effect = lambda *args: committed.append(True) or False
    outcome = ingestor.ingest(topic(data), json.dumps(data).encode())
    assert committed == [True]
    assert outcome == (IngestOutcome.STORED if stored else IngestOutcome.DUPLICATE)
    statement = session.scalar.call_args_list[-1].args[0]
    sql = str(statement.compile(dialect=postgresql.dialect()))
    assert "ON CONFLICT ON CONSTRAINT uq_measurements_device_message DO NOTHING" in sql
    assert "RETURNING optimesh.measurements.id" in sql
    assert "received_at" not in statement.compile().params


def test_unknown_device_rolls_back_without_attempting_insert():
    data = reading()
    ingestor, session, transaction = fake_ingestor([None])
    with pytest.raises(PermanentRejection):
        ingestor.ingest(topic(data), json.dumps(data).encode())
    assert session.scalar.call_count == 1
    assert transaction.__exit__.call_args.args[0] is PermanentRejection


def test_failed_commit_is_not_successful_ingestion():
    data = reading()
    ingestor, _, transaction = fake_ingestor([uuid4(), uuid4()])
    transaction.__exit__.side_effect = OperationalError("commit", {}, Exception("secret"))
    with pytest.raises(OperationalError):
        ingestor.ingest(topic(data), json.dumps(data).encode())


@pytest.mark.parametrize("sqlstate", ["23503", "23505"])
def test_only_foreign_key_failure_is_a_permanent_registry_rejection(sqlstate):
    data = reading()
    ingestor, session, _ = fake_ingestor([uuid4()])
    error = Exception("private driver error")
    error.sqlstate = sqlstate
    session.scalar.side_effect = IntegrityError("insert", {}, error)
    expected = PermanentRejection if sqlstate == "23503" else IntegrityError
    with pytest.raises(expected):
        ingestor.ingest(topic(data), json.dumps(data).encode())


@pytest.mark.integration
def test_postgresql_ingestion_duplicates_membership_and_history(
    registry_db, registry_data, registry_client, signed_headers, users
):
    site, _, _, device, foreign_device = registry_data
    connection = registry_db.connection()
    ingestor = TelemetryIngestor(
        lambda: Session(bind=connection, join_transaction_mode="create_savepoint")
    )
    data = reading(site.id, device.id)
    assert ingestor.ingest(topic(data), json.dumps(data).encode()) == IngestOutcome.STORED
    first = registry_db.scalar(select(Measurement).where(Measurement.device_id == device.id))
    assert first is not None
    received_at = first.received_at
    data["metrics"]["power_w"] = 999
    assert ingestor.ingest(topic(data), json.dumps(data).encode()) == IngestOutcome.DUPLICATE
    rows = registry_db.scalars(select(Measurement).where(Measurement.device_id == device.id)).all()
    assert len(rows) == 1
    assert rows[0].power_w == 1200
    assert rows[0].received_at == received_at
    assert rows[0].observed_at == datetime(2026, 10, 3, 9, tzinfo=UTC)
    for invalid in [reading(site.id, uuid4()), reading(site.id, foreign_device.id)]:
        with pytest.raises(PermanentRejection):
            ingestor.ingest(topic(invalid), json.dumps(invalid).encode())
    response = registry_client.get(
        f"/sites/{site.id}/measurements",
        headers=signed_headers(users[0]),
        params={"start": "2026-10-03T00:00:00Z", "end": "2026-10-04T00:00:00Z"},
    )
    assert response.status_code == 200
    assert len(response.json()["items"]) == 1
    assert response.json()["items"][0]["message_id"] == data["message_id"]
