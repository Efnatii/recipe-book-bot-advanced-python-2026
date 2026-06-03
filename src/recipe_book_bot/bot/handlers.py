from __future__ import annotations

import asyncio

from aiogram import F, Router
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.types import CallbackQuery, Message

from recipe_book_bot.bot.keyboards import recipe_keyboard
from recipe_book_bot.formatters import format_recipe_card
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
            "Книга рецептов открыта.\n"
            "Команды: /recipes, /search <текст>, /favorites, /help"
        )

    @router.message(Command("help"))
    async def help_message(message: Message) -> None:
        await message.answer(
            "/recipes - показать рецепты\n"
            "/search паста - найти рецепт\n"
            "/favorites - избранное\n"
            "В карточке рецепта можно добавить его в избранное и поставить оценку."
        )

    @router.message(Command("recipes"))
    async def recipes(message: Message) -> None:
        items = await asyncio.to_thread(service.search_recipes, "", limit=5)
        if not items:
            await message.answer("В книге пока нет рецептов.")
            return
        for recipe in items:
            rating = await asyncio.to_thread(service.average_rating, recipe.id)
            await message.answer(
                format_recipe_card(recipe, rating=rating), reply_markup=recipe_keyboard(recipe)
            )

    @router.message(Command("search"))
    async def search(message: Message, command: CommandObject) -> None:
        query = (command.args or "").strip()
        if not query:
            await message.answer("Укажите текст поиска: /search паста")
            return
        items = await asyncio.to_thread(service.search_recipes, query, limit=5)
        if not items:
            await message.answer("Ничего не найдено.")
            return
        for recipe in items:
            rating = await asyncio.to_thread(service.average_rating, recipe.id)
            await message.answer(
                format_recipe_card(recipe, rating=rating), reply_markup=recipe_keyboard(recipe)
            )

    @router.message(Command("favorites"))
    async def favorites(message: Message) -> None:
        if message.from_user is None:
            await message.answer("Не удалось определить пользователя.")
            return
        items = await asyncio.to_thread(service.list_favorites, message.from_user.id)
        if not items:
            await message.answer("В избранном пока пусто.")
            return
        await message.answer("Избранное:\n" + "\n".join(f"- {recipe.title}" for recipe in items))

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

    return router
