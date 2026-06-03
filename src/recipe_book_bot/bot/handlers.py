from __future__ import annotations

import asyncio

from aiogram import F, Router
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.types import CallbackQuery, InlineKeyboardMarkup, Message

from recipe_book_bot.bot.keyboards import (
    main_menu_keyboard,
    rating_keyboard,
    recipe_keyboard,
    recipe_list_keyboard,
)
from recipe_book_bot.formatters import format_recipe_card
from recipe_book_bot.models import Recipe
from recipe_book_bot.services import RecipeBookService


def create_router(service: RecipeBookService) -> Router:
    router = Router(name="recipe_book")

    @router.message(CommandStart())
    async def start(message: Message) -> None:
        if message.from_user is not None:
            await asyncio.to_thread(
                service.ensure_user,
                message.from_user.id,
                message.from_user.full_name,
                message.from_user.username,
            )
        await message.answer(
            "<b>Книга рецептов</b>\nВыберите действие кнопками ниже.",
            reply_markup=main_menu_keyboard(),
        )

    @router.message(Command("help"))
    async def help_message(message: Message) -> None:
        await message.answer(
            "<b>Справка</b>\n"
            "Основные действия доступны через кнопки. Для поиска можно также написать "
            "<code>/search паста</code> или отправить обычный текст.",
            reply_markup=main_menu_keyboard(),
        )

    @router.message(Command("recipes"))
    async def recipes(message: Message) -> None:
        items = await asyncio.to_thread(service.search_recipes, "", limit=10)
        await answer_recipe_list(message, items)

    @router.message(Command("search"))
    async def search(message: Message, command: CommandObject) -> None:
        query = (command.args or "").strip()
        if not query:
            await message.answer(
                "<b>Поиск</b>\nНапишите название блюда или ингредиент.",
                reply_markup=main_menu_keyboard(),
            )
            return
        items = await asyncio.to_thread(service.search_recipes, query, limit=5)
        await answer_recipe_list(message, items, title=f"Поиск: {query}")

    @router.message(Command("favorites"))
    async def favorites(message: Message) -> None:
        if message.from_user is None:
            await message.answer("Не удалось определить пользователя.")
            return
        items = await asyncio.to_thread(service.list_favorites, message.from_user.id)
        await answer_recipe_list(message, items, title="Избранное")

    @router.message(F.text & ~F.text.startswith("/"))
    async def free_text_search(message: Message) -> None:
        query = message.text.strip() if message.text is not None else ""
        if not query:
            return
        items = await asyncio.to_thread(service.search_recipes, query, limit=5)
        await answer_recipe_list(message, items, title=f"Поиск: {query}")

    @router.callback_query(F.data == "menu:home")
    async def menu_home(callback: CallbackQuery) -> None:
        await edit_or_answer(
            callback,
            "<b>Книга рецептов</b>\nВыберите действие кнопками ниже.",
            main_menu_keyboard(),
        )
        await callback.answer("Меню")

    @router.callback_query(F.data == "menu:help")
    async def menu_help(callback: CallbackQuery) -> None:
        await edit_or_answer(
            callback,
            "<b>Справка</b>\n"
            "Открывайте рецепты, добавляйте их в избранное и ставьте оценки кнопками.",
            main_menu_keyboard(),
        )
        await callback.answer("Справка")

    @router.callback_query(F.data == "menu:search")
    async def menu_search(callback: CallbackQuery) -> None:
        await edit_or_answer(
            callback,
            "<b>Поиск</b>\nНапишите название блюда или ингредиент обычным сообщением.",
            main_menu_keyboard(),
        )
        await callback.answer("Поиск")

    @router.callback_query(F.data == "menu:recipes")
    async def menu_recipes(callback: CallbackQuery) -> None:
        items = await asyncio.to_thread(service.search_recipes, "", limit=10)
        await edit_recipe_list(callback, items)
        await callback.answer("Рецепты")

    @router.callback_query(F.data == "menu:favorites")
    async def menu_favorites(callback: CallbackQuery) -> None:
        items = await asyncio.to_thread(service.list_favorites, callback.from_user.id)
        await edit_recipe_list(callback, items, title="Избранное")
        await callback.answer("Избранное")

    @router.callback_query(F.data.startswith("recipe:"))
    async def recipe_card(callback: CallbackQuery) -> None:
        if callback.data is None:
            await callback.answer("Не удалось выполнить действие", show_alert=True)
            return
        recipe_id = int(callback.data.split(":")[1])
        recipe = await asyncio.to_thread(service.get_recipe, recipe_id)
        if recipe is None:
            await callback.answer("Рецепт не найден", show_alert=True)
            return
        rating = await asyncio.to_thread(service.average_rating, recipe.id)
        await edit_or_answer(
            callback,
            format_recipe_card(recipe, rating=rating),
            recipe_keyboard(recipe),
        )
        await callback.answer("Карточка")

    @router.callback_query(F.data.startswith("favorite:"))
    async def add_favorite(callback: CallbackQuery) -> None:
        if callback.from_user is None or callback.data is None:
            await callback.answer("Не удалось выполнить действие", show_alert=True)
            return
        recipe_id = int(callback.data.split(":")[1])
        await asyncio.to_thread(
            service.ensure_user,
            callback.from_user.id,
            callback.from_user.full_name,
            callback.from_user.username,
        )
        await asyncio.to_thread(service.add_favorite, callback.from_user.id, recipe_id)
        await callback.answer("Добавлено в избранное")

    @router.callback_query(F.data.startswith("rate_menu:"))
    async def rate_menu(callback: CallbackQuery) -> None:
        if callback.data is None:
            await callback.answer("Не удалось выполнить действие", show_alert=True)
            return
        recipe_id = int(callback.data.split(":")[1])
        recipe = await asyncio.to_thread(service.get_recipe, recipe_id)
        if recipe is None:
            await callback.answer("Рецепт не найден", show_alert=True)
            return
        await edit_or_answer(
            callback,
            f"<b>{recipe.title}</b>\nВыберите оценку:",
            rating_keyboard(recipe),
        )
        await callback.answer("Оценка")

    @router.callback_query(F.data.startswith("rate:"))
    async def rate(callback: CallbackQuery) -> None:
        if callback.from_user is None or callback.data is None:
            await callback.answer("Не удалось выполнить действие", show_alert=True)
            return
        _, recipe_id_text, stars_text = callback.data.split(":")
        await asyncio.to_thread(
            service.ensure_user,
            callback.from_user.id,
            callback.from_user.full_name,
            callback.from_user.username,
        )
        await asyncio.to_thread(
            service.rate_recipe,
            callback.from_user.id,
            int(recipe_id_text),
            int(stars_text),
            "Оценка через Telegram",
        )
        await callback.answer("Оценка сохранена")
        recipe = await asyncio.to_thread(service.get_recipe, int(recipe_id_text))
        if recipe is not None:
            rating = await asyncio.to_thread(service.average_rating, recipe.id)
            await edit_or_answer(
                callback,
                "<b>Оценка сохранена</b>\n\n" + format_recipe_card(recipe, rating=rating),
                recipe_keyboard(recipe),
            )

    return router


async def answer_recipe_list(
    message: Message,
    recipes: list[Recipe],
    *,
    title: str = "Рецепты",
) -> None:
    if not recipes:
        await message.answer(
            f"<b>{title}</b>\nНичего не найдено.",
            reply_markup=main_menu_keyboard(),
        )
        return
    lines = [
        f"<b>{title}</b>",
        "Выберите карточку рецепта кнопкой ниже.",
        "",
        *[recipe_summary_line(recipe) for recipe in recipes],
    ]
    await message.answer("\n".join(lines), reply_markup=recipe_list_keyboard(recipes))


async def edit_recipe_list(
    callback: CallbackQuery,
    recipes: list[Recipe],
    *,
    title: str = "Рецепты",
) -> None:
    if not recipes:
        await edit_or_answer(
            callback,
            f"<b>{title}</b>\nНичего не найдено.",
            main_menu_keyboard(),
        )
        return
    lines = [
        f"<b>{title}</b>",
        "Выберите карточку рецепта кнопкой ниже.",
        "",
        *[recipe_summary_line(recipe) for recipe in recipes],
    ]
    await edit_or_answer(callback, "\n".join(lines), recipe_list_keyboard(recipes))


def recipe_summary_line(recipe: Recipe) -> str:
    return f"<b>{recipe.title}</b> · {recipe.category.name} · {recipe.cooking_minutes} мин."


async def edit_or_answer(
    callback: CallbackQuery,
    text: str,
    reply_markup: InlineKeyboardMarkup,
) -> None:
    if isinstance(callback.message, Message):
        await callback.message.edit_text(text, reply_markup=reply_markup)
        return
    await callback.answer("Откройте меню заново", show_alert=True)
