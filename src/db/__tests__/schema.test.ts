import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../schema.js";

describe("database schema", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initializeSchema(db);
  });

  it("creates users table", () => {
    const info = db.prepare("PRAGMA table_info(users)").all();
    const columns = info.map((col: any) => col.name);
    expect(columns).toContain("slack_id");
    expect(columns).toContain("name");
    expect(columns).toContain("annual_allowance");
    expect(columns).toContain("language");
    expect(columns).toContain("is_admin");
  });

  it("creates holiday_requests table", () => {
    const info = db.prepare("PRAGMA table_info(holiday_requests)").all();
    const columns = info.map((col: any) => col.name);
    expect(columns).toContain("id");
    expect(columns).toContain("user_id");
    expect(columns).toContain("start_date");
    expect(columns).toContain("end_date");
    expect(columns).toContain("half_day_start");
    expect(columns).toContain("half_day_end");
    expect(columns).toContain("status");
    expect(columns).toContain("approved_by");
    expect(columns).toContain("reason");
    expect(columns).toContain("reviewer_comment");
    expect(columns).toContain("created_at");
  });

  it("creates public_holidays table", () => {
    const info = db.prepare("PRAGMA table_info(public_holidays)").all();
    const columns = info.map((col: any) => col.name);
    expect(columns).toContain("date");
    expect(columns).toContain("name");
    expect(columns).toContain("name_de");
  });

  it("creates settings table", () => {
    const info = db.prepare("PRAGMA table_info(settings)").all();
    const columns = info.map((col: any) => col.name);
    expect(columns).toContain("key");
    expect(columns).toContain("value");
  });

  it("inserts default settings", () => {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("default_allowance") as any;
    expect(row.value).toBe("30");
  });
});
