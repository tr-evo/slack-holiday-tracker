import Database from "better-sqlite3";

export interface User {
  slackId: string;
  name: string;
  annualAllowance: number;
  language: string;
  isAdmin: boolean;
}

export interface UserRepo {
  upsert(user: { slackId: string; name: string }): void;
  findById(slackId: string): User | null;
  setAdmin(slackId: string, isAdmin: boolean): void;
  setAllowance(slackId: string, allowance: number): void;
  setLanguage(slackId: string, language: string): void;
  getAdmins(): User[];
  getAll(): User[];
}

function rowToUser(row: any): User {
  return {
    slackId: row.slack_id,
    name: row.name,
    annualAllowance: row.annual_allowance,
    language: row.language,
    isAdmin: Boolean(row.is_admin),
  };
}

export function createUserRepo(db: Database.Database): UserRepo {
  return {
    upsert({ slackId, name }) {
      db.prepare(
        `INSERT INTO users (slack_id, name) VALUES (?, ?)
         ON CONFLICT(slack_id) DO UPDATE SET name = excluded.name`
      ).run(slackId, name);
    },

    findById(slackId) {
      const row = db.prepare("SELECT * FROM users WHERE slack_id = ?").get(slackId);
      return row ? rowToUser(row) : null;
    },

    setAdmin(slackId, isAdmin) {
      db.prepare("UPDATE users SET is_admin = ? WHERE slack_id = ?").run(isAdmin ? 1 : 0, slackId);
    },

    setAllowance(slackId, allowance) {
      db.prepare("UPDATE users SET annual_allowance = ? WHERE slack_id = ?").run(allowance, slackId);
    },

    setLanguage(slackId, language) {
      db.prepare("UPDATE users SET language = ? WHERE slack_id = ?").run(language, slackId);
    },

    getAdmins() {
      return db.prepare("SELECT * FROM users WHERE is_admin = 1").all().map(rowToUser);
    },

    getAll() {
      return db.prepare("SELECT * FROM users").all().map(rowToUser);
    },
  };
}
