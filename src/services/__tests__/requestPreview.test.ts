import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../../db/schema.js";
import { createUserRepo } from "../../db/repositories/userRepo.js";
import { createSettingsRepo } from "../../db/repositories/settingsRepo.js";
import { previewRequest } from "../requestPreview.js";

describe("previewRequest", () => {
  let db: Database.Database;
  const preview = (startDate: string, endDate: string) =>
    previewRequest(db, createUserRepo(db).findById("U")!, { startDate, endDate, halfDayStart: false, halfDayEnd: false }, "de");

  beforeEach(() => {
    db = new Database(":memory:");
    initializeSchema(db);
    const settings = createSettingsRepo(db);
    settings.set("carryover_enabled", "true");
    const users = createUserRepo(db);
    users.upsert({ slackId: "U", name: "u" });
    users.setAllowance("U", 10);
    users.setCarryoverDays("U", 5);
    users.setCarryoverStartYear("U", new Date().getUTCFullYear());
  });

  const year = new Date().getUTCFullYear() + 1;

  it("checks a request against the year it is charged to", async () => {
    // Next year holds 10 + 15 carried over; this year only 15
    const result = await preview(`${year}-06-01`, `${year}-06-26`);  // about four weeks
    expect(result?.problem).toBeUndefined();
    expect(result?.remaining).toBe(25);
  });

  it("does not let carryover pay for days after the cutoff when expiry applies", async () => {
    const settings = createSettingsRepo(db);
    settings.set("carryover_expires", "true");
    createUserRepo(db).setCarryoverStartYear("U", year);
    createUserRepo(db).setCarryoverDays("U", 5);
    // 15 remaining on paper, but the 5 carried days cannot pay for June
    const result = await preview(`${year}-06-01`, `${year}-06-19`);  // about three weeks
    expect(result?.remaining).toBe(15);
    expect(result?.problem).toBe("insufficient");
  });

  it("lets carryover pay for days before the cutoff", async () => {
    createSettingsRepo(db).set("carryover_expires", "true");
    createUserRepo(db).setCarryoverStartYear("U", year);
    const result = await preview(`${year}-03-01`, `${year}-03-19`);
    expect(result?.problem).toBeUndefined();
  });
});
