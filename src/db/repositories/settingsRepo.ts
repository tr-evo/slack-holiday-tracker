import Database from "better-sqlite3";

export interface SettingsRepo {
  get(key: string): string | null;
  set(key: string, value: string): void;
  isCarryoverEnabled(): boolean;
  getCarryoverCutoff(): string;
}

export function createSettingsRepo(db: Database.Database): SettingsRepo {
  return {
    get(key) {
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as any;
      return row?.value ?? null;
    },

    set(key, value) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
    },

    isCarryoverEnabled() {
      return this.get("carryover_enabled") === "true";
    },

    getCarryoverCutoff() {
      return this.get("carryover_cutoff") ?? "03-31";
    },
  };
}
