import { HttpError } from "./http";
import type { IngredientInput, RatingInput, RecipeInput, UserInput } from "./repository";

export function parseRecipeInput(value: unknown): RecipeInput {
  const record = requireRecord(value);
  const ingredientsValue = record.ingredients;
  if (!Array.isArray(ingredientsValue) || ingredientsValue.length === 0) {
    throw new HttpError(400, "Recipe must contain at least one ingredient");
  }
  return {
    title: readString(record, "title", 140),
    description: readString(record, "description", 800),
    instructions: readString(record, "instructions", 4000),
    category: readString(record, "category", 80),
    cookingMinutes: readPositiveNumber(record, "cookingMinutes"),
    difficulty: readOptionalString(record, "difficulty", 40, "простая"),
    ingredients: ingredientsValue.map(parseIngredientInput),
  };
}

export function parseUserInput(value: unknown): UserInput {
  const record = requireRecord(value);
  return {
    telegramId: readPositiveInteger(record, "telegramId"),
    fullName: readString(record, "fullName", 160),
    username: readNullableString(record, "username", 80),
  };
}

export function parseRatingInput(value: unknown): RatingInput {
  const record = requireRecord(value);
  const stars = readPositiveInteger(record, "stars");
  if (stars < 1 || stars > 5) {
    throw new HttpError(400, "stars must be between 1 and 5");
  }
  return {
    stars,
    comment: readNullableString(record, "comment", 800),
  };
}

function parseIngredientInput(value: unknown): IngredientInput {
  const record = requireRecord(value);
  return {
    name: readString(record, "name", 100),
    quantity: readPositiveNumber(record, "quantity"),
    unit: readOptionalString(record, "unit", 30, "g"),
    note: readNullableString(record, "note", 120),
  };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "JSON object expected");
  }
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string, maxLength: number): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new HttpError(400, `${key} must be a string`);
  }
  const normalized = normalize(value);
  if (normalized.length > maxLength) {
    throw new HttpError(400, `${key} is too long`);
  }
  return normalized;
}

function readOptionalString(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
  defaultValue: string,
): string {
  const value = record[key];
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  return readString(record, key, maxLength);
}

function readNullableString(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | null {
  const value = record[key];
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return readString(record, key, maxLength);
}

function readPositiveNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new HttpError(400, `${key} must be a positive number`);
  }
  return value;
}

function readPositiveInteger(record: Record<string, unknown>, key: string): number {
  const value = readPositiveNumber(record, key);
  if (!Number.isInteger(value)) {
    throw new HttpError(400, `${key} must be an integer`);
  }
  return value;
}

function normalize(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) {
    throw new HttpError(400, "Text value must not be empty");
  }
  return normalized;
}
