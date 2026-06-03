from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console
from rich.table import Table

from recipe_book_bot.bot.app import run_polling
from recipe_book_bot.config import Settings, get_settings
from recipe_book_bot.db import build_engine, build_session_factory, init_database
from recipe_book_bot.demo import build_demo_transcript
from recipe_book_bot.formatters import format_recipe_card
from recipe_book_bot.seed import seed_demo_data
from recipe_book_bot.services import CRUD_OPERATION_NAMES, RecipeBookService

app = typer.Typer(help="Recipe book bot management CLI.")
console = Console()


def _service(database_url: str | None = None) -> RecipeBookService:
    settings = get_settings()
    engine = build_engine(database_url or settings.database_url)
    init_database(engine)
    return RecipeBookService(build_session_factory(engine))


@app.command("init-db")
def init_db(
    database_url: Annotated[str | None, typer.Option("--db-url")] = None,
) -> None:
    settings = get_settings()
    engine = build_engine(database_url or settings.database_url)
    init_database(engine)
    console.print(f"Database initialized: {database_url or settings.database_url}")


@app.command()
def seed(database_url: Annotated[str | None, typer.Option("--db-url")] = None) -> None:
    service = _service(database_url)
    seed_demo_data(service)
    stats = service.recipe_statistics()
    console.print(f"Seed complete: {stats.recipes} recipes, {stats.ingredients} ingredients")


@app.command("list-recipes")
def list_recipes(
    query: Annotated[str, typer.Option("--query", "-q")] = "",
    limit: Annotated[int, typer.Option("--limit", "-n", min=1, max=50)] = 10,
    database_url: Annotated[str | None, typer.Option("--db-url")] = None,
) -> None:
    service = _service(database_url)
    recipes = service.search_recipes(query, limit=limit)
    table = Table(title="Recipe book")
    table.add_column("ID", justify="right")
    table.add_column("Название")
    table.add_column("Категория")
    table.add_column("Время")
    table.add_column("Сложность")
    for recipe in recipes:
        table.add_row(
            str(recipe.id),
            recipe.title,
            recipe.category.name,
            f"{recipe.cooking_minutes} мин.",
            recipe.difficulty,
        )
    console.print(table)


@app.command()
def show(
    recipe_id: Annotated[int, typer.Argument(min=1)],
    database_url: Annotated[str | None, typer.Option("--db-url")] = None,
) -> None:
    service = _service(database_url)
    recipe = service.get_recipe(recipe_id)
    if recipe is None:
        raise typer.BadParameter(f"Recipe {recipe_id} not found")
    console.print(format_recipe_card(recipe, rating=service.average_rating(recipe_id)))


@app.command()
def stats(database_url: Annotated[str | None, typer.Option("--db-url")] = None) -> None:
    service = _service(database_url)
    stats_value = service.recipe_statistics()
    table = Table(title="Database statistics")
    table.add_column("Metric")
    table.add_column("Value", justify="right")
    for field_name, value in stats_value.__dict__.items():
        table.add_row(field_name, str(value))
    table.add_row("crud_operations", str(len(CRUD_OPERATION_NAMES)))
    console.print(table)


@app.command()
def demo(
    output: Annotated[Path | None, typer.Option("--output", "-o")] = None,
    database_url: Annotated[str | None, typer.Option("--db-url")] = None,
) -> None:
    service = _service(database_url)
    lines = build_demo_transcript(service)
    text = "\n\n".join(lines)
    if output is not None:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(text, encoding="utf-8")
    console.print(text)


@app.command("run-bot")
def run_bot() -> None:
    settings = Settings()
    if settings.telegram_token is None or not settings.telegram_token.get_secret_value():
        raise typer.BadParameter("Set RECIPE_BOOK_TELEGRAM_TOKEN before running Telegram polling")
    asyncio.run(run_polling(settings))
