from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

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


def test_sites_list_only_the_callers_own_sites(
    registry_client, registry_data, signed_headers, users
):
    site, other, empty = registry_data[:3]
    mine = registry_client.get("/sites", headers=signed_headers(users[0]))
    theirs = registry_client.get("/sites", headers=signed_headers(users[1]))
    nobody = registry_client.get("/sites", headers=signed_headers(uuid4()))
    assert mine.status_code == theirs.status_code == nobody.status_code == 200
    assert sorted(item["id"] for item in mine.json()) == sorted([str(site.id), str(empty.id)])
    assert [item["id"] for item in theirs.json()] == [str(other.id)]
    assert nobody.json() == []


def test_sites_are_listed_newest_first_then_by_id(registry_client, registry_db, signed_headers):
    owner = UUID("0a000000-0000-4000-8000-000000000001")
    first = datetime(2026, 10, 1, 8, tzinfo=UTC)
    for n, name, hours in [(1, "Workshop", 1), (2, "Office", 2), (3, "Cabin", 0), (4, "Home", 2)]:
        registry_db.add(
            Site(
                id=UUID(f"5e000000-0000-4000-8000-00000000000{n}"),
                owner_id=owner,
                name=name,
                timezone="Europe/Sofia",
                created_at=first + timedelta(hours=hours),
            )
        )
    registry_db.add(Site(owner_id=uuid4(), name="Not mine", created_at=first + timedelta(hours=3)))
    registry_db.flush()
    response = registry_client.get("/sites", headers=signed_headers(owner))
    assert response.status_code == 200
    assert [item["name"] for item in response.json()] == ["Office", "Home", "Workshop", "Cabin"]
    assert response.json()[0] == {
        "id": "5e000000-0000-4000-8000-000000000002",
        "owner_id": "0a000000-0000-4000-8000-000000000001",
        "name": "Office",
        "timezone": "Europe/Sofia",
        "currency": "EUR",
        "created_at": "2026-10-01T10:00:00Z",
    }


def test_owner_lists_the_devices_of_their_site(
    registry_client, registry_data, signed_headers, users
):
    site, other, empty, device, other_device = registry_data
    mine = registry_client.get(f"/sites/{site.id}/devices", headers=signed_headers(users[0]))
    theirs = registry_client.get(f"/sites/{other.id}/devices", headers=signed_headers(users[1]))
    none = registry_client.get(f"/sites/{empty.id}/devices", headers=signed_headers(users[0]))
    assert mine.status_code == theirs.status_code == none.status_code == 200
    assert [item["id"] for item in mine.json()] == [str(device.id)]
    assert [item["id"] for item in theirs.json()] == [str(other_device.id)]
    assert none.json() == []


def test_devices_of_another_users_site_are_not_found(
    registry_client, registry_data, signed_headers, users
):
    site, other = registry_data[:2]
    for user, site_id in [(users[0], other.id), (users[1], site.id), (users[0], uuid4())]:
        response = registry_client.get(f"/sites/{site_id}/devices", headers=signed_headers(user))
        assert response.status_code == 404
        assert response.json() == {"detail": "Site not found"}


def test_devices_are_listed_by_name_then_id(registry_client, registry_db, signed_headers):
    owner = UUID("0a000000-0000-4000-8000-000000000001")
    site = Site(
        id=UUID("5e000000-0000-4000-8000-000000000001"),
        owner_id=owner,
        name="Home",
        timezone="Europe/Sofia",
        created_at=datetime(2026, 10, 1, 8, tzinfo=UTC),
    )
    registry_db.add(site)
    registry_db.flush()
    created_at = datetime(2026, 10, 1, 9, tzinfo=UTC)
    registry_db.add_all(
        [
            Device(
                id=UUID("de000000-0000-4000-8000-000000000003"),
                site_id=site.id,
                name="Plug",
                kind="smart_plug",
                source="hardware",
                capabilities=["measure_power", "switch"],
                limits={"max_power_w": 2000},
                created_at=created_at,
            ),
            Device(
                id=UUID("de000000-0000-4000-8000-000000000002"),
                site_id=site.id,
                name="Battery",
                kind="battery",
                source="simulator",
                capabilities=["measure_power", "battery_soc", "power_setpoint"],
                limits={"min_power_w": 100, "max_power_w": 2000, "capacity_wh": 10000},
                created_at=created_at,
            ),
            Device(
                id=UUID("de000000-0000-4000-8000-000000000001"),
                site_id=site.id,
                name="Plug",
                kind="smart_plug",
                source="simulator",
                capabilities=["measure_power", "switch"],
                created_at=created_at,
            ),
        ]
    )
    registry_db.flush()
    response = registry_client.get(f"/sites/{site.id}/devices", headers=signed_headers(owner))
    assert response.status_code == 200
    assert response.json() == [
        {
            "id": "de000000-0000-4000-8000-000000000002",
            "site_id": "5e000000-0000-4000-8000-000000000001",
            "name": "Battery",
            "kind": "battery",
            "source": "simulator",
            "capabilities": ["measure_power", "battery_soc", "power_setpoint"],
            "limits": {"min_power_w": 100.0, "max_power_w": 2000.0, "capacity_wh": 10000.0},
            "created_at": "2026-10-01T09:00:00Z",
        },
        {
            "id": "de000000-0000-4000-8000-000000000001",
            "site_id": "5e000000-0000-4000-8000-000000000001",
            "name": "Plug",
            "kind": "smart_plug",
            "source": "simulator",
            "capabilities": ["measure_power", "switch"],
            "limits": {},
            "created_at": "2026-10-01T09:00:00Z",
        },
        {
            "id": "de000000-0000-4000-8000-000000000003",
            "site_id": "5e000000-0000-4000-8000-000000000001",
            "name": "Plug",
            "kind": "smart_plug",
            "source": "hardware",
            "capabilities": ["measure_power", "switch"],
            "limits": {"max_power_w": 2000.0},
            "created_at": "2026-10-01T09:00:00Z",
        },
    ]


@pytest.mark.parametrize("path", ["/sites", f"/sites/{uuid4()}/devices"])
def test_database_outage_on_reads_does_not_leak_internal_details(
    registry_client, registry_db, signed_headers, users, monkeypatch, path
):
    def unavailable(*args, **kwargs):
        raise OperationalError("secret-statement", {}, RuntimeError("secret-host"))

    monkeypatch.setattr(registry_db, "scalar", unavailable)
    monkeypatch.setattr(registry_db, "scalars", unavailable)
    response = registry_client.get(path, headers=signed_headers(users[0]))
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
