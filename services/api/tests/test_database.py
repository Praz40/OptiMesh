import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import Settings
from app.database import build_engine
from app.main import create_app
from app.models import Device, Measurement, Site

pytestmark = pytest.mark.integration
database_url = os.environ.get("TEST_DATABASE_URL")
if not database_url:
    pytest.skip("TEST_DATABASE_URL is not configured", allow_module_level=True)


@pytest.fixture
def session():
    engine = build_engine(database_url)
    with engine.connect() as connection:
        transaction = connection.begin()
        with Session(bind=connection) as db:
            try:
                yield db
            finally:
                transaction.rollback()
    engine.dispose()


def devices(session):
    site = Site(owner_id=uuid4(), name="Office")
    other_site = Site(owner_id=uuid4(), name="Home")
    session.add_all([site, other_site])
    session.flush()
    device = Device(site_id=site.id, name="Demo load", kind="load", source="simulator")
    session.add(device)
    session.flush()
    return site, other_site, device


def measurement(site_id, device_id, **metrics):
    return Measurement(
        site_id=site_id,
        device_id=device_id,
        message_id=uuid4(),
        observed_at=datetime.now(UTC),
        **metrics,
    )


def test_database_roundtrip_and_duplicate_delivery(session):
    site, _, device = devices(session)
    row = measurement(site.id, device.id, power_w=100.0)
    session.add(row)
    session.flush()
    assert session.get(Measurement, row.id).power_w == 100.0
    with pytest.raises(IntegrityError), session.begin_nested():
        duplicate = measurement(site.id, device.id, power_w=100.0)
        duplicate.message_id = row.message_id
        session.add(duplicate)
        session.flush()


def test_device_cannot_be_recorded_under_another_site(session):
    _, other_site, device = devices(session)
    with pytest.raises(IntegrityError), session.begin_nested():
        session.add(measurement(other_site.id, device.id, power_w=100.0))
        session.flush()


@pytest.mark.parametrize(
    "metrics",
    [{}, {"power_w": float("inf")}, {"power_w": float("nan")}, {"energy_wh": -1}, {"soc_pct": 101}],
)
def test_database_rejects_invalid_metrics(session, metrics):
    site, _, device = devices(session)
    with pytest.raises(IntegrityError), session.begin_nested():
        session.add(measurement(site.id, device.id, **metrics))
        session.flush()


def test_private_schema_and_readiness(session):
    assert set(inspect(session.get_bind()).get_table_names(schema="optimesh")) >= {
        "sites",
        "devices",
        "measurements",
        "alembic_version",
    }
    with TestClient(create_app(Settings(_env_file=None, database_url=database_url))) as client:
        assert client.get("/ready").status_code == 200
