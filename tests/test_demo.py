from __future__ import annotations

from recipe_book_bot.demo import build_demo_transcript
from recipe_book_bot.services import RecipeBookService


def test_demo_transcript_is_generated(service: RecipeBookService) -> None:
    transcript = build_demo_transcript(service)
    joined = "\n".join(transcript)
    assert "Пользователь: /start" in joined
    assert "Бот:" in joined
    assert "Овощная паста" in joined
