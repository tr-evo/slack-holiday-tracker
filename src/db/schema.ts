import Database from "better-sqlite3";

export function initializeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      slack_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      annual_allowance INTEGER NOT NULL DEFAULT 30,
      language TEXT NOT NULL DEFAULT 'en',
      is_admin INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS holiday_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(slack_id),
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      half_day_start INTEGER NOT NULL DEFAULT 0,
      half_day_end INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      approved_by TEXT,
      reason TEXT,
      reviewer_comment TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS public_holidays (
      date TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_de TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    INSERT OR IGNORE INTO settings (key, value) VALUES ('default_allowance', '30');
  `);
}
