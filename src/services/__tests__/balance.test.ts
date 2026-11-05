import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../../db/schema.js";
import { createUserRepo } from "../../db/repositories/userRepo.js";
import { createSettingsRepo } from "../../db/repositories/settingsRepo.js";
import { getBalanceSnapshot } from "../balance.js";

type Row = [string, string, number?, number?];

// A made-up history, as far as it was recorded in the bot. Counted in BW, so the
// Christmas blocks and the May 2026 block run over public holidays.
const RECORDED: Row[] = [
  ["2024-05-13", "2024-05-14"], ["2024-07-15", "2024-07-16"], ["2024-08-19", "2024-08-26"],
  ["2024-09-16", "2024-09-20"], ["2024-12-23", "2025-01-01"],
  ["2025-03-03", "2025-03-14"], ["2025-08-11", "2025-08-15"], ["2025-08-29", "2025-08-29"],
  ["2025-09-18", "2025-09-18", 1, 1], ["2025-12-22", "2026-01-01"],
  ["2026-03-09", "2026-03-09"], ["2026-03-16", "2026-03-18"], ["2026-05-10", "2026-05-11"],
  ["2026-05-12", "2026-05-29"], ["2026-06-09", "2026-06-09"], ["2026-08-24", "2026-08-26"],
];

// What a hand-kept overview adds on top, with the two-flag day read as a half day.
const NOT_RECORDED: Row[] = [
  ["2024-01-09", "2024-01-09"], ["2024-02-12", "2024-02-13"], ["2024-04-19", "2024-04-19"],
  ["2024-10-16", "2024-10-16", 1, 0],
  ["2025-06-06", "2025-06-06"], ["2025-10-09", "2025-10-09"], ["2025-10-13", "2025-10-14"],
];
const COMPLETE: Row[] = [
  ...RECORDED.map((r): Row => (r[0] === "2025-09-18" ? ["2025-09-18", "2025-09-18", 1, 0] : r)),
  ...NOT_RECORDED,
];

const TODAY = "2026-11-05";

describe("getBalanceSnapshot", () => {
  let db: Database.Database;

  const setup = (rows: Row[]) => {
    const users = createUserRepo(db);
    users.upsert({ slackId: "U1", name: "u" });
    users.setAllowance("U1", 28);
    const insert = db.prepare(
      `INSERT INTO holiday_requests (user_id, start_date, end_date, half_day_start, half_day_end, status)
       VALUES ('U1', ?, ?, ?, ?, 'approved')`
    );
    for (const [start, end, hs, he] of rows) insert.run(start, end, hs ?? 0, he ?? 0);
  };
  const snapshot = (year = 2026, today = TODAY) =>
    getBalanceSnapshot(db, createUserRepo(db).findById("U1")!, year, today);

  beforeEach(() => {
    db = new Database(":memory:");
    initializeSchema(db);
    const settings = createSettingsRepo(db);
    settings.set("carryover_enabled", "true");
    settings.set("carryover_cutoff", "03-31");
    settings.set("carryover_expires", "true");
    settings.set("bundesland", "BW");
  });

  it("derives carryover from the recorded history without any input", async () => {
    setup(RECORDED);
    const s = await snapshot();
    expect(s).toMatchObject({
      grantedCarryover: 13,
      carryoverLapsed: 9,
      carryover: 4,
      budget: 32,
      used: 21,
      usedFromCarryover: 4,
      usedFromAllowance: 17,
      remaining: 11,
    });
  });

  it("gets the same balance with expiry whether or not the history is complete", async () => {
    setup(COMPLETE);
    const users = createUserRepo(db);
    users.setCarryoverDays("U1", 4.5);
    users.setCarryoverStartYear("U1", 2024);
    const s = await snapshot();
    expect(s.grantedCarryover).toBe(8);
    expect(s.remaining).toBe(11);
  });

  it("reproduces the balance without expiry from a complete history", async () => {
    setup(COMPLETE);
    const users = createUserRepo(db);
    users.setCarryoverDays("U1", 4.5);
    users.setCarryoverStartYear("U1", 2024);
    createSettingsRepo(db).set("carryover_expires", "false");

    const results = await Promise.all([2024, 2025, 2026].map((y) => snapshot(y)));
    expect(results.map((s) => s.grantedCarryover)).toEqual([4.5, 8, 9.5]);
    expect(results.map((s) => s.remaining)).toEqual([8, 9.5, 16.5]);
    expect(results[2].carryoverLapsed).toBe(0);
  });

  it("does not lapse anything unless expiry was turned on", async () => {
    const fresh = new Database(":memory:");
    initializeSchema(fresh);
    expect(createSettingsRepo(fresh).isCarryoverExpiring()).toBe(false);
  });

  it("shows each past year with its own carryover", async () => {
    setup(RECORDED);
    const results = await Promise.all([2024, 2025].map((y) => snapshot(y)));
    expect(results.map((s) => s.grantedCarryover)).toEqual([0, 8]);
    expect(results.map((s) => s.remaining)).toEqual([8, 13]);
  });

  it("ignores history before an explicit start year", async () => {
    setup(RECORDED);
    const users = createUserRepo(db);
    users.setCarryoverDays("U1", 2);
    users.setCarryoverStartYear("U1", 2026);
    const s = await snapshot();
    expect(s.grantedCarryover).toBe(2);
    expect(s.remaining).toBe(9); // 28 + 2 - 21: both carryover days were spent in March
  });

  it("carries nothing while carryover is disabled", async () => {
    setup(RECORDED);
    createSettingsRepo(db).set("carryover_enabled", "false");
    const s = await snapshot();
    expect(s).toMatchObject({ grantedCarryover: 0, carryover: 0, remaining: 7 });
  });

  it("opens the first recorded year with nothing for someone new", async () => {
    setup([["2026-06-15", "2026-06-18"]]);
    const s = await snapshot();
    expect(s).toMatchObject({ grantedCarryover: 0, remaining: 24 });
  });
});
