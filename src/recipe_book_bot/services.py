from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from recipe_book_bot.models import (
    Category,
    Favorite,
    Ingredient,
    Rating,
    Recipe,
    RecipeIngredient,
    User,
)
from recipe_book_bot.schemas import RecipeInput, RecipeUpdate

SessionFactory = Callable[[], Session]

CRUD_OPERATION_NAMES = (
    "ensure_user",
    "get_user_by_telegram_id",
    "list_users",
    "deactivate_user",
    "create_category",
    "list_categories",
    "rename_category",
    "delete_category",
    "create_ingredient",
    "list_ingredients",
    "update_ingredient",
    "delete_ingredient",
    "create_recipe",
    "get_recipe",
    "search_recipes",
    "update_recipe",
    "delete_recipe",
    "add_favorite",
    "remove_favorite",
    "list_favorites",
    "rate_recipe",
    "average_rating",
    "recipe_statistics",
)


@dataclass(frozen=True)
class RecipeStats:
    recipes: int
    categories: int
    ingredients: int
    favorites: int
    ratings: int


class RecipeBookService:
    """Application service layer with explicit CRUD operations for the bot and CLI."""

    def __init__(self, session_factory: SessionFactory) -> None:
        self._session_factory = session_factory

    @contextmanager
    def _session(self) -> Iterator[Session]:
        session = self._session_factory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def ensure_user(self, telegram_id: int, full_name: str, username: str | None = None) -> User:
        with self._session() as session:
            user = session.scalar(select(User).where(User.telegram_id == telegram_id))
            if user is None:
                user = User(telegram_id=telegram_id, full_name=full_name, username=username)
                session.add(user)
            else:
                user.full_name = full_name
                user.username = username
                user.is_active = True
            session.flush()
            return user

    def get_user_by_telegram_id(self, telegram_id: int) -> User | None:
        with self._session() as session:
            return session.scalar(select(User).where(User.telegram_id == telegram_id))

    def list_users(self) -> list[User]:
        with self._session() as session:
            return list(session.scalars(select(User).order_by(User.full_name)))

    def deactivate_user(self, telegram_id: int) -> bool:
        with self._session() as session:
            user = session.scalar(select(User).where(User.telegram_id == telegram_id))
            if user is None:
                return False
            user.is_active = False
            return True

    def create_category(self, name: str) -> Category:
        normalized = _normalize(name)
        with self._session() as session:
            category = self._get_or_create_category(session, normalized)
            session.flush()
            return category

    def list_categories(self) -> list[Category]:
        with self._session() as session:
            return list(session.scalars(select(Category).order_by(Category.name)))

    def rename_category(self, category_id: int, name: str) -> Category:
        with self._session() as session:
            category = session.get(Category, category_id)
            if category is None:
                raise ValueError(f"Category {category_id} not found")
            category.name = _normalize(name)
            session.flush()
            return category

    def delete_category(self, category_id: int) -> bool:
        with self._session() as session:
            category = session.get(Category, category_id)
            if category is None:
                return False
            session.delete(category)
            return True

    def create_ingredient(self, name: str, unit: str = "г") -> Ingredient:
        with self._session() as session:
            ingredient = self._get_or_create_ingredient(session, _normalize(name), _normalize(unit))
            session.flush()
            return ingredient

    def list_ingredients(self) -> list[Ingredient]:
        with self._session() as session:
            return list(session.scalars(select(Ingredient).order_by(Ingredient.name)))

    def update_ingredient(
        self, ingredient_id: int, *, name: str | None = None, unit: str | None = None
    ) -> Ingredient:
        with self._session() as session:
            ingredient = session.get(Ingredient, ingredient_id)
            if ingredient is None:
                raise ValueError(f"Ingredient {ingredient_id} not found")
            if name is not None:
                ingredient.name = _normalize(name)
            if unit is not None:
                ingredient.unit = _normalize(unit)
            session.flush()
            return ingredient

    def delete_ingredient(self, ingredient_id: int) -> bool:
        with self._session() as session:
            ingredient = session.get(Ingredient, ingredient_id)
            if ingredient is None:
                return False
            session.delete(ingredient)
            return True

    def create_recipe(self, data: RecipeInput, *, author_telegram_id: int | None = None) -> Recipe:
        with self._session() as session:
            author = None
            if author_telegram_id is not None:
                author = session.scalar(select(User).where(User.telegram_id == author_telegram_id))
            category = self._get_or_create_category(session, data.category)
            recipe = Recipe(
                title=data.title,
                description=data.description,
                instructions=data.instructions,
                cooking_minutes=data.cooking_minutes,
                difficulty=data.difficulty,
                author=author,
                category=category,
            )
            session.add(recipe)
            session.flush()
            self._replace_recipe_ingredients(session, recipe, data)
            session.flush()
            return self._require_recipe(session, recipe.id)

    def get_recipe(self, recipe_id: int) -> Recipe | None:
        with self._session() as session:
            return self._load_recipe(session, recipe_id)

    def search_recipes(self, query: str = "", *, limit: int = 10) -> list[Recipe]:
        with self._session() as session:
            statement = (
                select(Recipe)
                .options(
                    selectinload(Recipe.category),
                    selectinload(Recipe.ingredients).selectinload(RecipeIngredient.ingredient),
                )
                .order_by(Recipe.title)
                .limit(limit)
            )
            normalized = query.strip()
            if normalized:
                pattern = f"%{normalized}%"
                statement = statement.where(
                    Recipe.title.ilike(pattern) | Recipe.description.ilike(pattern)
                )
            return list(session.scalars(statement))

    def update_recipe(self, recipe_id: int, data: RecipeUpdate) -> Recipe:
        with self._session() as session:
            recipe = self._require_recipe(session, recipe_id)
            payload = data.model_dump(exclude_none=True)
            category_name = payload.pop("category", None)
            ingredients = payload.pop("ingredients", None)
            for field_name, value in payload.items():
                setattr(recipe, field_name, value)
            if category_name is not None:
                recipe.category = self._get_or_create_category(session, category_name)
            if ingredients is not None:
                replacement = RecipeInput(
                    title=recipe.title,
                    description=recipe.description,
                    instructions=recipe.instructions,
                    category=recipe.category.name,
                    cooking_minutes=recipe.cooking_minutes,
                    difficulty=recipe.difficulty,
                    ingredients=ingredients,
                )
                self._replace_recipe_ingredients(session, recipe, replacement)
            session.flush()
            return self._require_recipe(session, recipe_id)

    def delete_recipe(self, recipe_id: int) -> bool:
        with self._session() as session:
            recipe = session.get(Recipe, recipe_id)
            if recipe is None:
                return False
            session.delete(recipe)
            return True

    def add_favorite(self, telegram_id: int, recipe_id: int) -> Favorite:
        with self._session() as session:
            user = self._require_user(session, telegram_id)
            self._require_recipe(session, recipe_id)
            favorite = session.get(Favorite, {"user_id": user.id, "recipe_id": recipe_id})
            if favorite is None:
                favorite = Favorite(user_id=user.id, recipe_id=recipe_id)
                session.add(favorite)
            session.flush()
            return favorite

    def remove_favorite(self, telegram_id: int, recipe_id: int) -> bool:
        with self._session() as session:
            user = self._require_user(session, telegram_id)
            favorite = session.get(Favorite, {"user_id": user.id, "recipe_id": recipe_id})
            if favorite is None:
                return False
            session.delete(favorite)
            return True

    def list_favorites(self, telegram_id: int) -> list[Recipe]:
        with self._session() as session:
            user = self._require_user(session, telegram_id)
            statement = (
                select(Recipe)
                .join(Favorite)
                .where(Favorite.user_id == user.id)
                .options(
                    selectinload(Recipe.category),
                    selectinload(Recipe.ingredients).selectinload(RecipeIngredient.ingredient),
                )
                .order_by(Recipe.title)
            )
            return list(session.scalars(statement))

    def rate_recipe(
        self, telegram_id: int, recipe_id: int, stars: int, comment: str | None = None
    ) -> Rating:
        if stars < 1 or stars > 5:
            raise ValueError("Rating must be between 1 and 5")
        with self._session() as session:
            user = self._require_user(session, telegram_id)
            self._require_recipe(session, recipe_id)
            rating = session.get(Rating, {"user_id": user.id, "recipe_id": recipe_id})
            if rating is None:
                rating = Rating(user_id=user.id, recipe_id=recipe_id, stars=stars, comment=comment)
                session.add(rating)
            else:
                rating.stars = stars
                rating.comment = comment
            session.flush()
            return rating

    def average_rating(self, recipe_id: int) -> float | None:
        with self._session() as session:
            value = session.scalar(
                select(func.avg(Rating.stars)).where(Rating.recipe_id == recipe_id)
            )
            return float(value) if value is not None else None

    def recipe_statistics(self) -> RecipeStats:
        with self._session() as session:
            return RecipeStats(
                recipes=session.scalar(select(func.count(Recipe.id))) or 0,
                categories=session.scalar(select(func.count(Category.id))) or 0,
                ingredients=session.scalar(select(func.count(Ingredient.id))) or 0,
                favorites=session.scalar(select(func.count()).select_from(Favorite)) or 0,
                ratings=session.scalar(select(func.count()).select_from(Rating)) or 0,
            )

    def _load_recipe(self, session: Session, recipe_id: int) -> Recipe | None:
        recipe = session.scalar(
            select(Recipe)
            .where(Recipe.id == recipe_id)
            .options(
                selectinload(Recipe.category),
                selectinload(Recipe.ingredients).selectinload(RecipeIngredient.ingredient),
                selectinload(Recipe.ratings),
            )
        )
        return recipe

    def _require_recipe(self, session: Session, recipe_id: int) -> Recipe:
        recipe = self._load_recipe(session, recipe_id)
        if recipe is None:
            raise ValueError(f"Recipe {recipe_id} not found")
        return recipe

    def _require_user(self, session: Session, telegram_id: int) -> User:
        user = session.scalar(select(User).where(User.telegram_id == telegram_id))
        if user is None:
            raise ValueError(f"Telegram user {telegram_id} not found")
        return user

    def _get_or_create_category(self, session: Session, name: str) -> Category:
        normalized = _normalize(name)
        category = session.scalar(select(Category).where(Category.name == normalized))
        if category is None:
            category = Category(name=normalized)
            session.add(category)
            session.flush()
        return category

    def _get_or_create_ingredient(self, session: Session, name: str, unit: str) -> Ingredient:
        normalized = _normalize(name)
        ingredient = session.scalar(select(Ingredient).where(Ingredient.name == normalized))
        if ingredient is None:
            ingredient = Ingredient(name=normalized, unit=unit)
            session.add(ingredient)
            session.flush()
        return ingredient

    def _replace_recipe_ingredients(
        self, session: Session, recipe: Recipe, data: RecipeInput
    ) -> None:
        recipe.ingredients.clear()
        for item in data.ingredients:
            ingredient = self._get_or_create_ingredient(session, item.name, item.unit)
            recipe.ingredients.append(
                RecipeIngredient(ingredient=ingredient, quantity=item.quantity, note=item.note)
            )


def _normalize(value: str) -> str:
    normalized = " ".join(value.strip().split())
    if not normalized:
        raise ValueError("Text value must not be empty")
    return normalized
