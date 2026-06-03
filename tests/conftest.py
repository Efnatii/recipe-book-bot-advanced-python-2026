from __future__ import annotations

from pathlib import Path

import pytest

from recipe_book_bot.db import build_engine, build_session_factory, init_database
from recipe_book_bot.services import RecipeBookService


@pytest.fixture()
def service(tmp_path: Path) -> RecipeBookService:
    engine = build_engine(f"sqlite:///{tmp_path / 'test.sqlite3'}")
    init_database(engine)
    return RecipeBookService(build_session_factory(engine))
