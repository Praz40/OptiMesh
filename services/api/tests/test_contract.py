import json
from datetime import UTC
from pathlib import Path
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas import Telemetry


def payload() -> dict:
    return {
        "version": 1,
        "site_id": str(uuid4()),
        "device_id": str(uuid4()),
        "message_id": str(uuid4()),
        "observed_at": "2026-10-02T20:00:00+03:00",
        "metrics": {"power_w": 1200.0, "soc_pct": 50.0},
    }


def test_hardware_and_simulator_use_identical_contract() -> None:
    telemetry = Telemetry.model_validate(payload())
    assert telemetry.observed_at.tzinfo is UTC
    assert telemetry.observed_at.hour == 17
    assert telemetry.metrics.power_w == 1200.0


@pytest.mark.parametrize(
    "metrics",
    [
        {},
        {"power_w": None},
        {"power_w": float("nan")},
        {"power_w": float("inf")},
        {"energy_wh": -1},
        {"soc_pct": -1},
        {"soc_pct": 101},
        {"energy_wh": float("inf")},
        {"power_kw": 1},
    ],
)
def test_invalid_metrics_are_rejected(metrics: dict) -> None:
    with pytest.raises(ValidationError):
        Telemetry.model_validate({**payload(), "metrics": metrics})


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("version", 2),
        ("site_id", "bad-id"),
        ("observed_at", "2026-10-02T20:00:00"),
        ("unexpected", "ignored-by-accident"),
    ],
)
def test_invalid_envelopes_are_rejected(field: str, value: object) -> None:
    with pytest.raises(ValidationError):
        Telemetry.model_validate({**payload(), field: value})


def test_exported_contract_matches_python_schema() -> None:
    target = Path(__file__).resolve().parents[3] / "contracts" / "telemetry-v1.schema.json"
    assert json.loads(target.read_text(encoding="utf-8")) == Telemetry.model_json_schema()
