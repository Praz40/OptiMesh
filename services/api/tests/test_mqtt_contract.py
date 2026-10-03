"""Conformance checks for the shared MQTT command/acknowledgement contract."""

import json
import re
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import ValidationError as SchemaValidationError
from pydantic import AwareDatetime, TypeAdapter, ValidationError

from app.schemas import Telemetry

ROOT = Path(__file__).resolve().parents[3]
CONTRACTS = ROOT / "contracts"
FORMAT_CHECKER = FormatChecker()
TIMESTAMP = TypeAdapter(AwareDatetime)
# jsonschema's optional RFC 3339 dependency is not part of the existing lockfile.
# Check the wire syntax, then use the backend's existing datetime type to reject
# invalid calendar dates and offsets without adding a validation dependency.
RFC3339 = re.compile(
    r"[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt][0-9]{2}:[0-9]{2}:[0-9]{2}"
    r"(?:\.[0-9]+)?(?:[Zz]|[+-][0-9]{2}:[0-9]{2})"
)


@FORMAT_CHECKER.checks("date-time", raises=ValidationError)
def aware_timestamp(value: object) -> bool:
    if not isinstance(value, str):
        return True  # The schema's type assertion rejects non-string values.
    if RFC3339.fullmatch(value) is None:
        return False
    TIMESTAMP.validate_python(value)
    return True


def example(name: str) -> dict:
    return json.loads((CONTRACTS / f"{name}-v1.example.json").read_text(encoding="utf-8"))


def schema_validator(name: str) -> Draft202012Validator:
    schema = json.loads((CONTRACTS / f"{name}-v1.schema.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    # Do not silently turn an uninstalled/unsupported format checker into a pass.
    assert {"uuid", "date-time"} <= FORMAT_CHECKER.checkers.keys()
    return Draft202012Validator(schema, format_checker=FORMAT_CHECKER)


@pytest.fixture(params=["command", "ack"])
def contract(request: pytest.FixtureRequest) -> tuple[str, Draft202012Validator]:
    return request.param, schema_validator(request.param)


@pytest.fixture
def ack_validator() -> Draft202012Validator:
    return schema_validator("ack")


def test_all_examples_and_documented_payloads(contract: tuple[str, Draft202012Validator]) -> None:
    name, validator = contract
    for path in CONTRACTS.glob(f"{name}-v1*.example.json"):
        validator.validate(json.loads(path.read_text(encoding="utf-8")))
    doc = (ROOT / "docs" / "contracts.md").read_text(encoding="utf-8")
    documented = [json.loads(block) for block in re.findall(r"```json\s+(.*?)```", doc, re.S)]
    messages = [
        value
        for value in documented
        if "command_id" in value and ("command" in value) == (name == "command")
    ]
    assert messages
    assert example(name) in messages
    for message in messages:
        validator.validate(message)


def test_every_required_field_is_enforced(contract: tuple[str, Draft202012Validator]) -> None:
    name, validator = contract
    for field in validator.schema["required"]:
        invalid = example(name)
        del invalid[field]
        with pytest.raises(SchemaValidationError):
            validator.validate(invalid)


@pytest.mark.parametrize("field", ["command_id", "site_id", "device_id"])
@pytest.mark.parametrize("value", ["bad-id", "", "1" * 32, 123])
def test_invalid_uuid_fields(
    contract: tuple[str, Draft202012Validator], field: str, value: object
) -> None:
    name, validator = contract
    with pytest.raises(SchemaValidationError):
        validator.validate({**example(name), field: value})


@pytest.mark.parametrize(
    "value",
    [
        "2026-10-03T08:00:00",  # Missing timezone.
        "2026-02-30T08:00:00Z",  # Invalid calendar day.
        "2026-13-03T08:00:00Z",
        "2026-10-03T25:00:00Z",
        "2026-10-03T08:00:00+25:00",
        "2026-10-03T08:00:00+03:60",
        "2026-10-03 08:00:00Z",  # Not the agreed RFC 3339 wire syntax.
        "2026-10-03",
        1791014400,
    ],
)
def test_invalid_timestamps(contract: tuple[str, Draft202012Validator], value: object) -> None:
    name, validator = contract
    for field in ("issued_at", "expires_at") if name == "command" else ("observed_at",):
        with pytest.raises(SchemaValidationError):
            validator.validate({**example(name), field: value})


@pytest.mark.parametrize("value", ["2026-10-03T08:00:00Z", "2026-10-03T11:00:00.125+03:00"])
def test_aware_timestamps_match_backend_conventions(
    contract: tuple[str, Draft202012Validator], value: str
) -> None:
    name, validator = contract
    for field in ("issued_at", "expires_at") if name == "command" else ("observed_at",):
        validator.validate({**example(name), field: value})
    telemetry = Telemetry.model_validate({**example("telemetry"), "observed_at": value})
    assert telemetry.observed_at.utcoffset().total_seconds() == 0


@pytest.mark.parametrize("status", ["applied", "rejected", "failed"])
@pytest.mark.parametrize(
    "error_code",
    [
        None,
        "expired",
        "invalid_payload",
        "unsupported_command",
        "out_of_range",
        "interlock",
        "hardware_failure",
        "unknown",
    ],
)
def test_acknowledgement_error_semantics(
    ack_validator: Draft202012Validator, status: str, error_code: str | None
) -> None:
    payload = {**example("ack"), "status": status, "error_code": error_code}
    valid = (status == "applied" and error_code is None) or (
        status != "applied" and error_code not in (None, "unknown")
    )
    assert ack_validator.is_valid(payload) is valid


@pytest.mark.parametrize(
    "state", [{}, {"enabled": None}, {"enabled": "true"}, {"enabled": True}, {"enabled": False}]
)
def test_acknowledgement_resulting_state(ack_validator: Draft202012Validator, state: dict) -> None:
    for status in ("applied", "rejected", "failed"):
        payload = {
            **example("ack"),
            "status": status,
            "state": state,
            "error_code": None if status == "applied" else "hardware_failure",
        }
        valid = isinstance(state.get("enabled"), bool) or (status != "applied" and state == {})
        assert ack_validator.is_valid(payload) is valid


def test_version_types_and_extra_properties(contract: tuple[str, Draft202012Validator]) -> None:
    name, validator = contract
    base = example(name)
    nested = "params" if name == "command" else "state"
    invalid = [
        {**base, "version": 2},
        {**base, "version": True},
        {**base, "unexpected": 1},
        {**base, nested: {**base[nested], "unexpected": 1}},
    ]
    if name == "command":
        invalid.extend(
            [
                {**base, "command": "toggle"},
                {**base, "params": {}},
                {**base, "params": {"enabled": 1}},
            ]
        )
    else:
        invalid.append({**base, "status": "published"})
    for payload in invalid:
        assert not validator.is_valid(payload)
