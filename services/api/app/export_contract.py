import json
from pathlib import Path

from pydantic import BaseModel

from app.schemas import CommandAck, CommandMessage, Telemetry

CONTRACTS: dict[str, type[BaseModel]] = {
    "telemetry-v1.schema.json": Telemetry,
    "command-v1.schema.json": CommandMessage,
    "ack-v1.schema.json": CommandAck,
}


def contracts_dir() -> Path:
    return Path(__file__).resolve().parents[3] / "contracts"


def main() -> None:
    target = contracts_dir()
    target.mkdir(parents=True, exist_ok=True)
    for name, model in CONTRACTS.items():
        schema = json.dumps(model.model_json_schema(), indent=2) + "\n"
        (target / name).write_text(schema, encoding="utf-8")
        print(f"Exported {name}")


if __name__ == "__main__":
    main()
