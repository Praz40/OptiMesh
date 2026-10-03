"""Require object device limits and add deterministic history indexes.

What PR #20's 0002_registry added that 0002_live_loop does not already provide: the device
limits column itself comes from 0002_live_loop (`limits`), so only its object check and the
(observed_at, id) history indexes remain.
"""

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.create_check_constraint(
        op.f("ck_devices_limits_object"),
        "devices",
        "jsonb_typeof(limits) = 'object'",
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
