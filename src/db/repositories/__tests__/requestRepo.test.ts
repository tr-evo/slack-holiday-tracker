import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../../schema.js";
import { createRequestRepo, RequestRepo } from "../requestRepo.js";

describe("requestRepo", () => {
  let db: Database.Database;
  let repo: RequestRepo;

  beforeEach(() => {
    db = new Database(":memory:");
    initializeSchema(db);
    db.prepare("INSERT INTO users (slack_id, name) VALUES (?, ?)").run("U123", "Alice");
    repo = createRequestRepo(db);
  });

  it("creates a request and returns its id", () => {
    const id = repo.create({
      userId: "U123",
      startDate: "2026-04-01",
      endDate: "2026-04-03",
      halfDayStart: false,
      halfDayEnd: false,
      reason: "Family trip",
    });
    expect(id).toBeGreaterThan(0);
  });

  it("finds a request by id", () => {
    const id = repo.create({
      userId: "U123",
      startDate: "2026-04-01",
      endDate: "2026-04-03",
      halfDayStart: true,
      halfDayEnd: false,
      reason: null,
    });
    const req = repo.findById(id);
    expect(req).toMatchObject({
      id,
      userId: "U123",
      startDate: "2026-04-01",
      endDate: "2026-04-03",
      halfDayStart: true,
      halfDayEnd: false,
      status: "pending",
    });
  });

  it("lists requests for a user", () => {
    repo.create({ userId: "U123", startDate: "2026-04-01", endDate: "2026-04-03", halfDayStart: false, halfDayEnd: false, reason: null });
    repo.create({ userId: "U123", startDate: "2026-05-01", endDate: "2026-05-02", halfDayStart: false, halfDayEnd: false, reason: null });
    const list = repo.listByUser("U123");
    expect(list).toHaveLength(2);
  });

  it("approves a request", () => {
    const id = repo.create({ userId: "U123", startDate: "2026-04-01", endDate: "2026-04-03", halfDayStart: false, halfDayEnd: false, reason: null });
    repo.approve(id, "ADMIN1", "Enjoy!");
    const req = repo.findById(id);
    expect(req?.status).toBe("approved");
    expect(req?.approvedBy).toBe("ADMIN1");
    expect(req?.reviewerComment).toBe("Enjoy!");
  });

  it("rejects a request", () => {
    const id = repo.create({ userId: "U123", startDate: "2026-04-01", endDate: "2026-04-03", halfDayStart: false, halfDayEnd: false, reason: null });
    repo.reject(id, "ADMIN1", "Too busy");
    const req = repo.findById(id);
    expect(req?.status).toBe("rejected");
    expect(req?.reviewerComment).toBe("Too busy");
  });

  it("gets all pending requests", () => {
    const id1 = repo.create({ userId: "U123", startDate: "2026-04-01", endDate: "2026-04-03", halfDayStart: false, halfDayEnd: false, reason: null });
    repo.create({ userId: "U123", startDate: "2026-05-01", endDate: "2026-05-02", halfDayStart: false, halfDayEnd: false, reason: null });
    repo.approve(id1, "ADMIN1", null);
    const pending = repo.getPending();
    expect(pending).toHaveLength(1);
  });

  it("gets approved requests for a user in a year", () => {
    const id = repo.create({ userId: "U123", startDate: "2026-04-01", endDate: "2026-04-03", halfDayStart: false, halfDayEnd: false, reason: null });
    repo.approve(id, "ADMIN1", null);
    const id2 = repo.create({ userId: "U123", startDate: "2026-07-01", endDate: "2026-07-05", halfDayStart: false, halfDayEnd: false, reason: null });
    repo.approve(id2, "ADMIN1", null);

    const approved = repo.getApprovedForUserInYear("U123", 2026);
    expect(approved).toHaveLength(2);
  });
});
