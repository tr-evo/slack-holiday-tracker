import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../../schema.js";
import { createUserRepo, UserRepo } from "../userRepo.js";

describe("userRepo", () => {
  let db: Database.Database;
  let repo: UserRepo;

  beforeEach(() => {
    db = new Database(":memory:");
    initializeSchema(db);
    repo = createUserRepo(db);
  });

  it("creates and finds a user", () => {
    repo.upsert({ slackId: "U123", name: "Alice" });
    const user = repo.findById("U123");
    expect(user).toMatchObject({
      slackId: "U123",
      name: "Alice",
      annualAllowance: 30,
      language: "en",
      isAdmin: false,
    });
  });

  it("updates existing user on upsert", () => {
    repo.upsert({ slackId: "U123", name: "Alice" });
    repo.upsert({ slackId: "U123", name: "Alice Updated" });
    const user = repo.findById("U123");
    expect(user?.name).toBe("Alice Updated");
  });

  it("sets admin status", () => {
    repo.upsert({ slackId: "U123", name: "Alice" });
    repo.setAdmin("U123", true);
    expect(repo.findById("U123")?.isAdmin).toBe(true);
  });

  it("sets annual allowance", () => {
    repo.upsert({ slackId: "U123", name: "Alice" });
    repo.setAllowance("U123", 25);
    expect(repo.findById("U123")?.annualAllowance).toBe(25);
  });

  it("sets language", () => {
    repo.upsert({ slackId: "U123", name: "Alice" });
    repo.setLanguage("U123", "de");
    expect(repo.findById("U123")?.language).toBe("de");
  });

  it("returns all admins", () => {
    repo.upsert({ slackId: "U1", name: "Alice" });
    repo.upsert({ slackId: "U2", name: "Bob" });
    repo.setAdmin("U1", true);
    const admins = repo.getAdmins();
    expect(admins).toHaveLength(1);
    expect(admins[0].slackId).toBe("U1");
  });

  it("returns null for non-existent user", () => {
    expect(repo.findById("NONEXISTENT")).toBeNull();
  });
});
