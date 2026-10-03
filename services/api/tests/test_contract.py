import json
from datetime import UTC
from pathlib import Path
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.export_contract import CONTRACTS
from app.schemas import CommandAck, CommandMessage, Telemetry


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


@pytest.mark.parametrize("name", sorted(CONTRACTS))
def test_exported_contracts_match_python_schemas(name: str) -> None:
    target = Path(__file__).resolve().parents[3] / "contracts" / name
    assert json.loads(target.read_text(encoding="utf-8")) == CONTRACTS[name].model_json_schema()


def test_example_payloads_are_valid() -> None:
    contracts = Path(__file__).resolve().parents[3] / "contracts"
    Telemetry.model_validate_json((contracts / "telemetry-v1.example.json").read_text())
    CommandMessage.model_validate_json((contracts / "command-v1.example.json").read_text())
    CommandAck.model_validate_json((contracts / "ack-v1.example.json").read_text())


def test_state_and_electrical_metrics_are_optional_extensions() -> None:
    telemetry = Telemetry.model_validate(
        {
            **payload(),
            "metrics": {"power_w": 55.2, "voltage_v": 229.8, "current_a": 0.24},
            "state": {"on": True},
        }
    )
    assert telemetry.state is not None and telemetry.state.on is True
    with pytest.raises(ValidationError):
        Telemetry.model_validate({**payload(), "state": {"brightness": 3}})


def test_ack_rejects_unknown_status() -> None:
    with pytest.raises(ValidationError):
        CommandAck.model_validate(
            {
                "version": 1,
                "command_id": str(uuid4()),
                "status": "done",
                "observed_at": "2026-10-02T20:00:00Z",
            }
        )
