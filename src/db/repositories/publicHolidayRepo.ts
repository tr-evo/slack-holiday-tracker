import Database from "better-sqlite3";

export interface PublicHoliday {
  date: string;
  name: string;
  nameDe: string;
}

export interface PublicHolidayRepo {
  add(holiday: PublicHoliday): void;
  remove(date: string): void;
  getForYear(year: number): PublicHoliday[];
  getDatesForYear(year: number): string[];
}

export function createPublicHolidayRepo(db: Database.Database): PublicHolidayRepo {
  return {
    add(holiday) {
      db.prepare(
        "INSERT OR REPLACE INTO public_holidays (date, name, name_de) VALUES (?, ?, ?)"
      ).run(holiday.date, holiday.name, holiday.nameDe);
    },

    remove(date) {
      db.prepare("DELETE FROM public_holidays WHERE date = ?").run(date);
    },

    getForYear(year) {
      return db.prepare(
        "SELECT * FROM public_holidays WHERE strftime('%Y', date) = ? ORDER BY date"
      ).all(String(year)).map((row: any) => ({
        date: row.date,
        name: row.name,
        nameDe: row.name_de,
      }));
    },

    getDatesForYear(year) {
      return db.prepare(
        "SELECT date FROM public_holidays WHERE strftime('%Y', date) = ? ORDER BY date"
      ).all(String(year)).map((row: any) => row.date);
    },
  };
}
