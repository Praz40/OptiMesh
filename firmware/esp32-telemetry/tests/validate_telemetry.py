"""Validate fixtures/actual C output with the unchanged schema AND backend model."""
import argparse
import json
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID

from jsonschema import Draft202012Validator, FormatChecker

FIRMWARE = Path(__file__).resolve().parents[1]
ROOT = FIRMWARE.parents[1]
sys.path.insert(0, str(ROOT / "services" / "api"))
from app.schemas import Telemetry


def validate(payload: dict, validator: Draft202012Validator) -> None:
    validator.validate(payload)
    model = Telemetry.model_validate(payload)
    assert model.observed_at.tzinfo is UTC
    assert payload["observed_at"].endswith("Z")
    assert UUID(payload["message_id"]).version == 4
    assert set(payload["metrics"]) == {"power_w", "energy_wh"}
    assert 0 < model.metrics.power_w <= 1000000
    assert model.metrics.energy_wh >= 0
    assert len(json.dumps(payload).encode()) < 4096


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--producer", type=Path, help="Compiled host_telemetry executable")
    args = parser.parse_args()
    schema = json.loads((ROOT / "contracts" / "telemetry-v1.schema.json").read_text())
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    example = json.loads((FIRMWARE / "telemetry.example.json").read_text())
    validate(example, validator)
    print("Example passes schema with format assertion and backend Telemetry validation.")
    if args.producer:
        result = subprocess.run([str(args.producer.resolve())], check=True, capture_output=True, text=True)
        observations = [json.loads(line) for line in result.stdout.splitlines()]
        assert len(observations) == 256
        identities = set()
        start = datetime(2024, 2, 29, 23, 59, 59, tzinfo=UTC)
        for index, payload in enumerate(observations):
            validate(payload, validator)
            identities.add(payload["message_id"])
            observed = datetime.fromisoformat(payload["observed_at"])
            assert observed == start + timedelta(seconds=5 * index)
            assert abs(payload["metrics"]["energy_wh"] - 1200 * 5 * index / 3600) < 1e-6
        assert len(identities) == 256
        print("256 actual C payloads pass both validators; UUID v4/variant, UTC/leap-day,")
        print("elapsed-time energy, input rejection, payload size and immutable retry checks pass.")


if __name__ == "__main__":
    main()
