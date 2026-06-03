PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  username TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users (telegram_id);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_categories_name ON categories (name);

CREATE TABLE IF NOT EXISTS ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  unit TEXT NOT NULL DEFAULT 'g'
);

CREATE INDEX IF NOT EXISTS idx_ingredients_name ON ingredients (name);

CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  instructions TEXT NOT NULL,
  cooking_minutes INTEGER NOT NULL CHECK (cooking_minutes > 0),
  difficulty TEXT NOT NULL DEFAULT 'простая',
  author_user_id INTEGER,
  category_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (author_user_id) REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_recipes_title ON recipes (title);
CREATE INDEX IF NOT EXISTS idx_recipes_category ON recipes (category_id);

CREATE TABLE IF NOT EXISTS recipe_ingredients (
  recipe_id INTEGER NOT NULL,
  ingredient_id INTEGER NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  note TEXT,
  PRIMARY KEY (recipe_id, ingredient_id),
  FOREIGN KEY (recipe_id) REFERENCES recipes (id) ON DELETE CASCADE,
  FOREIGN KEY (ingredient_id) REFERENCES ingredients (id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL,
  recipe_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, recipe_id),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (recipe_id) REFERENCES recipes (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ratings (
  user_id INTEGER NOT NULL,
  recipe_id INTEGER NOT NULL,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, recipe_id),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (recipe_id) REFERENCES recipes (id) ON DELETE CASCADE
);
