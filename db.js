/**
 * Food-Yun Web - 数据库层（SQLite）
 * 对应小程序版云数据库集合：users / recipes / orders / friends / friend_requests
 * 权限规范对应《云开发配置.md》《权限控制规范.md》
 */
const path = require('path')
const fs = require('fs')
const Database = require('better-sqlite3')

const config = require('./lib/config')
const DATA_DIR = config.dataDir
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

const db = new Database(path.join(DATA_DIR, 'food-yun.db'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nickname      TEXT NOT NULL DEFAULT '',
  avatar        TEXT NOT NULL DEFAULT '',
  search_code   TEXT UNIQUE,
  created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at    TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_search_code ON users(search_code);

CREATE TABLE IF NOT EXISTS recipes (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  images              TEXT NOT NULL DEFAULT '[]',   -- JSON 数组
  ingredients         TEXT NOT NULL DEFAULT '[]',   -- JSON [{id,name,amount}]
  steps               TEXT NOT NULL DEFAULT '[]',   -- JSON [{id,content,image}]
  preparation_time    TEXT NOT NULL DEFAULT '{}',   -- JSON {value,label}
  difficulty          TEXT NOT NULL DEFAULT '{}',   -- JSON {value,label,color}
  serving_size        TEXT NOT NULL DEFAULT '{}',   -- JSON {value,label}
  scene_category      TEXT NOT NULL DEFAULT '',     -- 场景分类（必选）
  ingredient_category TEXT NOT NULL DEFAULT '',     -- 食材分类（必选）
  optional_tags       TEXT NOT NULL DEFAULT '[]',   -- JSON 可选标签ID数组
  is_public           INTEGER NOT NULL DEFAULT 1,
  status              TEXT NOT NULL DEFAULT 'published', -- draft | published
  creator_id          INTEGER NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_recipes_creator   ON recipes(creator_id);
CREATE INDEX IF NOT EXISTS idx_recipes_scene     ON recipes(scene_category);
CREATE INDEX IF NOT EXISTS idx_recipes_ing       ON recipes(ingredient_category);
CREATE INDEX IF NOT EXISTS idx_recipes_public    ON recipes(is_public, status);
CREATE INDEX IF NOT EXISTS idx_recipes_created   ON recipes(created_at DESC);

CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no       TEXT NOT NULL UNIQUE,
  creator_id     INTEGER NOT NULL,
  assignee_id    INTEGER NOT NULL,
  meal_type      TEXT NOT NULL,               -- breakfast | lunch | dinner
  order_date     TEXT NOT NULL,
  order_time     TEXT NOT NULL DEFAULT '',
  recipes        TEXT NOT NULL DEFAULT '[]',  -- JSON 菜谱快照
  status         TEXT NOT NULL DEFAULT 'pending', -- pending|processing|completed|cancelled
  notes          TEXT NOT NULL DEFAULT '',
  total_recipes  INTEGER NOT NULL DEFAULT 0,
  estimated_time INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at     TEXT,
  cancel_time    TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_creator  ON orders(creator_id);
CREATE INDEX IF NOT EXISTS idx_orders_assignee ON orders(assignee_id);
CREATE INDEX IF NOT EXISTS idx_orders_status   ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created  ON orders(created_at DESC);

CREATE TABLE IF NOT EXISTS friends (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  friend_id  INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'accepted',
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(user_id, friend_id)
);
CREATE INDEX IF NOT EXISTS idx_friends_user   ON friends(user_id);
CREATE INDEX IF NOT EXISTS idx_friends_friend ON friends(friend_id);

CREATE TABLE IF NOT EXISTS friend_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id INTEGER NOT NULL,
  to_user_id   INTEGER NOT NULL,
  message     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | rejected
  created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  handled_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_fr_from   ON friend_requests(from_user_id, status);
CREATE INDEX IF NOT EXISTS idx_fr_to     ON friend_requests(to_user_id, status);
`)

/** 行转对象：解析 JSON 字段 */
function parseRecipe (row) {
  if (!row) return null
  return {
    _id: String(row.id),
    name: row.name,
    description: row.description,
    images: JSON.parse(row.images || '[]'),
    ingredients: JSON.parse(row.ingredients || '[]'),
    steps: JSON.parse(row.steps || '[]'),
    preparationTime: JSON.parse(row.preparation_time || '{}'),
    difficulty: JSON.parse(row.difficulty || '{}'),
    servingSize: JSON.parse(row.serving_size || '{}'),
    sceneCategory: row.scene_category,
    ingredientCategory: row.ingredient_category,
    optionalTags: JSON.parse(row.optional_tags || '[]'),
    isPublic: !!row.is_public,
    status: row.status,
    creatorId: String(row.creator_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function parseOrder (row) {
  if (!row) return null
  return {
    _id: String(row.id),
    orderNo: row.order_no,
    creatorId: String(row.creator_id),
    assigneeId: String(row.assignee_id),
    mealType: row.meal_type,
    orderDate: row.order_date,
    orderTime: row.order_time,
    recipes: JSON.parse(row.recipes || '[]'),
    status: row.status,
    notes: row.notes,
    totalRecipes: row.total_recipes,
    estimatedTime: row.estimated_time,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cancelTime: row.cancel_time
  }
}

function parseUser (row, { full = false } = {}) {
  if (!row) return null
  const u = {
    _id: String(row.id),
    openid: String(row.id), // 兼容小程序字段语义
    nickname: row.nickname || '未知用户',
    avatar: row.avatar || '',
    searchCode: row.search_code,
    createdAt: row.created_at
  }
  if (full) u.username = row.username
  return u
}

module.exports = { db, parseRecipe, parseOrder, parseUser, DATA_DIR }
