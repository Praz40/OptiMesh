"""Shared device contracts.

Hardware, the simulator and the API all validate against these models, so a
device is indistinguishable from its simulated counterpart once it is on MQTT.
"""

from datetime import UTC, datetime
from enum import StrEnum
from typing import Annotated, Any, Literal
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


def _to_utc(value: datetime) -> datetime:
    return value.astimezone(UTC)


class DeviceKind(StrEnum):
    """What a device is. The kind decides its role in the site energy balance."""

    GRID_METER = "grid_meter"
    SOLAR_INVERTER = "solar_inverter"
    BATTERY = "battery"
    EV_CHARGER = "ev_charger"
    HVAC = "hvac"
    BOILER = "boiler"
    SMART_PLUG = "smart_plug"
    LOAD = "load"


class Capability(StrEnum):
    MEASURE_POWER = "measure_power"
    MEASURE_ENERGY = "measure_energy"
    SWITCH = "switch"
    POWER_SETPOINT = "power_setpoint"
    BATTERY_SOC = "battery_soc"
    CHARGING = "charging"


class DeviceSource(StrEnum):
    HARDWARE = "hardware"
    SIMULATOR = "simulator"


class DeviceLimits(BaseModel):
    """Static ratings. Commands are validated against them."""

    model_config = ConfigDict(extra="forbid")
    min_power_w: Annotated[FiniteFloat, Field(ge=0)] | None = None
    max_power_w: Annotated[FiniteFloat, Field(gt=0)] | None = None
    capacity_wh: Annotated[FiniteFloat, Field(gt=0)] | None = None


# --- Telemetry: device -> platform -------------------------------------------------


class Metrics(BaseModel):
    """Power sign convention depends on the device kind; see docs/contracts.md."""

    model_config = ConfigDict(extra="forbid")
    power_w: FiniteFloat | None = None
    energy_wh: Annotated[FiniteFloat, Field(ge=0)] | None = None
    soc_pct: Annotated[FiniteFloat, Field(ge=0, le=100)] | None = None
    voltage_v: Annotated[FiniteFloat, Field(ge=0)] | None = None
    current_a: FiniteFloat | None = None

    @model_validator(mode="after")
    def require_measurement(self) -> "Metrics":
        if all(value is None for value in (self.power_w, self.energy_wh, self.soc_pct)):
            raise ValueError("At least one of power_w, energy_wh or soc_pct is required")
        return self


class DeviceState(BaseModel):
    """Controllable state as the device actually applied it."""

    model_config = ConfigDict(extra="forbid")
    on: bool | None = None
    setpoint_w: Annotated[FiniteFloat, Field(ge=0)] | None = None


class Telemetry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1]
    site_id: UUID
    device_id: UUID
    message_id: UUID
    observed_at: AwareDatetime
    metrics: Metrics
    state: DeviceState | None = None

    @field_validator("observed_at")
    @classmethod
    def normalize_timestamp(cls, value: datetime) -> datetime:
        return _to_utc(value)


# --- Commands: platform -> device -> platform -----------------------------------------


class CommandType(StrEnum):
    SWITCH = "switch"
    POWER_SETPOINT = "power_setpoint"


class SwitchParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    on: bool


class PowerSetpointParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    power_w: Annotated[FiniteFloat, Field(ge=0)]


class SwitchCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal[CommandType.SWITCH]
    params: SwitchParams


class PowerSetpointCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal[CommandType.POWER_SETPOINT]
    params: PowerSetpointParams


CommandRequest = Annotated[SwitchCommand | PowerSetpointCommand, Field(discriminator="type")]


class CommandMessage(BaseModel):
    """Published to .../command. Devices must answer with a CommandAck."""

    model_config = ConfigDict(extra="forbid")
    version: Literal[1]
    command_id: UUID
    issued_at: AwareDatetime
    expires_at: AwareDatetime
    type: CommandType
    params: dict[str, Any]


class AckStatus(StrEnum):
    APPLIED = "applied"
    REJECTED = "rejected"


class CommandAck(BaseModel):
    """Published by the device to .../ack after it applied or refused a command."""

    model_config = ConfigDict(extra="forbid")
    version: Literal[1]
    command_id: UUID
    status: AckStatus
    reason: Annotated[str, Field(max_length=200)] | None = None
    observed_at: AwareDatetime

    @field_validator("observed_at")
    @classmethod
    def normalize_timestamp(cls, value: datetime) -> datetime:
        return _to_utc(value)


class CommandStatus(StrEnum):
    PENDING = "pending"  # stored, not yet accepted by the broker
    SENT = "sent"  # broker accepted it; says nothing about the device
    APPLIED = "applied"  # device acknowledged it applied the command
    REJECTED = "rejected"  # device refused it
    EXPIRED = "expired"  # no acknowledgement before expires_at
    FAILED = "failed"  # could not be delivered to the broker


FINAL_COMMAND_STATUSES = frozenset(
    {CommandStatus.APPLIED, CommandStatus.REJECTED, CommandStatus.EXPIRED, CommandStatus.FAILED}
)


# --- API responses ------------------------------------------------------------------


class DeviceOut(BaseModel):
    id: UUID
    site_id: UUID
    name: str
    kind: DeviceKind
    source: DeviceSource
    capabilities: list[Capability]
    limits: DeviceLimits


class CommandOut(BaseModel):
    id: UUID
    site_id: UUID
    device_id: UUID
    type: CommandType
    params: dict[str, Any]
    status: CommandStatus
    reason: str | None
    created_at: datetime
    expires_at: datetime
    acknowledged_at: datetime | None


class DeviceLive(BaseModel):
    device_id: UUID
    online: bool
    observed_at: datetime | None
    received_at: datetime | None
    metrics: Metrics | None
    state: DeviceState | None


class SiteSummary(BaseModel):
    """Instantaneous energy balance. All values in W; None when not measured."""

    solar_w: float | None
    grid_w: float | None  # + import, - export
    battery_w: float | None  # + charging, - discharging
    battery_soc_pct: float | None
    ev_w: float | None
    loads_w: float | None  # measured non-EV loads
    consumption_w: float | None  # total site consumption incl. EV
    unmeasured_w: float | None  # consumption not attributed to a measured load
    devices_online: int
    devices_total: int
    updated_at: datetime | None


class SiteOut(BaseModel):
    id: UUID
    name: str
    timezone: str
    currency: str
    summary: SiteSummary


class SiteSnapshot(BaseModel):
    site: SiteOut
    devices: list[DeviceOut]
    live: list[DeviceLive]
