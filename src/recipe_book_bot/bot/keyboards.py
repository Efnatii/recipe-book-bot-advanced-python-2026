from __future__ import annotations

from aiogram.types import InlineKeyboardMarkup
from aiogram.utils.keyboard import InlineKeyboardBuilder

from recipe_book_bot.models import Recipe


def recipe_keyboard(recipe: Recipe) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(text="В избранное", callback_data=f"favorite:{recipe.id}")
    builder.button(text="Оценить 5", callback_data=f"rate:{recipe.id}:5")
    builder.adjust(2)
    return builder.as_markup()
