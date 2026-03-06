import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../../schema.js";
import { createPublicHolidayRepo, PublicHolidayRepo } from "../publicHolidayRepo.js";

describe("publicHolidayRepo", () => {
  let db: Database.Database;
  let repo: PublicHolidayRepo;

  beforeEach(() => {
    db = new Database(":memory:");
    initializeSchema(db);
    repo = createPublicHolidayRepo(db);
  });

  it("adds and retrieves a public holiday", () => {
    repo.add({ date: "2026-12-25", name: "Christmas Day", nameDe: "Weihnachtstag" });
    const holidays = repo.getForYear(2026);
    expect(holidays).toHaveLength(1);
    expect(holidays[0]).toMatchObject({ date: "2026-12-25", name: "Christmas Day", nameDe: "Weihnachtstag" });
  });

  it("returns dates only for a year", () => {
    repo.add({ date: "2026-01-01", name: "New Year", nameDe: "Neujahr" });
    repo.add({ date: "2026-12-25", name: "Christmas", nameDe: "Weihnachten" });
    repo.add({ date: "2027-01-01", name: "New Year", nameDe: "Neujahr" });
    const dates = repo.getDatesForYear(2026);
    expect(dates).toEqual(["2026-01-01", "2026-12-25"]);
  });

  it("removes a public holiday", () => {
    repo.add({ date: "2026-12-25", name: "Christmas", nameDe: "Weihnachten" });
    repo.remove("2026-12-25");
    expect(repo.getForYear(2026)).toHaveLength(0);
  });
});
