from __future__ import annotations

import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode

from recipe_book_bot.bot.handlers import create_router
from recipe_book_bot.config import Settings
from recipe_book_bot.db import build_engine, build_session_factory, init_database
from recipe_book_bot.seed import seed_demo_data
from recipe_book_bot.services import RecipeBookService


def create_dispatcher(service: RecipeBookService) -> Dispatcher:
    dispatcher = Dispatcher()
    dispatcher.include_router(create_router(service))
    return dispatcher


async def run_polling(settings: Settings) -> None:
    logging.basicConfig(level=settings.log_level)
    engine = build_engine(settings.database_url)
    init_database(engine)
    service = RecipeBookService(build_session_factory(engine))
    seed_demo_data(service)
    token = settings.telegram_token
    if token is None:
        raise RuntimeError("RECIPE_BOOK_TELEGRAM_TOKEN is required")
    bot = Bot(
        token=token.get_secret_value(),
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )
    dispatcher = create_dispatcher(service)
    await dispatcher.start_polling(bot)
