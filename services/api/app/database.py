from sqlalchemy import Engine, MetaData, create_engine
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    metadata = MetaData(
        schema="optimesh",
        naming_convention={
            "ix": "ix_%(table_name)s_%(column_0_name)s",
            "uq": "uq_%(table_name)s_%(column_0_name)s",
            "ck": "ck_%(table_name)s_%(constraint_name)s",
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
            "pk": "pk_%(table_name)s",
        },
    )


def build_engine(url: str) -> Engine:
    return create_engine(
        url,
        pool_pre_ping=True,
        pool_size=3,
        max_overflow=2,
        connect_args={"connect_timeout": 3},
    )
