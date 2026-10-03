from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from app.models import Device, Site

pytestmark = pytest.mark.integration


def test_sites_can_be_provisioned_without_manual_database_edits(
    registry_client, registry_db, signed_headers, users
):
    response = registry_client.post(
        "/sites",
        headers=signed_headers(users[0]),
        json={"name": "  Home  ", "timezone": "Europe/Sofia", "currency": "EUR"},
    )
    assert response.status_code == 201
    site = registry_db.get(Site, response.json()["id"])
    assert site.owner_id == users[0]
    assert site.name == "Home"
    assert site.timezone == "Europe/Sofia"
    assert response.json()["created_at"].endswith("Z")


@pytest.mark.parametrize(
    "body",
    [
        {"name": " "},
        {"name": "x" * 121},
        {"name": "Home", "timezone": "Missing/Zone"},
        {"name": "Home", "currency": "eu"},
        {"name": "Home", "owner_id": str(uuid4())},
    ],
)
def test_invalid_sites_are_rejected(registry_client, signed_headers, users, body):
    assert (
        registry_client.post("/sites", headers=signed_headers(users[0]), json=body).status_code
        == 422
    )


def test_device_provisioning_persists_capabilities_and_configured_limits(
    registry_client, registry_db, registry_data, signed_headers, users
):
    site = registry_data[0]
    body = {
        "name": "  Battery 2  ",
        "kind": "battery",
        "source": "hardware",
        "capabilities": ["measure_power", "power_setpoint", "battery_soc"],
        "limits": {
            "min_power_w": 100,
            "max_power_w": 2000,
            "capacity_wh": 10000,
        },
    }
    response = registry_client.post(
        f"/sites/{site.id}/devices", headers=signed_headers(users[0]), json=body
    )
    assert response.status_code == 201
    row = registry_db.get(Device, response.json()["id"])
    assert row.site_id == site.id
    assert row.name == "Battery 2"
    assert row.capabilities == body["capabilities"]
    assert row.limits == body["limits"]
    assert response.json()["limits"] == body["limits"]


def test_device_provisioning_cannot_target_another_users_site(
    registry_client, registry_db, registry_data, signed_headers, users
):
    other = registry_data[1]
    before = list(registry_db.scalars(select(Device.id)))
    response = registry_client.post(
        f"/sites/{other.id}/devices",
        headers=signed_headers(users[0]),
        json={"name": "Attack", "kind": "load", "source": "simulator"},
    )
    assert response.status_code == 404
    assert list(registry_db.scalars(select(Device.id))) == before


@pytest.mark.parametrize(
    "changes",
    [
        {"name": " "},
        {"kind": " "},
        {"source": "unknown"},
        {"capabilities": ["unknown"]},
        {"capabilities": ["switch", "switch"]},
        {"kind": "meter"},
        {"limits": {"min_power_w": 10, "max_power_w": 5}},
        {"limits": {"min_power_w": -1}},
        {"limits": {"capacity_wh": 0}},
        {"limits": {"min_soc_pct": 20}},
        {"limits": {"max_power_w": "Infinity"}},
        {"limits": {"max_power_w": "NaN"}},
        {"limits": {"unknown_limit": 1}},
        {"operating_limits": {}},
        {"site_id": str(uuid4())},
    ],
)
def test_invalid_device_configuration_is_rejected(
    registry_client, registry_data, signed_headers, users, changes
):
    body = {"name": "Device", "kind": "load", "source": "hardware", **changes}
    assert (
        registry_client.post(
            f"/sites/{registry_data[0].id}/devices", headers=signed_headers(users[0]), json=body
        ).status_code
        == 422
    )


def test_database_outage_does_not_leak_internal_details(
    registry_client, registry_db, signed_headers, users, monkeypatch
):
    def unavailable(*args, **kwargs):
        raise OperationalError("secret-statement", {}, RuntimeError("secret-host"))

    monkeypatch.setattr(registry_db, "scalar", unavailable)
    response = registry_client.post(
        f"/sites/{uuid4()}/devices",
        headers=signed_headers(users[0]),
        json={"name": "Meter", "kind": "grid_meter", "source": "hardware"},
    )
    assert response.status_code == 503
    assert response.json() == {"detail": "Database unavailable"}


def test_real_request_sessions_commit_and_persist_across_requests(signed_headers, users):
    import os
    from uuid import UUID

    from fastapi.testclient import TestClient
    from sqlalchemy import delete
    from sqlalchemy.orm import Session

    from app.config import Settings
    from app.database import build_engine
    from app.main import create_app

    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    engine = build_engine(url)
    try:
        with TestClient(
            create_app(
                Settings(_env_file=None, database_url=url, supabase_url="https://auth.example.test")
            )
        ) as client:
            headers = signed_headers(users[0])
            site = client.post("/sites", headers=headers, json={"name": "Persistent"})
            assert site.status_code == 201
            site_id = UUID(site.json()["id"])
            device = client.post(
                f"/sites/{site_id}/devices",
                headers=headers,
                json={"name": "Meter", "kind": "grid_meter", "source": "hardware"},
            )
            assert device.status_code == 201
            device_id = UUID(device.json()["id"])
            with Session(engine) as db:
                assert db.get(Site, site_id).owner_id == users[0]
                assert db.get(Device, device_id).limits == {}
    finally:
        with Session(engine) as db:
            db.execute(delete(Site).where(Site.owner_id.in_(users)))
            db.commit()
        engine.dispose()
