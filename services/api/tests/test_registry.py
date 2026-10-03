from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from app.models import Device, Site

pytestmark = pytest.mark.integration


def test_sites_are_scoped_to_verified_user(registry_client, registry_data, signed_headers, users):
    site, other, empty, _, _ = registry_data
    response = registry_client.get("/sites", headers=signed_headers(users[0]))
    assert response.status_code == 200
    assert {item["id"] for item in response.json()} == {str(site.id), str(empty.id)}
    assert (
        registry_client.get("/sites/" + str(other.id), headers=signed_headers(users[0])).status_code
        == 404
    )
    assert (
        registry_client.get("/sites/" + str(site.id), headers=signed_headers(users[0])).json()[
            "name"
        ]
        == "Office"
    )


def test_authorized_empty_collections(registry_client, registry_data, signed_headers, users):
    _, _, empty, _, _ = registry_data
    assert registry_client.get("/sites", headers=signed_headers(uuid4())).json() == []
    response = registry_client.get(f"/sites/{empty.id}/devices", headers=signed_headers(users[0]))
    assert response.status_code == 200
    assert response.json() == []


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


def test_device_reads_and_site_device_mismatches(
    registry_client, registry_data, signed_headers, users
):
    site, other, _, device, other_device = registry_data
    headers = signed_headers(users[0])
    response = registry_client.get(f"/sites/{site.id}/devices", headers=headers)
    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [str(device.id)]
    assert (
        registry_client.get(f"/sites/{site.id}/devices/{device.id}", headers=headers).status_code
        == 200
    )
    for path in [
        f"/sites/{other.id}/devices",
        f"/sites/{other.id}/devices/{other_device.id}",
        f"/sites/{site.id}/devices/{other_device.id}",
        f"/sites/{uuid4()}/devices",
        f"/sites/{site.id}/devices/{uuid4()}",
    ]:
        assert registry_client.get(path, headers=headers).status_code == 404


def test_device_provisioning_persists_capabilities_and_configured_limits(
    registry_client, registry_db, registry_data, signed_headers, users
):
    site = registry_data[0]
    body = {
        "name": "  Battery 2  ",
        "kind": "battery",
        "source": "hardware",
        "capabilities": ["measure_power", "power_setpoint", "battery_soc"],
        "operating_limits": {
            "min_power_w": -500,
            "max_power_w": 2000,
            "min_soc_pct": 20,
            "max_soc_pct": 90,
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
    assert row.operating_limits == body["operating_limits"]
    assert response.json()["operating_limits"] == body["operating_limits"]


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
        {"operating_limits": {"min_power_w": 10, "max_power_w": 5}},
        {"operating_limits": {"min_soc_pct": -1}},
        {"operating_limits": {"max_soc_pct": 101}},
        {"operating_limits": {"min_soc_pct": 80, "max_soc_pct": 20}},
        {"operating_limits": {"max_power_w": "Infinity"}},
        {"operating_limits": {"max_power_w": "NaN"}},
        {"operating_limits": {"unknown_limit": 1}},
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

    monkeypatch.setattr(registry_db, "scalars", unavailable)
    response = registry_client.get("/sites", headers=signed_headers(users[0]))
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
                json={"name": "Meter", "kind": "meter", "source": "hardware"},
            )
            assert device.status_code == 201
            device_id = UUID(device.json()["id"])
            assert (
                client.get(f"/sites/{site_id}/devices/{device_id}", headers=headers).status_code
                == 200
            )
            with Session(engine) as db:
                assert db.get(Site, site_id).owner_id == users[0]
                assert db.get(Device, device_id).operating_limits == {}
    finally:
        with Session(engine) as db:
            db.execute(delete(Site).where(Site.owner_id.in_(users)))
            db.commit()
        engine.dispose()
