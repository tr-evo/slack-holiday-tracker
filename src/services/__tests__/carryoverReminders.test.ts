import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../../db/schema.js";
import { createUserRepo } from "../../db/repositories/userRepo.js";
import { createSettingsRepo } from "../../db/repositories/settingsRepo.js";
import { getBalanceSnapshot } from "../balance.js";
import { dueReminder, reminderSchedule, runCarryoverReminders } from "../carryoverReminders.js";

describe("reminderSchedule", () => {
  it("uses weekdays around the cutoff", () => {
    expect(reminderSchedule(2027, "03-31")).toEqual([
      { kind: "year_start", date: "2027-01-04" }, // 02.01.2027 is a Saturday
      { kind: "end_jan", date: "2027-01-29" },
      { kind: "end_feb", date: "2027-02-26" },
      { kind: "mid_mar", date: "2027-03-15" },
      { kind: "lapsed", date: "2027-04-01" },
    ]);
  });

  it("moves mid-March back to a weekday", () => {
    // 15.03.2026 is a Sunday
    expect(reminderSchedule(2026, "03-31").find((r) => r.kind === "mid_mar")?.date).toBe("2026-03-13");
  });

  it("drops reminders that would come after an earlier cutoff", () => {
    expect(reminderSchedule(2027, "02-28").map((r) => r.kind)).toEqual(["year_start", "end_jan", "end_feb", "lapsed"]);
  });
});

describe("dueReminder", () => {
  it("is the latest reminder that has come due", () => {
    expect(dueReminder("2027-01-29", "03-31")).toEqual({ kind: "end_jan", year: 2027 });
    expect(dueReminder("2027-02-02", "03-31")).toEqual({ kind: "end_jan", year: 2027 });
  });

  it("finds a lapse notice that falls into the next January", () => {
    expect(dueReminder("2027-01-01", "12-31")).toEqual({ kind: "lapsed", year: 2026 });
  });

  it("is nothing before the first one and once one is too old", () => {
    expect(dueReminder("2027-01-01", "03-31")).toBeNull();
    expect(dueReminder("2027-01-20", "03-31")).toBeNull();
    expect(dueReminder("2027-04-20", "03-31")).toBeNull();
  });
});

describe("runCarryoverReminders", () => {
  let db: Database.Database;
  let sent: { channel: string; text: string }[];
  const client = {
    conversations: { open: async ({ users }: any) => ({ channel: { id: users } }) },
    chat: { postMessage: async (msg: any) => { sent.push(msg); return {}; } },
  };
  const addRequest = (user: string, start: string, end: string) =>
    db.prepare("INSERT INTO holiday_requests (user_id, start_date, end_date, status) VALUES (?, ?, ?, 'approved')")
      .run(user, start, end);

  beforeEach(() => {
    db = new Database(":memory:");
    initializeSchema(db);
    sent = [];
    const settings = createSettingsRepo(db);
    settings.set("carryover_enabled", "true");
    settings.set("carryover_expires", "true");
    settings.set("carryover_expires_from", "2027");
    const users = createUserRepo(db);
    for (const id of ["WITH", "WITHOUT"]) {
      users.upsert({ slackId: id, name: id.toLowerCase() });
      users.setAllowance(id, 28);
      users.setLanguage(id, "de");
    }
    users.setCarryoverDays("WITH", 5);
    users.setCarryoverStartYear("WITH", 2027);
    users.setCarryoverStartYear("WITHOUT", 2027);
  });

  it("sends nothing while expiry is off, or more than a year before it applies", async () => {
    createSettingsRepo(db).set("carryover_expires", "false");
    await runCarryoverReminders(db, client, "2027-01-04");
    createSettingsRepo(db).set("carryover_expires", "true");
    createSettingsRepo(db).set("carryover_expires_from", "2029");
    await runCarryoverReminders(db, client, "2027-01-04");
    expect(sent).toEqual([]);
  });

  describe("the year before expiry starts", () => {
    beforeEach(() => createSettingsRepo(db).set("carryover_expires_from", "2028"));

    it("announces it to everyone at the start of the year, with the balance", async () => {
      await runCarryoverReminders(db, client, "2027-01-04");
      expect(sent).toHaveLength(2);
      const text = sent.find((m) => m.channel === "WITH")!.text;
      expect(text).toContain("Ab 2028");
      expect(text).toContain("31.03.2028");
      expect(text).toContain("33 Tage");
      expect(sent.find((m) => m.channel === "WITHOUT")!.text).toContain("28 Tage");
    });

    it("repeats it only for those with carryover left", async () => {
      await runCarryoverReminders(db, client, "2027-03-15");
      expect(sent.map((m) => m.channel)).toEqual(["WITH"]);
      expect(sent[0].text).toContain("Ab 2028");
    });

    it("reports nothing as lapsed", async () => {
      await runCarryoverReminders(db, client, "2027-04-01");
      expect(sent).toEqual([]);
    });
  });

  it("tells everyone at the start of the year, with the carryover where there is one", async () => {
    await runCarryoverReminders(db, client, "2027-01-04");
    expect(sent).toHaveLength(2);
    const withDays = sent.find((m) => m.channel === "WITH")!.text;
    expect(withDays).toContain("28 Tage Jahresurlaub");
    expect(withDays).toContain("31.03.2028");
    expect(withDays).toContain("5 Tage Übertrag");
    expect(withDays).toContain("31.03.2027");
    expect(sent.find((m) => m.channel === "WITHOUT")!.text).not.toContain("Übertrag");
  });

  it("sends each notice once and records it", async () => {
    await runCarryoverReminders(db, client, "2027-01-04");
    await runCarryoverReminders(db, client, "2027-01-05");
    expect(sent).toHaveLength(2);
    const row = db.prepare("SELECT * FROM carryover_notices WHERE user_id = 'WITH'").get() as any;
    expect(row).toMatchObject({ year: 2027, kind: "year_start", days: 5 });
    expect(row.sent_at).toBeTruthy();
  });

  it("reminds at month end only those with days at risk, counting approved leave", async () => {
    addRequest("WITH", "2027-02-01", "2027-02-02");
    await runCarryoverReminders(db, client, "2027-01-29");
    expect(sent.map((m) => m.channel)).toEqual(["WITH"]);
    expect(sent[0].text).toContain("3 Tage Übertrag");
    expect(sent[0].text).toContain("31.03.2027");
  });

  it("reports what lapsed the day after the cutoff, and only to those it hit", async () => {
    addRequest("WITH", "2027-02-01", "2027-02-02");
    await runCarryoverReminders(db, client, "2027-04-01");
    expect(sent.map((m) => m.channel)).toEqual(["WITH"]);
    expect(sent[0].text).toContain("3 Tage Übertrag");
    expect(sent[0].text).toContain("verfallen");
    expect(sent[0].text).toContain("28 Tage Resturlaub");
  });

  it("writes dates for the reader's language", async () => {
    createUserRepo(db).setLanguage("WITH", "en");
    await runCarryoverReminders(db, client, "2027-01-04");
    const text = sent.find((m) => m.channel === "WITH")!.text;
    expect(text).toContain("31 Dec 2027");
    expect(text).toContain("31 Mar 2027");
  });

  it("sends the lapse notice of a late-December cutoff in January, for the year that ended", async () => {
    createSettingsRepo(db).set("carryover_cutoff", "12-31");
    createSettingsRepo(db).set("carryover_expires_from", "2026");
    createUserRepo(db).setCarryoverStartYear("WITH", 2026);
    await runCarryoverReminders(db, client, "2027-01-01");
    expect(sent.map((m) => m.channel)).toEqual(["WITH"]);
    expect(sent[0].text).toContain("5 Tage Übertrag");
    expect(sent[0].text).toContain("31.12.2026");
  });

  it("writes half days the German way", async () => {
    createUserRepo(db).setCarryoverDays("WITH", 4.5);
    await runCarryoverReminders(db, client, "2027-01-29");
    expect(sent[0].text).toContain("4,5 Tage Übertrag");
  });

  it("retries someone whose DM failed", async () => {
    const failing = { ...client, chat: { postMessage: async () => { throw new Error("nope"); } } };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await runCarryoverReminders(db, failing, "2027-01-04");
    expect(db.prepare("SELECT COUNT(*) c FROM carryover_notices").get()).toEqual({ c: 0 });
    consoleError.mockRestore();
    await runCarryoverReminders(db, client, "2027-01-04");
    expect(sent).toHaveLength(2);
  });
});

describe("expiry from a year", () => {
  it("leaves earlier years untouched and lapses from that year on", async () => {
    const db = new Database(":memory:");
    initializeSchema(db);
    const settings = createSettingsRepo(db);
    settings.set("carryover_enabled", "true");
    settings.set("carryover_expires", "true");
    settings.set("carryover_expires_from", "2027");
    const users = createUserRepo(db);
    users.upsert({ slackId: "U", name: "u" });
    users.setAllowance("U", 28);
    users.setCarryoverDays("U", 10);
    users.setCarryoverStartYear("U", 2025);

    const snapshot = (year: number, today: string) => getBalanceSnapshot(db, users.findById("U")!, year, today);
    expect(await snapshot(2026, "2026-11-05")).toMatchObject({ carryoverExpires: false, carryoverLapsed: 0, remaining: 66 });
    expect(await snapshot(2027, "2027-03-31")).toMatchObject({ carryoverExpires: true, carryoverUnused: 66, carryoverLapsed: 0 });
    expect(await snapshot(2027, "2027-04-01")).toMatchObject({ carryoverLapsed: 66, remaining: 28 });
  });
});
