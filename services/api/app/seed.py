"""Idempotently create the demo sites and devices.

IDs are fixed so firmware and the simulator can be configured once.
Run from services/api: uv run --frozen python -m app.seed
"""

from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.config import Settings
from app.database import build_engine
from app.models import Device, Site
from app.schemas import Capability as C
from app.schemas import DeviceKind as K
from app.schemas import DeviceSource

DEMO_OWNER_ID = UUID("00000000-0000-4000-8000-000000000001")

HOME_ID = UUID("5e000000-0000-4000-8000-000000000001")
WORKSHOP_ID = UUID("5e000000-0000-4000-8000-000000000002")
OFFICE_ID = UUID("5e000000-0000-4000-8000-000000000003")

# The physical ESP32 load the hardware team flashes. See docs/contracts.md.
ESP32_LOAD_ID = UUID("de000000-0000-4000-8000-000000002003")

SITES = [
    (HOME_ID, "Home", "Europe/Sofia"),
    (WORKSHOP_ID, "Workshop", "Europe/Sofia"),
    (OFFICE_ID, "Office", "Europe/Sofia"),
]

SIM = DeviceSource.SIMULATOR
HW = DeviceSource.HARDWARE


def _device(
    device_id: str,
    site_id: UUID,
    name: str,
    kind: K,
    capabilities: list[C],
    source: DeviceSource = SIM,
    **limits: float,
) -> dict[str, Any]:
    return {
        "id": UUID(device_id),
        "site_id": site_id,
        "name": name,
        "kind": kind.value,
        "source": source.value,
        "capabilities": [c.value for c in capabilities],
        "limits": limits,
    }


METER = [C.MEASURE_POWER, C.MEASURE_ENERGY]
# Battery control semantics are not agreed yet, so batteries are measure-only for now.
STORAGE = [C.MEASURE_POWER, C.BATTERY_SOC]
CHARGER = [C.MEASURE_POWER, C.CHARGING, C.SWITCH, C.POWER_SETPOINT]
SWITCHED = [C.MEASURE_POWER, C.SWITCH]

DEVICES = [
    # Home
    _device("de000000-0000-4000-8000-000000001001", HOME_ID, "Grid meter", K.GRID_METER, METER),
    _device(
        "de000000-0000-4000-8000-000000001002",
        HOME_ID,
        "Rooftop solar",
        K.SOLAR_INVERTER,
        METER,
        max_power_w=6000,
    ),
    _device(
        "de000000-0000-4000-8000-000000001003",
        HOME_ID,
        "Home battery",
        K.BATTERY,
        STORAGE,
        max_power_w=5000,
        capacity_wh=10000,
    ),
    _device(
        "de000000-0000-4000-8000-000000001004",
        HOME_ID,
        "EV charger",
        K.EV_CHARGER,
        CHARGER,
        min_power_w=1400,
        max_power_w=11000,
    ),
    _device(
        "de000000-0000-4000-8000-000000001005",
        HOME_ID,
        "Water boiler",
        K.BOILER,
        SWITCHED,
        max_power_w=2000,
    ),
    _device(
        "de000000-0000-4000-8000-000000001006",
        HOME_ID,
        "Washing machine plug",
        K.SMART_PLUG,
        SWITCHED,
        max_power_w=2300,
    ),
    # Workshop: the physical demo lives here
    _device("de000000-0000-4000-8000-000000002001", WORKSHOP_ID, "Grid meter", K.GRID_METER, METER),
    _device(
        "de000000-0000-4000-8000-000000002002",
        WORKSHOP_ID,
        "Roof solar",
        K.SOLAR_INVERTER,
        METER,
        max_power_w=10000,
    ),
    _device(
        str(ESP32_LOAD_ID),
        WORKSHOP_ID,
        "ESP32 demo load",
        K.LOAD,
        [C.MEASURE_POWER, C.MEASURE_ENERGY, C.SWITCH],
        source=HW,
    ),
    _device(
        "de000000-0000-4000-8000-000000002004",
        WORKSHOP_ID,
        "Compressor",
        K.LOAD,
        SWITCHED,
        max_power_w=3000,
    ),
    # Office
    _device("de000000-0000-4000-8000-000000003001", OFFICE_ID, "Grid meter", K.GRID_METER, METER),
    _device(
        "de000000-0000-4000-8000-000000003002",
        OFFICE_ID,
        "Carport solar",
        K.SOLAR_INVERTER,
        METER,
        max_power_w=30000,
    ),
    _device(
        "de000000-0000-4000-8000-000000003003",
        OFFICE_ID,
        "Office battery",
        K.BATTERY,
        STORAGE,
        max_power_w=25000,
        capacity_wh=50000,
    ),
    _device(
        "de000000-0000-4000-8000-000000003004",
        OFFICE_ID,
        "HVAC",
        K.HVAC,
        [C.MEASURE_POWER, C.SWITCH, C.POWER_SETPOINT],
        min_power_w=2000,
        max_power_w=15000,
    ),
    *[
        _device(
            f"de000000-0000-4000-8000-00000000301{n}",
            OFFICE_ID,
            f"EV charger {n}",
            K.EV_CHARGER,
            CHARGER,
            min_power_w=1400,
            max_power_w=11000,
        )
        for n in (1, 2, 3)
    ],
]


def seed(session: Session) -> None:
    for site_id, name, timezone in SITES:
        session.merge(Site(id=site_id, owner_id=DEMO_OWNER_ID, name=name, timezone=timezone))
    session.flush()
    for device in DEVICES:
        session.merge(Device(**device))


def main() -> None:
    settings = Settings()
    if settings.database_url is None:
        raise SystemExit("Set DATABASE_URL first")
    engine = build_engine(settings.database_url.get_secret_value())
    try:
        with Session(engine) as session, session.begin():
            seed(session)
    finally:
        engine.dispose()
    print(f"Seeded {len(SITES)} sites and {len(DEVICES)} devices")


if __name__ == "__main__":
    main()
