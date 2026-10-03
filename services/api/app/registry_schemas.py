from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    FiniteFloat,
    field_validator,
    model_validator,
)

from app.schemas import Capability

Name = Annotated[str, Field(min_length=1, max_length=120)]


class InputModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class SiteCreate(InputModel):
    name: Name
    timezone: Annotated[str, Field(min_length=1, max_length=80)] = "UTC"
    currency: Annotated[str, Field(pattern=r"^[A-Z]{3}$")] = "EUR"

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Use a valid IANA timezone") from None
        return value


class OperatingLimits(InputModel):
    """Optional configured bounds; an omitted bound means it has not been configured."""

    min_power_w: FiniteFloat | None = Field(default=None, description="Signed minimum power in W")
    max_power_w: FiniteFloat | None = Field(default=None, description="Signed maximum power in W")
    min_soc_pct: Annotated[FiniteFloat, Field(ge=0, le=100)] | None = None
    max_soc_pct: Annotated[FiniteFloat, Field(ge=0, le=100)] | None = None

    @model_validator(mode="after")
    def ordered_limits(self) -> "OperatingLimits":
        for lower, upper in (
            (self.min_power_w, self.max_power_w),
            (self.min_soc_pct, self.max_soc_pct),
        ):
            if lower is not None and upper is not None and lower > upper:
                raise ValueError("Minimum operating limit must not exceed maximum")
        return self


class DeviceCreate(InputModel):
    name: Name
    kind: Annotated[str, Field(min_length=1, max_length=40)]
    source: Literal["hardware", "simulator"]
    capabilities: list[Capability] = Field(default_factory=list, max_length=len(Capability))
    operating_limits: OperatingLimits = Field(default_factory=OperatingLimits)

    @field_validator("capabilities")
    @classmethod
    def unique_capabilities(cls, values: list[Capability]) -> list[Capability]:
        if len(values) != len(set(values)):
            raise ValueError("Capabilities must be unique")
        return values


class UTCModel(BaseModel):
    @field_validator("created_at", "received_at", "observed_at", "start", "end", check_fields=False)
    @classmethod
    def normalize_timestamp(cls, value: datetime) -> datetime:
        try:
            return value.astimezone(UTC)
        except OverflowError:
            raise ValueError("Timestamp cannot be represented in UTC") from None


class ORMRead(UTCModel):
    model_config = ConfigDict(from_attributes=True)


class SiteRead(ORMRead):
    id: UUID
    owner_id: UUID
    name: str
    timezone: str
    currency: str
    created_at: AwareDatetime


class DeviceRead(ORMRead):
    id: UUID
    site_id: UUID
    name: str
    kind: str
    source: Literal["hardware", "simulator"]
    capabilities: list[Capability]
    operating_limits: OperatingLimits
    created_at: AwareDatetime


class MeasurementRead(ORMRead):
    id: UUID
    site_id: UUID
    device_id: UUID
    message_id: UUID
    observed_at: AwareDatetime
    received_at: AwareDatetime
    power_w: FiniteFloat | None
    energy_wh: FiniteFloat | None
    soc_pct: FiniteFloat | None


class HistoryQuery(UTCModel):
    model_config = ConfigDict(extra="forbid")
    start: AwareDatetime = Field(description="Inclusive start, with timezone; normalized to UTC")
    end: AwareDatetime = Field(description="Exclusive end; maximum interval is 30 days")
    device_id: UUID | None = None
    limit: int = Field(default=100, ge=1, le=500)
    cursor: str | None = Field(default=None, min_length=1, max_length=2048)

    @model_validator(mode="after")
    def bounded_interval(self) -> "HistoryQuery":
        if self.end <= self.start:
            raise ValueError("end must be after start")
        if self.end - self.start > timedelta(days=30):
            raise ValueError("History interval must not exceed 30 days")
        return self


class HistoryCursor(UTCModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1] = 1
    user_id: UUID
    site_id: UUID
    device_id: UUID | None
    start: AwareDatetime
    end: AwareDatetime
    observed_at: AwareDatetime
    id: UUID


class HistoryPage(BaseModel):
    items: list[MeasurementRead]
    next_cursor: str | None
