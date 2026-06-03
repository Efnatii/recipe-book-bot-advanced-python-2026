from __future__ import annotations

import runpy
from pathlib import Path
from types import SimpleNamespace

import pytest
import typer
from pydantic import SecretStr
from typer.testing import CliRunner

import recipe_book_bot.cli as cli
from recipe_book_bot.bot import app as bot_app
from recipe_book_bot.config import Settings
from recipe_book_bot.services import RecipeBookService


def test_cli_commands_work_with_explicit_database(tmp_path: Path) -> None:
    runner = CliRunner()
    db_url = f"sqlite:///{tmp_path / 'cli.sqlite3'}"
    transcript = tmp_path / "transcript.txt"

    assert runner.invoke(cli.app, ["init-db", "--db-url", db_url]).exit_code == 0
    seed_result = runner.invoke(cli.app, ["seed", "--db-url", db_url])
    assert seed_result.exit_code == 0
    assert "recipes" in seed_result.output
    assert "ingredients" in seed_result.output

    list_result = runner.invoke(cli.app, ["list-recipes", "--db-url", db_url, "--limit", "2"])
    assert list_result.exit_code == 0
    assert "Recipe book" in list_result.output

    show_result = runner.invoke(cli.app, ["show", "1", "--db-url", db_url])
    assert show_result.exit_code == 0
    assert show_result.output.strip()

    missing_result = runner.invoke(cli.app, ["show", "999", "--db-url", db_url])
    assert missing_result.exit_code != 0
    assert "Recipe 999 not found" in missing_result.output

    stats_result = runner.invoke(cli.app, ["stats", "--db-url", db_url])
    assert stats_result.exit_code == 0
    assert "crud_operations" in stats_result.output

    demo_result = runner.invoke(cli.app, ["demo", "--db-url", db_url, "--output", str(transcript)])
    assert demo_result.exit_code == 0
    assert transcript.exists()
    assert "/start" in transcript.read_text(encoding="utf-8")

    demo_stdout_result = runner.invoke(cli.app, ["demo", "--db-url", db_url])
    assert demo_stdout_result.exit_code == 0
    assert demo_stdout_result.output.strip()


def test_run_bot_requires_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli, "Settings", lambda: Settings(database_url="sqlite:///:memory:"))
    with pytest.raises(typer.BadParameter, match="RECIPE_BOOK_TELEGRAM_TOKEN"):
        cli.run_bot()


def test_run_bot_invokes_polling(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[Settings] = []
    original_asyncio_run = cli.asyncio.run

    async def fake_run_polling(settings: Settings) -> None:
        calls.append(settings)

    def fake_asyncio_run(coro: object) -> None:
        original_asyncio_run(coro)

    settings = Settings(database_url="sqlite:///:memory:", telegram_token=SecretStr("123:token"))
    monkeypatch.setattr(cli, "Settings", lambda: settings)
    monkeypatch.setattr(cli, "run_polling", fake_run_polling)
    monkeypatch.setattr(cli.asyncio, "run", fake_asyncio_run)

    cli.run_bot()

    assert calls == [settings]


def test_package_main_calls_cli_app(monkeypatch: pytest.MonkeyPatch) -> None:
    called: list[bool] = []
    monkeypatch.setattr(cli, "app", lambda: called.append(True))

    runpy.run_module("recipe_book_bot.__main__", run_name="__main__")

    assert called == [True]


def test_create_dispatcher_registers_recipe_router(service: RecipeBookService) -> None:
    dispatcher = bot_app.create_dispatcher(service)

    assert "recipe_book" in {router.name for router in dispatcher.sub_routers}


def test_run_polling_builds_service_and_starts_dispatcher(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    class FakeDispatcher:
        async def start_polling(self, bot: object) -> None:
            calls.append(f"poll:{type(bot).__name__}")

    class FakeBot:
        def __init__(self, *, token: str, default: object) -> None:
            calls.append(f"bot:{token}:{type(default).__name__}")

    monkeypatch.setattr(bot_app, "build_engine", lambda database_url: f"engine:{database_url}")
    monkeypatch.setattr(bot_app, "init_database", lambda engine: calls.append(f"init:{engine}"))
    monkeypatch.setattr(bot_app, "build_session_factory", lambda engine: f"factory:{engine}")
    monkeypatch.setattr(
        bot_app,
        "RecipeBookService",
        lambda factory: SimpleNamespace(factory=factory),
    )
    monkeypatch.setattr(bot_app, "seed_demo_data", lambda service: calls.append(service.factory))
    monkeypatch.setattr(bot_app, "Bot", FakeBot)
    monkeypatch.setattr(bot_app, "create_dispatcher", lambda service: FakeDispatcher())

    import asyncio

    asyncio.run(
        bot_app.run_polling(
            Settings(database_url="sqlite:///:memory:", telegram_token=SecretStr("123:token"))
        )
    )

    assert calls == [
        "init:engine:sqlite:///:memory:",
        "factory:engine:sqlite:///:memory:",
        "bot:123:token:DefaultBotProperties",
        "poll:FakeBot",
    ]


def test_run_polling_rejects_missing_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(bot_app, "build_engine", lambda database_url: "engine")
    monkeypatch.setattr(bot_app, "init_database", lambda engine: None)
    monkeypatch.setattr(bot_app, "build_session_factory", lambda engine: "factory")
    monkeypatch.setattr(bot_app, "RecipeBookService", lambda factory: SimpleNamespace())
    monkeypatch.setattr(bot_app, "seed_demo_data", lambda service: None)

    import asyncio

    with pytest.raises(RuntimeError, match="RECIPE_BOOK_TELEGRAM_TOKEN"):
        asyncio.run(bot_app.run_polling(Settings(database_url="sqlite:///:memory:")))
