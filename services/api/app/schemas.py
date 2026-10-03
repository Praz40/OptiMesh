from datetime import UTC, datetime
from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    FiniteFloat,
    field_validator,
    model_validator,
)


class Capability(StrEnum):
    MEASURE_POWER = "measure_power"
    MEASURE_ENERGY = "measure_energy"
    SWITCH = "switch"
    POWER_SETPOINT = "power_setpoint"
    BATTERY_SOC = "battery_soc"
    CHARGING = "charging"


class Metrics(BaseModel):
    model_config = ConfigDict(extra="forbid")
    power_w: FiniteFloat | None = None
    energy_wh: Annotated[FiniteFloat, Field(ge=0)] | None = None
    soc_pct: Annotated[FiniteFloat, Field(ge=0, le=100)] | None = None

    @model_validator(mode="after")
    def require_measurement(self) -> "Metrics":
        if all(value is None for value in (self.power_w, self.energy_wh, self.soc_pct)):
            raise ValueError("At least one metric is required")
        return self


class Telemetry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1]
    site_id: UUID
    device_id: UUID
    message_id: UUID
    observed_at: AwareDatetime
    metrics: Metrics

    @field_validator("observed_at")
    @classmethod
    def normalize_timestamp(cls, value: datetime) -> datetime:
        return value.astimezone(UTC)
