from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from recipe_book_bot.config import Settings, default_database_url, get_settings
from recipe_book_bot.db import build_engine, build_session_factory, init_database
from recipe_book_bot.models import Category, Ingredient, Recipe
from recipe_book_bot.schemas import IngredientAmount, RecipeInput, RecipeUpdate
from recipe_book_bot.seed import DEMO_TELEGRAM_ID, seed_demo_data
from recipe_book_bot.services import RecipeBookService


def recipe_input(
    *,
    title: str = "Test recipe",
    category: str = "Dinner",
    ingredients: tuple[IngredientAmount, ...] | None = None,
) -> RecipeInput:
    return RecipeInput(
        title=title,
        description="A compact recipe for unit testing.",
        instructions="Mix ingredients and cook until ready.",
        category=category,
        cooking_minutes=15,
        difficulty="easy",
        ingredients=ingredients
        or (IngredientAmount(name="Salt", quantity=1, unit="g", note="optional"),),
    )


def test_settings_and_database_helpers(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    database_url = default_database_url()
    assert database_url.endswith("data\\recipe_book.sqlite3") or database_url.endswith(
        "data/recipe_book.sqlite3"
    )

    monkeypatch.setenv("RECIPE_BOOK_DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("RECIPE_BOOK_LOG_LEVEL", "DEBUG")
    get_settings.cache_clear()
    settings = get_settings()
    assert settings.database_url == "sqlite:///:memory:"
    assert settings.log_level == "DEBUG"
    assert Settings(database_url="sqlite:///:memory:").telegram_token is None

    sqlite_path = tmp_path / "nested" / "recipe.sqlite3"
    engine = build_engine(f"sqlite:///{sqlite_path}", echo=True)
    init_database(engine)
    assert sqlite_path.exists()

    memory_engine = build_engine("sqlite:///:memory:")
    init_database(memory_engine)

    alternate_sqlite_engine = build_engine("sqlite+pysqlite:///:memory:")
    init_database(alternate_sqlite_engine)


def test_schema_normalization_and_validation() -> None:
    ingredient = IngredientAmount(name="  sea   salt ", quantity=2, unit=" g ")
    assert ingredient.name == "sea salt"
    assert ingredient.unit == "g"

    recipe = recipe_input(title="  Test   title ", category="  Main   dishes ")
    assert recipe.title == "Test title"
    assert recipe.category == "Main dishes"

    update = RecipeUpdate(title=None, description="  new   description ")
    assert update.title is None
    assert update.description == "new description"

    with pytest.raises(ValidationError):
        IngredientAmount(name="x", quantity=0)


def test_service_covers_crud_error_and_update_paths(service: RecipeBookService) -> None:
    assert service.get_user_by_telegram_id(999) is None
    user = service.ensure_user(telegram_id=100, full_name="Old Name", username="old")
    same_user = service.ensure_user(telegram_id=100, full_name="New Name", username=None)
    assert same_user.id == user.id
    assert same_user.full_name == "New Name"
    assert [item.telegram_id for item in service.list_users()] == [100]

    category = service.create_category("Dinner")
    renamed = service.rename_category(category.id, "Evening meals")
    assert renamed.name == "Evening meals"
    with pytest.raises(ValueError, match="Category 999 not found"):
        service.rename_category(999, "Missing")
    assert service.delete_category(999) is False
    assert service.delete_category(renamed.id) is True

    ingredient = service.create_ingredient("Salt", "g")
    assert service.create_ingredient("Salt", "kg").id == ingredient.id
    updated_ingredient = service.update_ingredient(ingredient.id, name="Sea salt", unit="g")
    assert updated_ingredient.name == "Sea salt"
    assert [item.name for item in service.list_ingredients()] == ["Sea salt"]
    with pytest.raises(ValueError, match="Ingredient 999 not found"):
        service.update_ingredient(999, name="Missing")
    assert service.delete_ingredient(999) is False

    created = service.create_recipe(recipe_input(), author_telegram_id=100)
    assert created.author is not None
    assert created.ingredient_names == ("Salt",)
    assert service.search_recipes("", limit=10)
    assert service.search_recipes("compact", limit=10)[0].id == created.id

    replacement = (
        IngredientAmount(name="Pepper", quantity=2, unit="g"),
        IngredientAmount(name="Water", quantity=100, unit="ml"),
    )
    updated = service.update_recipe(
        created.id,
        RecipeUpdate(category="Updated category", ingredients=replacement),
    )
    assert updated.category.name == "Updated category"
    assert sorted(updated.ingredient_names) == ["Pepper", "Water"]

    assert service.get_recipe(404) is None
    with pytest.raises(ValueError, match="Recipe 404 not found"):
        service.update_recipe(404, RecipeUpdate(title="Missing recipe"))
    assert service.delete_recipe(404) is False

    no_author = service.create_recipe(recipe_input(title="No author"), author_telegram_id=None)
    assert no_author.author is None

    favorite = service.add_favorite(100, updated.id)
    assert service.add_favorite(100, updated.id).recipe_id == favorite.recipe_id
    assert service.remove_favorite(100, 999) is False
    with pytest.raises(ValueError, match="Telegram user 404 not found"):
        service.list_favorites(404)
    assert service.remove_favorite(100, updated.id) is True

    assert service.average_rating(updated.id) is None
    rating = service.rate_recipe(100, updated.id, 4, "Good")
    assert rating.stars == 4
    assert service.rate_recipe(100, updated.id, 5, "Better").stars == 5
    assert service.average_rating(updated.id) == 5.0
    with pytest.raises(ValueError, match="Rating must be between 1 and 5"):
        service.rate_recipe(100, updated.id, 6)
    with pytest.raises(ValueError, match="Telegram user 404 not found"):
        service.add_favorite(404, updated.id)

    assert service.delete_recipe(updated.id) is True
    assert service.delete_ingredient(updated_ingredient.id) is True


def test_service_session_rollback_preserves_existing_rows(service: RecipeBookService) -> None:
    service.create_category("Stable")
    with pytest.raises(ValueError, match="Text value must not be empty"):
        service.create_category("   ")
    assert [category.name for category in service.list_categories()] == ["Stable"]


def test_seed_is_idempotent_and_deactivation_false_path(service: RecipeBookService) -> None:
    seed_demo_data(service)
    first_stats = service.recipe_statistics()
    seed_demo_data(service)
    second_stats = service.recipe_statistics()

    assert first_stats == second_stats
    assert service.deactivate_user(DEMO_TELEGRAM_ID) is True
    assert service.deactivate_user(404) is False


def test_build_session_factory_keeps_committed_instances_usable() -> None:
    engine = build_engine("sqlite:///:memory:")
    init_database(engine)
    factory = build_session_factory(engine)
    with factory() as session:
        category = Category(name="Keep alive")
        ingredient = Ingredient(name="Salt", unit="g")
        recipe = Recipe(
            title="Committed recipe",
            description="Description",
            instructions="Instructions long enough",
            cooking_minutes=10,
            difficulty="easy",
            category=category,
        )
        session.add_all([category, ingredient, recipe])
        session.commit()
        assert category.name == "Keep alive"
