from __future__ import annotations

from recipe_book_bot.schemas import IngredientAmount, RecipeInput
from recipe_book_bot.services import RecipeBookService

DEMO_TELEGRAM_ID = 1001


def seed_demo_data(service: RecipeBookService) -> None:
    service.ensure_user(DEMO_TELEGRAM_ID, "Редактор рецептов", "recipe_editor")
    if service.search_recipes(limit=1):
        # The seed command is intentionally idempotent for repeated local demonstrations.
        return

    recipes = [
        RecipeInput(
            title="Овощная паста",
            description="Быстрое блюдо для ужина с томатами и зеленью.",
            instructions="Отварить пасту. Обжарить томаты с чесноком. Смешать, добавить зелень.",
            category="Основные блюда",
            cooking_minutes=25,
            difficulty="простая",
            ingredients=(
                IngredientAmount(name="Паста", quantity=200, unit="г"),
                IngredientAmount(name="Томаты", quantity=250, unit="г"),
                IngredientAmount(name="Чеснок", quantity=2, unit="зуб."),
                IngredientAmount(name="Зелень", quantity=15, unit="г"),
            ),
        ),
        RecipeInput(
            title="Сырники с ягодным соусом",
            description="Завтрак с творогом, мягкой текстурой и кисло-сладким соусом.",
            instructions="Смешать творог, яйцо, муку и сахар. Сформировать сырники и обжарить.",
            category="Завтраки",
            cooking_minutes=30,
            difficulty="средняя",
            ingredients=(
                IngredientAmount(name="Творог", quantity=300, unit="г"),
                IngredientAmount(name="Яйцо", quantity=1, unit="шт."),
                IngredientAmount(name="Мука", quantity=50, unit="г"),
                IngredientAmount(name="Ягоды", quantity=120, unit="г"),
            ),
        ),
        RecipeInput(
            title="Гречневая каша с овощами",
            description="Сытный гарнир с крупой, морковью и луком.",
            instructions="Промыть крупу. Обжарить овощи. Добавить воду и тушить до готовности.",
            category="Гарниры",
            cooking_minutes=35,
            difficulty="простая",
            ingredients=(
                IngredientAmount(name="Гречка", quantity=180, unit="г"),
                IngredientAmount(name="Морковь", quantity=1, unit="шт."),
                IngredientAmount(name="Лук", quantity=1, unit="шт."),
                IngredientAmount(name="Вода", quantity=400, unit="мл"),
            ),
        ),
    ]
    for recipe in recipes:
        service.create_recipe(recipe, author_telegram_id=DEMO_TELEGRAM_ID)
