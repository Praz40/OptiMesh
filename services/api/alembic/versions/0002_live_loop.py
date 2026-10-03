"""Add device limits, extra measurement fields and device commands."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "devices",
        sa.Column("limits", postgresql.JSONB(), server_default="{}", nullable=False),
        schema="optimesh",
    )
    op.add_column("measurements", sa.Column("voltage_v", sa.Float()), schema="optimesh")
    op.add_column("measurements", sa.Column("current_a", sa.Float()), schema="optimesh")
    op.add_column("measurements", sa.Column("state", postgresql.JSONB()), schema="optimesh")
    op.create_check_constraint(
        op.f("ck_measurements_valid_voltage"),
        "measurements",
        "voltage_v >= 0 AND voltage_v < 'Infinity'::float8",
        schema="optimesh",
    )
    op.create_check_constraint(
        op.f("ck_measurements_finite_current"),
        "measurements",
        "current_a > '-Infinity'::float8 AND current_a < 'Infinity'::float8",
        schema="optimesh",
    )
    op.create_table(
        "commands",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("site_id", sa.Uuid(), nullable=False),
        sa.Column("device_id", sa.Uuid(), nullable=False),
        sa.Column("type", sa.String(40), nullable=False),
        sa.Column("params", postgresql.JSONB(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("reason", sa.String(200)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(
            ["device_id", "site_id"],
            ["optimesh.devices.id", "optimesh.devices.site_id"],
            name="fk_commands_device_site",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'sent', 'applied', 'rejected', 'expired', 'failed')",
            name=op.f("ck_commands_valid_status"),
        ),
        schema="optimesh",
    )
    op.create_index(
        "ix_commands_site_time", "commands", ["site_id", "created_at"], schema="optimesh"
    )


def downgrade():
    op.drop_table("commands", schema="optimesh")
    op.drop_constraint(
        op.f("ck_measurements_finite_current"), "measurements", type_="check", schema="optimesh"
    )
    op.drop_constraint(
        op.f("ck_measurements_valid_voltage"), "measurements", type_="check", schema="optimesh"
    )
    op.drop_column("measurements", "state", schema="optimesh")
    op.drop_column("measurements", "current_a", schema="optimesh")
    op.drop_column("measurements", "voltage_v", schema="optimesh")
    op.drop_column("devices", "limits", schema="optimesh")
