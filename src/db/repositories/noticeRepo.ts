import Database from "better-sqlite3";

export interface NoticeRepo {
  wasSent(userId: string, year: number, kind: string): boolean;
  record(userId: string, year: number, kind: string, days: number): void;
}

export function createNoticeRepo(db: Database.Database): NoticeRepo {
  return {
    wasSent(userId, year, kind) {
      return Boolean(
        db.prepare("SELECT 1 FROM carryover_notices WHERE user_id = ? AND year = ? AND kind = ?").get(userId, year, kind)
      );
    },

    record(userId, year, kind, days) {
      db.prepare("INSERT OR IGNORE INTO carryover_notices (user_id, year, kind, days) VALUES (?, ?, ?, ?)")
        .run(userId, year, kind, days);
    },
  };
}
