from __future__ import annotations

from aiogram.types import InlineKeyboardMarkup, KeyboardButton, ReplyKeyboardMarkup
from aiogram.utils.keyboard import InlineKeyboardBuilder

from recipe_book_bot.models import Recipe

MENU_RECIPES = "Рецепты"
MENU_FAVORITES = "Избранное"
MENU_SEARCH = "Поиск"
MENU_HELP = "Справка"
MENU_HOME = "Меню"


def main_menu_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(text=MENU_RECIPES, callback_data="menu:recipes")
    builder.button(text=MENU_FAVORITES, callback_data="menu:favorites")
    builder.button(text=MENU_SEARCH, callback_data="menu:search")
    builder.button(text=MENU_HELP, callback_data="menu:help")
    builder.adjust(1, 2, 1)
    return builder.as_markup()


def reply_menu_keyboard() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text=MENU_RECIPES), KeyboardButton(text=MENU_FAVORITES)],
            [KeyboardButton(text=MENU_SEARCH), KeyboardButton(text=MENU_HELP)],
            [KeyboardButton(text=MENU_HOME)],
        ],
        resize_keyboard=True,
        is_persistent=True,
        one_time_keyboard=False,
        input_field_placeholder="Выберите действие или напишите запрос",
    )


def recipe_list_keyboard(recipes: list[Recipe]) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    for recipe in recipes:
        builder.button(
            text=f"{recipe.title} · {recipe.cooking_minutes} мин",
            callback_data=f"recipe:{recipe.id}",
        )
    builder.button(text=MENU_HOME, callback_data="menu:home")
    builder.adjust(1)
    return builder.as_markup()


def recipe_keyboard(recipe: Recipe) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(text="В избранное", callback_data=f"favorite:{recipe.id}")
    builder.button(text="Оценить", callback_data=f"rate_menu:{recipe.id}")
    builder.button(text=MENU_RECIPES, callback_data="menu:recipes")
    builder.button(text=MENU_HOME, callback_data="menu:home")
    builder.adjust(2)
    return builder.as_markup()


def rating_keyboard(recipe: Recipe) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    for stars in range(1, 6):
        builder.button(text=str(stars), callback_data=f"rate:{recipe.id}:{stars}")
    builder.button(text="Назад к рецепту", callback_data=f"recipe:{recipe.id}")
    builder.adjust(5, 1)
    return builder.as_markup()
