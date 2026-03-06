import { describe, it, expect } from "vitest";
import { t } from "../t.js";

describe("i18n", () => {
  it("returns English text by default", () => {
    expect(t("balance.title", "en")).toBe("Holiday Balance");
  });

  it("returns German text when language is de", () => {
    expect(t("balance.title", "de")).toBe("Urlaubskonto");
  });

  it("supports interpolation", () => {
    expect(t("balance.remaining", "en", { days: "15" })).toBe("You have 15 days remaining");
  });

  it("falls back to English for missing German keys", () => {
    expect(t("__test_only_en__", "de")).toBe(t("__test_only_en__", "en"));
  });

  it("returns the key itself if not found in any language", () => {
    expect(t("nonexistent.key", "en")).toBe("nonexistent.key");
  });
});
