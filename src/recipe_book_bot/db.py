from __future__ import annotations

from pathlib import Path
from typing import Any, cast

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from recipe_book_bot.models import Base


@event.listens_for(Engine, "connect")
def _enable_sqlite_foreign_keys(dbapi_connection: object, _connection_record: object) -> None:
    cursor = cast(Any, dbapi_connection).cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


def build_engine(database_url: str, *, echo: bool = False) -> Engine:
    if database_url.startswith("sqlite:///"):
        database_path = Path(database_url.removeprefix("sqlite:///"))
        if database_path != Path(":memory:"):
            database_path.parent.mkdir(parents=True, exist_ok=True)
        return create_engine(database_url, echo=echo, connect_args={"check_same_thread": False})
    return create_engine(database_url, echo=echo)


def build_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def init_database(engine: Engine) -> None:
    Base.metadata.create_all(engine)
