from __future__ import annotations

from recipe_book_bot.formatters import format_recipe_card
from recipe_book_bot.seed import DEMO_TELEGRAM_ID, seed_demo_data
from recipe_book_bot.services import RecipeBookService


def build_demo_transcript(service: RecipeBookService) -> list[str]:
    seed_demo_data(service)
    recipes = service.search_recipes(limit=3)
    first = recipes[0]
    service.add_favorite(DEMO_TELEGRAM_ID, first.id)
    service.rate_recipe(DEMO_TELEGRAM_ID, first.id, 5, "Подходит для демонстрации проекта")
    rating = service.average_rating(first.id)
    favorites = service.list_favorites(DEMO_TELEGRAM_ID)
    return [
        "Пользователь: /start",
        "Бот: Открыл книгу рецептов и показал доступные команды.",
        "Пользователь: /recipes",
        "Бот: " + ", ".join(recipe.title for recipe in recipes),
        f"Пользователь: /search {first.title.split()[0]}",
        "Бот: найден рецепт",
        format_recipe_card(first, rating=rating).replace("<b>", "").replace("</b>", ""),
        "Пользователь: добавил рецепт в избранное",
        "Бот: " + ", ".join(recipe.title for recipe in favorites),
    ]
