from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

from aiogram.exceptions import TelegramBadRequest
from aiogram.types import InlineKeyboardMarkup

from recipe_book_bot.bot import handlers
from recipe_book_bot.bot.keyboards import (
    MENU_FAVORITES,
    MENU_HELP,
    MENU_HOME,
    MENU_RECIPES,
    MENU_SEARCH,
    main_menu_keyboard,
    rating_keyboard,
    recipe_keyboard,
    recipe_list_keyboard,
    reply_menu_keyboard,
)
from recipe_book_bot.seed import DEMO_TELEGRAM_ID, seed_demo_data
from recipe_book_bot.services import RecipeBookService


@dataclass
class FakeUser:
    id: int = DEMO_TELEGRAM_ID
    full_name: str = "Unit Test User"
    username: str | None = "unit"


class FakeMessage:
    def __init__(self, text: str | None = None, from_user: FakeUser | None = None) -> None:
        self.text = text
        self.from_user = from_user
        self.answers: list[tuple[str, Any]] = []
        self.edits: list[tuple[str, Any]] = []
        self.edit_errors: list[Exception] = []

    async def answer(self, text: str, reply_markup: Any = None, **_kwargs: Any) -> None:
        self.answers.append((text, reply_markup))

    async def edit_text(self, text: str, reply_markup: Any = None, **_kwargs: Any) -> None:
        if self.edit_errors:
            raise self.edit_errors.pop(0)
        self.edits.append((text, reply_markup))


class FakeCallback:
    def __init__(
        self,
        data: str | None,
        *,
        from_user: FakeUser | None = None,
        message: object | None = None,
    ) -> None:
        self.data = data
        self.from_user = from_user if from_user is not None else FakeUser()
        self.message = message if message is not None else FakeMessage(from_user=self.from_user)
        self.answers: list[tuple[str | None, bool]] = []

    async def answer(self, text: str | None = None, show_alert: bool = False) -> None:
        self.answers.append((text, show_alert))


class FakeCommand:
    def __init__(self, args: str | None) -> None:
        self.args = args


def run(coro: Any) -> None:
    asyncio.run(coro)


def callback(router: Any, observer: str, name: str) -> Any:
    for item in router.observers[observer].handlers:
        if item.callback.__name__ == name:
            return item.callback
    raise AssertionError(f"Handler {name} not found")


def prepare_router(service: RecipeBookService, monkeypatch: Any) -> Any:
    monkeypatch.setattr(handlers, "Message", FakeMessage)
    seed_demo_data(service)
    return handlers.create_router(service)


def test_keyboards_render_expected_buttons(service: RecipeBookService) -> None:
    seed_demo_data(service)
    recipe = service.search_recipes(limit=1)[0]

    assert isinstance(main_menu_keyboard(), InlineKeyboardMarkup)
    assert len(reply_menu_keyboard().keyboard) == 3
    assert recipe_list_keyboard([recipe]).inline_keyboard[-1][0].callback_data == "menu:home"
    assert recipe_keyboard(recipe).inline_keyboard[0][0].callback_data == f"favorite:{recipe.id}"
    assert rating_keyboard(recipe).inline_keyboard[0][4].callback_data == f"rate:{recipe.id}:5"


def test_message_handlers(service: RecipeBookService, monkeypatch: Any) -> None:
    router = prepare_router(service, monkeypatch)
    user = FakeUser()

    start_message = FakeMessage(from_user=user)
    run(callback(router, "message", "start")(start_message))
    assert start_message.answers
    assert service.get_user_by_telegram_id(user.id) is not None

    help_message = FakeMessage(from_user=user)
    run(callback(router, "message", "help_message")(help_message))
    assert help_message.answers

    recipes_message = FakeMessage(from_user=user)
    run(callback(router, "message", "recipes")(recipes_message))
    assert recipes_message.answers

    empty_search_message = FakeMessage(from_user=user)
    run(callback(router, "message", "search")(empty_search_message, FakeCommand(None)))
    assert empty_search_message.answers

    search_message = FakeMessage(from_user=user)
    run(callback(router, "message", "search")(search_message, FakeCommand("pasta")))
    assert search_message.answers

    no_user_favorites = FakeMessage(from_user=None)
    run(callback(router, "message", "favorites")(no_user_favorites))
    assert no_user_favorites.answers

    first_recipe = service.search_recipes(limit=1)[0]
    service.add_favorite(user.id, first_recipe.id)
    favorites_message = FakeMessage(from_user=user)
    run(callback(router, "message", "favorites")(favorites_message))
    assert favorites_message.answers

    for handler_name, text in [
        ("home_button", MENU_HOME),
        ("help_button", MENU_HELP),
        ("recipes_button", MENU_RECIPES),
        ("favorites_button", MENU_FAVORITES),
        ("search_button", MENU_SEARCH),
    ]:
        message = FakeMessage(text=text, from_user=user)
        run(callback(router, "message", handler_name)(message))
        assert message.answers

    blank_message = FakeMessage(text="   ", from_user=user)
    run(callback(router, "message", "free_text_search")(blank_message))
    assert blank_message.answers == []

    free_text_message = FakeMessage(text="unknown-query", from_user=user)
    run(callback(router, "message", "free_text_search")(free_text_message))
    assert free_text_message.answers


def test_callback_handlers(service: RecipeBookService, monkeypatch: Any) -> None:
    router = prepare_router(service, monkeypatch)
    user = FakeUser()
    first_recipe = service.search_recipes(limit=1)[0]

    for handler_name, data in [
        ("menu_home", "menu:home"),
        ("menu_help", "menu:help"),
        ("menu_search", "menu:search"),
        ("menu_recipes", "menu:recipes"),
        ("menu_favorites", "menu:favorites"),
    ]:
        fake_callback = FakeCallback(data, from_user=user)
        run(callback(router, "callback_query", handler_name)(fake_callback))
        assert fake_callback.answers

    missing_data = FakeCallback(None, from_user=user)
    run(callback(router, "callback_query", "recipe_card")(missing_data))
    assert missing_data.answers[-1][1] is True

    missing_recipe = FakeCallback("recipe:999", from_user=user)
    run(callback(router, "callback_query", "recipe_card")(missing_recipe))
    assert missing_recipe.answers[-1][1] is True

    recipe_card = FakeCallback(f"recipe:{first_recipe.id}", from_user=user)
    run(callback(router, "callback_query", "recipe_card")(recipe_card))
    assert recipe_card.answers[-1][0]

    no_favorite_user = FakeCallback(f"favorite:{first_recipe.id}", from_user=None)
    no_favorite_user.from_user = None
    run(callback(router, "callback_query", "add_favorite")(no_favorite_user))
    assert no_favorite_user.answers[-1][1] is True

    favorite_callback = FakeCallback(f"favorite:{first_recipe.id}", from_user=user)
    run(callback(router, "callback_query", "add_favorite")(favorite_callback))
    assert favorite_callback.answers[-1][0]

    no_rate_menu_data = FakeCallback(None, from_user=user)
    run(callback(router, "callback_query", "rate_menu")(no_rate_menu_data))
    assert no_rate_menu_data.answers[-1][1] is True

    missing_rate_recipe = FakeCallback("rate_menu:999", from_user=user)
    run(callback(router, "callback_query", "rate_menu")(missing_rate_recipe))
    assert missing_rate_recipe.answers[-1][1] is True

    rate_menu = FakeCallback(f"rate_menu:{first_recipe.id}", from_user=user)
    run(callback(router, "callback_query", "rate_menu")(rate_menu))
    assert rate_menu.answers[-1][0]

    no_rate_user = FakeCallback(f"rate:{first_recipe.id}:5", from_user=None)
    no_rate_user.from_user = None
    run(callback(router, "callback_query", "rate")(no_rate_user))
    assert no_rate_user.answers[-1][1] is True

    rate_callback = FakeCallback(f"rate:{first_recipe.id}:5", from_user=user)
    run(callback(router, "callback_query", "rate")(rate_callback))
    assert rate_callback.answers[-1][0]
    assert service.average_rating(first_recipe.id) == 5.0


def test_list_helpers_and_edit_fallbacks(service: RecipeBookService, monkeypatch: Any) -> None:
    monkeypatch.setattr(handlers, "Message", FakeMessage)
    seed_demo_data(service)
    recipes = service.search_recipes(limit=1)

    empty_message = FakeMessage()
    run(handlers.answer_recipe_list(empty_message, [], title="Empty"))
    assert empty_message.answers

    filled_message = FakeMessage()
    run(handlers.answer_recipe_list(filled_message, recipes, title="Filled"))
    assert handlers.recipe_summary_line(recipes[0]) in filled_message.answers[0][0]

    empty_callback = FakeCallback("menu:recipes")
    run(handlers.edit_recipe_list(empty_callback, [], title="Empty"))
    assert isinstance(empty_callback.message, FakeMessage)
    assert empty_callback.message.edits

    filled_callback = FakeCallback("menu:recipes")
    run(handlers.edit_recipe_list(filled_callback, recipes, title="Filled"))
    assert filled_callback.message.edits

    success_callback = FakeCallback("menu:home")
    run(handlers.edit_or_answer(success_callback, "ok", main_menu_keyboard()))
    assert success_callback.message.edits

    not_modified = FakeCallback("menu:home")
    assert isinstance(not_modified.message, FakeMessage)
    not_modified.message.edit_errors.append(
        TelegramBadRequest(method=None, message="message is not modified")
    )
    run(handlers.edit_or_answer(not_modified, "ok", main_menu_keyboard()))
    assert not_modified.message.answers == []

    fallback = FakeCallback("menu:home")
    assert isinstance(fallback.message, FakeMessage)
    fallback.message.edit_errors.append(
        TelegramBadRequest(method=None, message="other bad request")
    )
    run(handlers.edit_or_answer(fallback, "fallback", main_menu_keyboard()))
    assert fallback.message.answers

    no_message = FakeCallback("menu:home", message=object())
    run(handlers.edit_or_answer(no_message, "no-message", main_menu_keyboard()))
    assert no_message.answers[-1][1] is True
