import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { explain } from "../extension/diagnostics.js";

describe("explain", () => {
  it("returns error tier on provider error", () => {
    const result = explain({
      providerError: "API key expired",
      allowedFolders: ["Finance"],
    });
    assert.equal(result.tier, "error");
    assert.ok(result.reason.includes("API key expired"));
    assert.ok(result.suggestions.length > 0);
  });

  it("returns security-filter tier when skippedReason is set", () => {
    const result = explain({
      skippedReason: "sensitive (password/token/verification)",
      allowedFolders: ["Notifications"],
    });
    assert.equal(result.tier, "security-filter");
    assert.equal(result.folder, "Notifications");
    assert.ok(result.reason.toLowerCase().includes("security"));
  });

  it("returns headers tier when headerFolder provided", () => {
    const result = explain({
      headerFolder: "Newsletters",
      allowedFolders: ["Newsletters", "Finance"],
    });
    assert.equal(result.tier, "headers");
    assert.equal(result.folder, "Newsletters");
    assert.ok(result.reason.length > 0);
  });

  it("returns sender-cache tier when senderCacheFolder provided", () => {
    const result = explain({
      senderCacheFolder: "Finance",
      allowedFolders: ["Finance"],
    });
    assert.equal(result.tier, "sender-cache");
    assert.equal(result.folder, "Finance");
  });

  it("returns llm tier when llmFolder provided", () => {
    const result = explain({
      llmFolder: "Work",
      llmFlags: ["action-required"],
      allowedFolders: ["Work", "Personal"],
    });
    assert.equal(result.tier, "llm");
    assert.equal(result.folder, "Work");
    assert.deepEqual(result.flags, ["action-required"]);
    assert.ok(result.reason.includes("Work"));
    assert.ok(result.reason.includes("action-required"));
  });

  it("returns skipped tier when no folders configured", () => {
    const result = explain({ allowedFolders: [] });
    assert.equal(result.tier, "skipped");
    assert.ok(result.suggestions.length > 0);
  });

  it("falls through to unknown tier when LLM couldn't route", () => {
    const result = explain({ allowedFolders: ["Finance"] });
    assert.equal(result.tier, "unknown");
    assert.ok(result.suggestions.length > 0);
  });

  it("handles null/undefined input", () => {
    const n = explain(null);
    const u = explain(undefined);
    for (const r of [n, u]) {
      assert.ok(typeof r.tier === "string");
      assert.ok(typeof r.reason === "string");
      assert.ok(Array.isArray(r.flags));
      assert.ok(Array.isArray(r.suggestions));
    }
  });

  it("error takes priority over header folder", () => {
    const result = explain({
      providerError: "timeout",
      headerFolder: "Newsletters",
    });
    assert.equal(result.tier, "error");
  });

  it("security-filter takes priority over llm folder", () => {
    const result = explain({
      skippedReason: "sensitive",
      llmFolder: "Work",
    });
    assert.equal(result.tier, "security-filter");
  });

  it("headers tier takes priority over sender cache", () => {
    const result = explain({
      headerFolder: "Newsletters",
      senderCacheFolder: "Finance",
      allowedFolders: ["Newsletters", "Finance"],
    });
    assert.equal(result.tier, "headers");
  });

  it("always returns { tier, folder, flags, reason, suggestions }", () => {
    const cases = [
      { providerError: "err" },
      { skippedReason: "sensitive" },
      { headerFolder: "Finance" },
      { senderCacheFolder: "Finance" },
      { llmFolder: "Finance", llmFlags: [] },
      { allowedFolders: [] },
      {},
    ];
    for (const input of cases) {
      const r = explain(input);
      assert.ok(typeof r.tier === "string");
      assert.ok(typeof r.folder === "string");
      assert.ok(Array.isArray(r.flags));
      assert.ok(typeof r.reason === "string");
      assert.ok(Array.isArray(r.suggestions));
    }
  });
});
