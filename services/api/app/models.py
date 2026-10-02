from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Site(Base):
    __tablename__ = "sites"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    owner_id: Mapped[UUID] = mapped_column(Uuid, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    timezone: Mapped[str] = mapped_column(String(80), nullable=False, server_default="UTC")
    currency: Mapped[str] = mapped_column(String(3), nullable=False, server_default="EUR")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Device(Base):
    __tablename__ = "devices"
    __table_args__ = (
        UniqueConstraint("id", "site_id", name="uq_devices_id_site"),
        CheckConstraint("source IN ('hardware', 'simulator')", name="valid_source"),
    )
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    site_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("optimesh.sites.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    capabilities: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Measurement(Base):
    __tablename__ = "measurements"
    __table_args__ = (
        ForeignKeyConstraint(
            ["device_id", "site_id"],
            ["optimesh.devices.id", "optimesh.devices.site_id"],
            name="fk_measurements_device_site",
            ondelete="CASCADE",
        ),
        UniqueConstraint("device_id", "message_id", name="uq_measurements_device_message"),
        CheckConstraint(
            "power_w IS NOT NULL OR energy_wh IS NOT NULL OR soc_pct IS NOT NULL",
            name="has_metric",
        ),
        CheckConstraint(
            "power_w > '-Infinity'::float8 AND power_w < 'Infinity'::float8",
            name="finite_power",
        ),
        CheckConstraint("energy_wh >= 0 AND energy_wh < 'Infinity'::float8", name="valid_energy"),
        CheckConstraint("soc_pct >= 0 AND soc_pct <= 100", name="valid_soc"),
        Index("ix_measurements_device_time", "device_id", "observed_at"),
        Index("ix_measurements_site_time", "site_id", "observed_at"),
    )
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    site_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    device_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    message_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    power_w: Mapped[float | None] = mapped_column(Float)
    energy_wh: Mapped[float | None] = mapped_column(Float)
    soc_pct: Mapped[float | None] = mapped_column(Float)
