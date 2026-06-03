from __future__ import annotations

from recipe_book_bot.models import Recipe


def format_recipe_card(recipe: Recipe, *, rating: float | None = None) -> str:
    ingredients = "\n".join(
        f"- {item.ingredient.name}: {item.quantity:g} {item.ingredient.unit}"
        + (f" ({item.note})" if item.note else "")
        for item in recipe.ingredients
    )
    rating_line = f"\nСредняя оценка: {rating:.1f}/5" if rating is not None else ""
    return (
        f"<b>{recipe.title}</b>\n"
        f"Категория: {recipe.category.name}\n"
        f"Сложность: {recipe.difficulty}\n"
        f"Время: {recipe.cooking_minutes} мин.\n"
        f"{rating_line}\n\n"
        f"{recipe.description}\n\n"
        f"<b>Ингредиенты</b>\n{ingredients}\n\n"
        f"<b>Шаги</b>\n{recipe.instructions}"
    )
