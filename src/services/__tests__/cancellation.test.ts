import { describe, it, expect } from "vitest";
import { canUserCancel } from "../cancellation.js";

const TODAY = "2026-08-25";

describe("canUserCancel", () => {
  it("allows withdrawing a pending request in the future", () => {
    expect(canUserCancel({ status: "pending", startDate: "2026-09-01" }, TODAY))
      .toEqual({ allowed: true });
  });

  it("allows withdrawing a pending request even once its start date has passed", () => {
    // Nothing was granted, so there is no history to protect
    expect(canUserCancel({ status: "pending", startDate: "2026-08-01" }, TODAY))
      .toEqual({ allowed: true });
  });

  it("allows cancelling an approved holiday that has not started", () => {
    expect(canUserCancel({ status: "approved", startDate: "2026-08-26" }, TODAY))
      .toEqual({ allowed: true });
  });

  it("blocks an approved holiday starting today", () => {
    expect(canUserCancel({ status: "approved", startDate: TODAY }, TODAY))
      .toEqual({ allowed: false, reason: "started" });
  });

  it("blocks an approved holiday already under way", () => {
    expect(canUserCancel({ status: "approved", startDate: "2026-08-20" }, TODAY))
      .toEqual({ allowed: false, reason: "started" });
  });

  it("blocks a rejected request", () => {
    expect(canUserCancel({ status: "rejected", startDate: "2026-09-01" }, TODAY))
      .toEqual({ allowed: false, reason: "rejected" });
  });

  it("blocks a request that is already cancelled", () => {
    expect(canUserCancel({ status: "cancelled", startDate: "2026-09-01" }, TODAY))
      .toEqual({ allowed: false, reason: "already_cancelled" });
  });
});
