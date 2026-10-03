-- ミライ会員サービス: データベース設計（検証用の実装。SQLite）
CREATE TABLE customers (
  customer_id   TEXT PRIMARY KEY,            -- 顧客ID（例: C0001）
  name          TEXT NOT NULL,
  gender        TEXT,
  age_group     TEXT,
  prefecture    TEXT,
  region        TEXT,
  channel       TEXT,                        -- 流入経路
  registered_at TEXT
);
CREATE TABLE products (
  product_id TEXT PRIMARY KEY,               -- 商品ID（例: P001）
  name       TEXT NOT NULL,
  category   TEXT NOT NULL,
  price      INTEGER NOT NULL CHECK (price > 0),
  cost       INTEGER
);
CREATE TABLE stocks (
  product_id TEXT PRIMARY KEY REFERENCES products(product_id),
  quantity   INTEGER NOT NULL CHECK (quantity >= 0),
  updated_at TEXT NOT NULL
);
CREATE TABLE orders (
  order_id       TEXT PRIMARY KEY,           -- 注文ID（例: O00001）
  ordered_at     TEXT NOT NULL,
  customer_id    TEXT NOT NULL REFERENCES customers(customer_id),
  product_id     TEXT NOT NULL REFERENCES products(product_id),
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  discount_rate  REAL NOT NULL DEFAULT 0,
  payment_method TEXT,
  delivery_days  INTEGER
);
CREATE TABLE members (
  member_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  email            TEXT NOT NULL UNIQUE,
  password_hash    TEXT NOT NULL,
  display_name     TEXT,
  customer_id      TEXT NOT NULL UNIQUE REFERENCES customers(customer_id),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','withdrawn')),
  is_admin         INTEGER NOT NULL DEFAULT 0,
  last_purchase_at TEXT,
  created_at       TEXT NOT NULL
);
CREATE TABLE point_history (
  history_id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id  INTEGER NOT NULL REFERENCES members(member_id),
  order_id   TEXT REFERENCES orders(order_id),
  points     INTEGER NOT NULL,               -- 付与は＋、利用・失効は－
  reason     TEXT NOT NULL CHECK (reason IN ('purchase','use','expire','adjust')),
  created_at TEXT NOT NULL
);
CREATE TABLE restock_requests (
  request_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id   INTEGER NOT NULL REFERENCES members(member_id),
  product_id  TEXT NOT NULL REFERENCES products(product_id),
  status      TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','notified','cancelled')),
  created_at  TEXT NOT NULL,
  notified_at TEXT
);
-- 同じ会員が、同じ商品を「待っている」登録を、2つ持てない
CREATE UNIQUE INDEX uq_restock_waiting ON restock_requests (member_id, product_id) WHERE status = 'waiting';
CREATE INDEX idx_orders_customer ON orders (customer_id);
CREATE INDEX idx_point_member ON point_history (member_id);
