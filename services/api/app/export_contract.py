import json
from pathlib import Path

from app.schemas import Telemetry


def main() -> None:
    target = Path(__file__).resolve().parents[3] / "contracts" / "telemetry-v1.schema.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(Telemetry.model_json_schema(), indent=2) + "\n", encoding="utf-8")
    print(f"Exported {target.name}")


if __name__ == "__main__":
    main()
