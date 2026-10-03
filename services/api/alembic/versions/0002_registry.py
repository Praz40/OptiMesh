"""Add configured device limits and deterministic history indexes."""

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
        sa.Column("operating_limits", postgresql.JSONB(), nullable=False, server_default="{}"),
        schema="optimesh",
    )
    op.create_check_constraint(
        op.f("ck_devices_limits_object"),
        "devices",
        "jsonb_typeof(operating_limits) = 'object'",
        schema="optimesh",
    )
    for scope in ("site", "device"):
        name = f"ix_measurements_{scope}_time"
        op.drop_index(name, table_name="measurements", schema="optimesh")
        op.create_index(
            name, "measurements", [f"{scope}_id", "observed_at", "id"], schema="optimesh"
        )


def downgrade():
    for scope in ("site", "device"):
        name = f"ix_measurements_{scope}_time"
        op.drop_index(name, table_name="measurements", schema="optimesh")
        op.create_index(name, "measurements", [f"{scope}_id", "observed_at"], schema="optimesh")
    op.drop_constraint(
        op.f("ck_devices_limits_object"), "devices", type_="check", schema="optimesh"
    )
    op.drop_column("devices", "operating_limits", schema="optimesh")
