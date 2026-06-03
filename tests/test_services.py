from __future__ import annotations

from sqlalchemy import inspect

from recipe_book_bot.db import build_engine, init_database
from recipe_book_bot.schemas import IngredientAmount, RecipeInput, RecipeUpdate
from recipe_book_bot.seed import DEMO_TELEGRAM_ID, seed_demo_data
from recipe_book_bot.services import CRUD_OPERATION_NAMES, RecipeBookService


def test_database_schema_contains_required_tables(tmp_path) -> None:
    engine = build_engine(f"sqlite:///{tmp_path / 'schema.sqlite3'}")
    init_database(engine)
    tables = set(inspect(engine).get_table_names())
    assert {
        "users",
        "categories",
        "ingredients",
        "recipes",
        "recipe_ingredients",
        "favorites",
        "ratings",
    } <= tables


def test_seed_and_search(service: RecipeBookService) -> None:
    seed_demo_data(service)
    stats = service.recipe_statistics()
    assert stats.recipes == 3
    assert stats.categories >= 3
    assert stats.ingredients >= 10
    results = service.search_recipes("паста")
    assert [recipe.title for recipe in results] == ["Овощная паста"]


def test_recipe_crud_favorites_and_ratings(service: RecipeBookService) -> None:
    user = service.ensure_user(telegram_id=42, full_name="Test User", username="tester")
    service.create_category("Супы")
    ingredient = service.create_ingredient("Картофель", "г")
    service.update_ingredient(ingredient.id, unit="шт.")

    created = service.create_recipe(
        RecipeInput(
            title="Тестовый суп",
            description="Рецепт для проверки CRUD-слоя.",
            instructions="Нарезать овощи, добавить воду, варить до готовности.",
            category="Супы",
            cooking_minutes=40,
            difficulty="простая",
            ingredients=(
                IngredientAmount(name="Картофель", quantity=3, unit="шт."),
                IngredientAmount(name="Морковь", quantity=1, unit="шт."),
            ),
        ),
        author_telegram_id=user.telegram_id,
    )

    found = service.get_recipe(created.id)
    assert found is not None
    assert found.title == "Тестовый суп"
    assert len(found.ingredients) == 2

    updated = service.update_recipe(
        created.id,
        RecipeUpdate(title="Овощной суп", cooking_minutes=35, difficulty="средняя"),
    )
    assert updated.title == "Овощной суп"
    assert updated.cooking_minutes == 35

    service.add_favorite(user.telegram_id, updated.id)
    assert [recipe.id for recipe in service.list_favorites(user.telegram_id)] == [updated.id]
    assert service.remove_favorite(user.telegram_id, updated.id) is True
    assert service.list_favorites(user.telegram_id) == []

    service.rate_recipe(user.telegram_id, updated.id, 5, "Хороший пример")
    assert service.average_rating(updated.id) == 5.0

    assert service.delete_recipe(updated.id) is True
    assert service.get_recipe(updated.id) is None


def test_crud_contract_has_at_least_fifteen_operations() -> None:
    assert len(CRUD_OPERATION_NAMES) >= 15
    assert "create_recipe" in CRUD_OPERATION_NAMES
    assert "rate_recipe" in CRUD_OPERATION_NAMES


def test_demo_user_can_be_deactivated(service: RecipeBookService) -> None:
    seed_demo_data(service)
    assert service.deactivate_user(DEMO_TELEGRAM_ID) is True
    user = service.get_user_by_telegram_id(DEMO_TELEGRAM_ID)
    assert user is not None
    assert user.is_active is False
