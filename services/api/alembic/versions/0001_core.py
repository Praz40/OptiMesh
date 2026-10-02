"""Create the backend-only site, device and measurement schema."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "sites",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("timezone", sa.String(80), server_default="UTC", nullable=False),
        sa.Column("currency", sa.String(3), server_default="EUR", nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        schema="optimesh",
    )
    op.create_index("ix_sites_owner_id", "sites", ["owner_id"], schema="optimesh")
    op.create_table(
        "devices",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("site_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("capabilities", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["site_id"], ["optimesh.sites.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("id", "site_id", name="uq_devices_id_site"),
        sa.CheckConstraint(
            "source IN ('hardware', 'simulator')", name=op.f("ck_devices_valid_source")
        ),
        schema="optimesh",
    )
    op.create_index("ix_devices_site_id", "devices", ["site_id"], schema="optimesh")
    op.create_table(
        "measurements",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("site_id", sa.Uuid(), nullable=False),
        sa.Column("device_id", sa.Uuid(), nullable=False),
        sa.Column("message_id", sa.Uuid(), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "received_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("power_w", sa.Float()),
        sa.Column("energy_wh", sa.Float()),
        sa.Column("soc_pct", sa.Float()),
        sa.ForeignKeyConstraint(
            ["device_id", "site_id"],
            ["optimesh.devices.id", "optimesh.devices.site_id"],
            name="fk_measurements_device_site",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("device_id", "message_id", name="uq_measurements_device_message"),
        sa.CheckConstraint(
            "power_w IS NOT NULL OR energy_wh IS NOT NULL OR soc_pct IS NOT NULL",
            name=op.f("ck_measurements_has_metric"),
        ),
        sa.CheckConstraint(
            "power_w > '-Infinity'::float8 AND power_w < 'Infinity'::float8",
            name=op.f("ck_measurements_finite_power"),
        ),
        sa.CheckConstraint(
            "energy_wh >= 0 AND energy_wh < 'Infinity'::float8",
            name=op.f("ck_measurements_valid_energy"),
        ),
        sa.CheckConstraint(
            "soc_pct >= 0 AND soc_pct <= 100", name=op.f("ck_measurements_valid_soc")
        ),
        schema="optimesh",
    )
    op.create_index(
        "ix_measurements_device_time",
        "measurements",
        ["device_id", "observed_at"],
        schema="optimesh",
    )
    op.create_index(
        "ix_measurements_site_time", "measurements", ["site_id", "observed_at"], schema="optimesh"
    )


def downgrade():
    op.drop_table("measurements", schema="optimesh")
    op.drop_table("devices", schema="optimesh")
    op.drop_table("sites", schema="optimesh")
