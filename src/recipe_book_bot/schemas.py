from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator


class IngredientAmount(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str = Field(min_length=2, max_length=100)
    quantity: float = Field(gt=0)
    unit: str = Field(default="г", min_length=1, max_length=30)
    note: str | None = Field(default=None, max_length=120)

    @field_validator("name", "unit")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        return " ".join(value.strip().split())


class RecipeInput(BaseModel):
    model_config = ConfigDict(frozen=True)

    title: str = Field(min_length=3, max_length=140)
    description: str = Field(min_length=5)
    instructions: str = Field(min_length=10)
    category: str = Field(min_length=2, max_length=80)
    cooking_minutes: int = Field(gt=0, le=1440)
    difficulty: str = Field(default="простая", max_length=40)
    ingredients: tuple[IngredientAmount, ...] = Field(min_length=1)

    @field_validator("title", "description", "instructions", "category", "difficulty")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        return " ".join(value.strip().split())


class RecipeUpdate(BaseModel):
    model_config = ConfigDict(frozen=True)

    title: str | None = Field(default=None, min_length=3, max_length=140)
    description: str | None = Field(default=None, min_length=5)
    instructions: str | None = Field(default=None, min_length=10)
    category: str | None = Field(default=None, min_length=2, max_length=80)
    cooking_minutes: int | None = Field(default=None, gt=0, le=1440)
    difficulty: str | None = Field(default=None, max_length=40)
    ingredients: tuple[IngredientAmount, ...] | None = None

    @field_validator("title", "description", "instructions", "category", "difficulty")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return " ".join(value.strip().split())
