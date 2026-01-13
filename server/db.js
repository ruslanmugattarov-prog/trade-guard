import Database from "better-sqlite3";

export function openDb(path = "./tradeguard.sqlite") {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      tg_user_id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      tg_user_id TEXT PRIMARY KEY,
      max_trades_per_day INTEGER NOT NULL DEFAULT 6,
      max_losses_per_day INTEGER NOT NULL DEFAULT 3,
      max_loss_streak INTEGER NOT NULL DEFAULT 2,
      timezone_offset_min INTEGER NOT NULL DEFAULT 60,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(tg_user_id) REFERENCES users(tg_user_id)
    );

    CREATE TABLE IF NOT EXISTS state (
      tg_user_id TEXT PRIMARY KEY,
      day_key TEXT NOT NULL,
      trades_today INTEGER NOT NULL DEFAULT 0,
      losses_today INTEGER NOT NULL DEFAULT 0,
      loss_streak INTEGER NOT NULL DEFAULT 0,
      trading_off_until_ts INTEGER NOT NULL DEFAULT 0,
      off_reason TEXT NOT NULL DEFAULT "",
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(tg_user_id) REFERENCES users(tg_user_id)
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tg_user_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      type TEXT NOT NULL,
      detail TEXT NOT NULL
    );
  `);

  return db;
}

