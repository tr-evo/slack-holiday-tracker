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

  it("cancels a request and records who did it", () => {
    const id = repo.create({ userId: "U123", startDate: "2026-09-01", endDate: "2026-09-03", halfDayStart: false, halfDayEnd: false, reason: null });
    repo.approve(id, "ADMIN1", null);
    repo.cancel(id, "U123");

    const req = repo.findById(id)!;
    expect(req.status).toBe("cancelled");
    expect(req.approvedBy).toBe("U123");
  });

  it("stops counting a cancelled request toward the yearly balance", () => {
    const id = repo.create({ userId: "U123", startDate: "2026-09-01", endDate: "2026-09-03", halfDayStart: false, halfDayEnd: false, reason: null });
    repo.approve(id, "ADMIN1", null);
    expect(repo.getApprovedForUserInYear("U123", 2026)).toHaveLength(1);

    repo.cancel(id, "U123");
    expect(repo.getApprovedForUserInYear("U123", 2026)).toHaveLength(0);
  });

  it("removes a cancelled request from the upcoming list and the pending queue", () => {
    const approvedId = repo.create({ userId: "U123", startDate: "2026-09-01", endDate: "2026-09-03", halfDayStart: false, halfDayEnd: false, reason: null });
    repo.approve(approvedId, "ADMIN1", null);
    const pendingId = repo.create({ userId: "U123", startDate: "2026-10-01", endDate: "2026-10-02", halfDayStart: false, halfDayEnd: false, reason: null });

    expect(repo.getUpcomingApproved("2026-08-25")).toHaveLength(1);
    expect(repo.getPending()).toHaveLength(1);

    repo.cancel(approvedId, "U123");
    repo.cancel(pendingId, "U123");

    expect(repo.getUpcomingApproved("2026-08-25")).toHaveLength(0);
    expect(repo.getPending()).toHaveLength(0);
  });

  describe("getApprovedOverlapping", () => {
    beforeEach(() => {
      // user_id is a foreign key into users(slack_id)
      const insert = db.prepare("INSERT INTO users (slack_id, name) VALUES (?, ?)");
      for (const id of ["U1", "U2", "U3", "U4", "U5"]) insert.run(id, `Person ${id}`);
    });

    const make = (userId: string, startDate: string, endDate: string, approve = true) => {
      const id = repo.create({ userId, startDate, endDate, halfDayStart: false, halfDayEnd: false, reason: null });
      if (approve) repo.approve(id, "ADMIN1", null);
      return id;
    };

    it("finds ranges that touch the window at either edge", () => {
      make("U1", "2026-09-01", "2026-09-05");   // fully inside
      make("U2", "2026-08-28", "2026-09-02");   // overlaps the start
      make("U3", "2026-09-04", "2026-09-10");   // overlaps the end
      make("U4", "2026-08-01", "2026-09-30");   // spans the whole window
      make("U5", "2026-10-01", "2026-10-05");   // clear of it

      const found = repo.getApprovedOverlapping("2026-09-01", "2026-09-05");
      expect(found.map((r) => r.userId).sort()).toEqual(["U1", "U2", "U3", "U4"]);
    });

    it("counts a range that ends exactly on the first day", () => {
      make("U1", "2026-08-20", "2026-09-01");
      expect(repo.getApprovedOverlapping("2026-09-01", "2026-09-05")).toHaveLength(1);
    });

    it("excludes the requester so they do not clash with themselves", () => {
      make("U1", "2026-09-01", "2026-09-05");
      make("U2", "2026-09-01", "2026-09-05");
      const found = repo.getApprovedOverlapping("2026-09-01", "2026-09-05", "U1");
      expect(found.map((r) => r.userId)).toEqual(["U2"]);
    });

    it("ignores anything not approved", () => {
      make("U1", "2026-09-01", "2026-09-05", false);
      const cancelled = make("U2", "2026-09-01", "2026-09-05");
      repo.cancel(cancelled, "U2");
      expect(repo.getApprovedOverlapping("2026-09-01", "2026-09-05")).toHaveLength(0);
    });
  });
});
