from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest

from app.models import Device, Measurement

pytestmark = pytest.mark.integration
BOUNDS = {"start": "2026-10-01T00:00:00Z", "end": "2026-10-02T00:00:00Z"}


@pytest.fixture
def history_data(registry_db, registry_data):
    site, other, _, device, other_device = registry_data
    second = Device(site_id=site.id, name="Meter", kind="meter", source="hardware")
    registry_db.add(second)
    registry_db.flush()
    rows = [
        (1, site, second, datetime(2026, 10, 1, tzinfo=UTC)),
        (2, site, device, datetime(2026, 10, 1, 12, tzinfo=UTC)),
        (3, site, device, datetime(2026, 10, 1, 12, tzinfo=UTC)),
        (4, site, device, datetime(2026, 10, 1, 12, tzinfo=UTC)),
        (5, site, device, datetime(2026, 10, 2, tzinfo=UTC)),
        (6, site, device, datetime(2026, 9, 30, tzinfo=UTC)),
        (7, other, other_device, datetime(2026, 10, 1, 12, tzinfo=UTC)),
    ]
    for identifier, target_site, target_device, observed_at in rows:
        registry_db.add(
            Measurement(
                id=UUID(int=identifier),
                site_id=target_site.id,
                device_id=target_device.id,
                message_id=uuid4(),
                observed_at=observed_at,
                power_w=-100,
            )
        )
    registry_db.flush()
    return site, device, second


def test_history_pagination_handles_equal_timestamps_without_gaps(
    registry_client, history_data, signed_headers, users
):
    site, _, _ = history_data
    headers = signed_headers(users[0])
    path = f"/sites/{site.id}/measurements"
    first = registry_client.get(path, headers=headers, params={**BOUNDS, "limit": 2})
    assert first.status_code == 200
    page = first.json()
    assert [row["id"] for row in page["items"]] == [str(UUID(int=1)), str(UUID(int=2))]
    assert page["next_cursor"]
    second = registry_client.get(
        path, headers=headers, params={**BOUNDS, "limit": 2, "cursor": page["next_cursor"]}
    )
    assert second.status_code == 200
    assert [row["id"] for row in second.json()["items"]] == [str(UUID(int=3)), str(UUID(int=4))]
    assert second.json()["next_cursor"] is None
    assert all(row["observed_at"].endswith("Z") for row in page["items"])
    assert page["items"][0]["power_w"] == -100


def test_history_device_filter_and_timezone_normalization(
    registry_client, history_data, signed_headers, users
):
    site, device, _ = history_data
    response = registry_client.get(
        f"/sites/{site.id}/measurements",
        headers=signed_headers(users[0]),
        params={
            "start": "2026-10-01T03:00:00+03:00",
            "end": "2026-10-02T03:00:00+03:00",
            "device_id": str(device.id),
        },
    )
    assert response.status_code == 200
    assert [row["id"] for row in response.json()["items"]] == [
        str(UUID(int=2)),
        str(UUID(int=3)),
        str(UUID(int=4)),
    ]


def test_history_empty_missing_and_unauthorized_states(
    registry_client, registry_data, signed_headers, users
):
    site, other, empty, _, other_device = registry_data
    headers = signed_headers(users[0])
    response = registry_client.get(
        f"/sites/{empty.id}/measurements", headers=headers, params=BOUNDS
    )
    assert response.status_code == 200
    assert response.json() == {"items": [], "next_cursor": None}
    for target in [other.id, uuid4()]:
        assert (
            registry_client.get(
                f"/sites/{target}/measurements", headers=headers, params=BOUNDS
            ).status_code
            == 404
        )
    for device_id in [other_device.id, uuid4()]:
        assert (
            registry_client.get(
                f"/sites/{site.id}/measurements",
                headers=headers,
                params={**BOUNDS, "device_id": str(device_id)},
            ).status_code
            == 404
        )


@pytest.mark.parametrize(
    "changes",
    [
        {"start": "2026-10-01T00:00:00"},
        {"start": "2026-10-03T00:00:00Z"},
        {"end": "2026-10-01T00:00:00Z"},
        {"end": "2026-11-01T00:00:01Z"},
        {"limit": 0},
        {"limit": 501},
        {"limit": "invalid"},
        {"cursor": "broken"},
        {"cursor": "!"},
        {"cursor": "x" * 2049},
    ],
)
def test_history_rejects_invalid_bounds_limits_and_cursors(
    registry_client, registry_data, signed_headers, users, changes
):
    response = registry_client.get(
        f"/sites/{registry_data[0].id}/measurements",
        headers=signed_headers(users[0]),
        params={**BOUNDS, **changes},
    )
    assert response.status_code == 422


def test_history_accepts_maximum_window_and_page_size(
    registry_client, registry_data, signed_headers, users
):
    response = registry_client.get(
        f"/sites/{registry_data[0].id}/measurements",
        headers=signed_headers(users[0]),
        params={**BOUNDS, "end": "2026-10-31T00:00:00Z", "limit": 500},
    )
    assert response.status_code == 200


def test_cursor_cannot_be_reused_with_different_query(
    registry_client, history_data, signed_headers, users
):
    site, _, second_device = history_data
    headers = signed_headers(users[0])
    path = f"/sites/{site.id}/measurements"
    cursor = registry_client.get(path, headers=headers, params={**BOUNDS, "limit": 1}).json()[
        "next_cursor"
    ]
    for changes in [{"end": "2026-10-03T00:00:00Z"}, {"device_id": str(second_device.id)}]:
        assert (
            registry_client.get(
                path, headers=headers, params={**BOUNDS, "cursor": cursor, **changes}
            ).status_code
            == 422
        )


@pytest.mark.parametrize(
    "bounds",
    [
        {"start": "0001-01-01T00:00:00+14:00", "end": "0001-01-02T00:00:00Z"},
        {"start": "9999-12-30T00:00:00Z", "end": "9999-12-31T23:59:59-14:00"},
    ],
)
def test_unrepresentable_utc_history_bounds_are_validation_errors(
    registry_client, registry_data, signed_headers, users, bounds
):
    response = registry_client.get(
        f"/sites/{registry_data[0].id}/measurements",
        headers=signed_headers(users[0]),
        params=bounds,
    )
    assert response.status_code == 422
