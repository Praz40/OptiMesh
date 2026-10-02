from alembic import context
from sqlalchemy import text

from app import models  # noqa: F401
from app.config import Settings
from app.database import Base, build_engine

config = context.config
settings = Settings()
secret_url = settings.migration_database_url or settings.database_url
metadata = Base.metadata


def include_name(name, type_, parent_names):
    if type_ == "schema":
        return name == "optimesh"
    return True


def run_migrations_offline():
    url = secret_url.get_secret_value() if secret_url else "postgresql+psycopg://localhost/optimesh"
    context.configure(
        url=url,
        target_metadata=metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        version_table_schema="optimesh",
        include_schemas=True,
        include_name=include_name,
    )
    context.execute("CREATE SCHEMA IF NOT EXISTS optimesh")
    context.execute("REVOKE ALL ON SCHEMA optimesh FROM PUBLIC")
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    if secret_url is None:
        raise RuntimeError("Set DATABASE_URL or MIGRATION_DATABASE_URL before running migrations")
    engine = build_engine(secret_url.get_secret_value())
    try:
        with engine.connect() as connection:
            connection.execute(text("CREATE SCHEMA IF NOT EXISTS optimesh"))
            connection.execute(text("REVOKE ALL ON SCHEMA optimesh FROM PUBLIC"))
            connection.commit()
            context.configure(
                connection=connection,
                target_metadata=metadata,
                version_table_schema="optimesh",
                include_schemas=True,
                include_name=include_name,
            )
            with context.begin_transaction():
                context.run_migrations()
    finally:
        engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
