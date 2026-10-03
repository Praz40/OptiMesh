"""Validate the single CodeRabbit config against its official current schema."""
import json
from pathlib import Path
from urllib.request import urlopen

import jsonschema
import yaml

ROOT = Path(__file__).resolve().parents[1]


def main():
    with urlopen("https://coderabbit.ai/integrations/schema.v2.json", timeout=30) as response:
        schema = json.load(response)
    config = yaml.safe_load((ROOT / ".coderabbit.yaml").read_text(encoding="utf-8"))
    jsonschema.validate(config, schema)
    print("CodeRabbit configuration matches the official schema")
    from setup_github import validate
    validate(json.loads((ROOT / ".github/project-plan.json").read_text(encoding="utf-8")))
    print("GitHub project manifest is consistent")


if __name__ == "__main__":
    main()
