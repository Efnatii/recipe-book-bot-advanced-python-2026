from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


def default_database_url() -> str:
    data_dir = Path.cwd() / "data"
    return f"sqlite:///{data_dir / 'recipe_book.sqlite3'}"


class Settings(BaseSettings):
    """Runtime settings loaded from environment variables or `.env`."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="RECIPE_BOOK_",
        extra="ignore",
    )

    database_url: str = Field(default_factory=default_database_url)
    telegram_token: SecretStr | None = None
    log_level: str = "INFO"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
