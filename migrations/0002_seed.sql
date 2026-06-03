INSERT OR IGNORE INTO users (telegram_id, full_name, username)
VALUES (1001, 'Demo User', 'demo_recipe_user');

INSERT OR IGNORE INTO categories (name)
VALUES ('завтраки'), ('супы'), ('десерты');

INSERT OR IGNORE INTO ingredients (name, unit)
VALUES
  ('яйца', 'шт'),
  ('молоко', 'мл'),
  ('мука', 'г'),
  ('курица', 'г'),
  ('лапша', 'г'),
  ('морковь', 'г'),
  ('творог', 'г'),
  ('сахар', 'г'),
  ('ягоды', 'г');

INSERT OR IGNORE INTO recipes (
  id,
  title,
  description,
  instructions,
  cooking_minutes,
  difficulty,
  author_user_id,
  category_id
)
VALUES
  (
    1,
    'Омлет с молоком',
    'Быстрый белковый завтрак на каждый день.',
    'Взбейте яйца с молоком, посолите и жарьте на среднем огне 6-8 минут.',
    10,
    'простая',
    (SELECT id FROM users WHERE telegram_id = 1001),
    (SELECT id FROM categories WHERE name = 'завтраки')
  ),
  (
    2,
    'Куриный суп с лапшой',
    'Домашний суп с курицей, овощами и лапшой.',
    'Отварите курицу, добавьте морковь и лапшу, варите до готовности.',
    45,
    'средняя',
    (SELECT id FROM users WHERE telegram_id = 1001),
    (SELECT id FROM categories WHERE name = 'супы')
  ),
  (
    3,
    'Творожный десерт с ягодами',
    'Легкий десерт без выпечки.',
    'Смешайте творог с сахаром, выложите ягоды сверху и охладите 15 минут.',
    20,
    'простая',
    (SELECT id FROM users WHERE telegram_id = 1001),
    (SELECT id FROM categories WHERE name = 'десерты')
  );

INSERT OR IGNORE INTO recipe_ingredients (recipe_id, ingredient_id, quantity, note)
VALUES
  (1, (SELECT id FROM ingredients WHERE name = 'яйца'), 3, NULL),
  (1, (SELECT id FROM ingredients WHERE name = 'молоко'), 80, NULL),
  (2, (SELECT id FROM ingredients WHERE name = 'курица'), 300, 'филе или бедро'),
  (2, (SELECT id FROM ingredients WHERE name = 'лапша'), 120, NULL),
  (2, (SELECT id FROM ingredients WHERE name = 'морковь'), 100, NULL),
  (3, (SELECT id FROM ingredients WHERE name = 'творог'), 250, NULL),
  (3, (SELECT id FROM ingredients WHERE name = 'сахар'), 25, 'по вкусу'),
  (3, (SELECT id FROM ingredients WHERE name = 'ягоды'), 120, NULL);

INSERT OR IGNORE INTO ratings (user_id, recipe_id, stars, comment)
VALUES
  ((SELECT id FROM users WHERE telegram_id = 1001), 1, 5, 'Быстро и удобно для завтрака.'),
  ((SELECT id FROM users WHERE telegram_id = 1001), 2, 4, 'Подходит для семейного обеда.');
