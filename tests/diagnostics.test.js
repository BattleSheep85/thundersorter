import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { explain } from "../extension/diagnostics.js";

// --- explain() ---

describe("explain", () => {
  // --- Already tagged ---

  it("returns already-tagged tier when existingTags is non-empty", () => {
    const result = explain({
      existingTags: ["finance", "receipts"],
      allowedTags: ["finance", "receipts"],
    });
    assert.equal(result.tier, "already-tagged");
    assert.deepEqual(result.tags, ["finance", "receipts"]);
    assert.ok(result.reason.includes("finance"));
    assert.ok(result.reason.includes("receipts"));
    assert.deepEqual(result.suggestions, []);
  });

  // --- Provider error ---

  it("returns error tier on provider error", () => {
    const result = explain({
      providerError: "API key expired",
      allowedTags: ["finance"],
    });
    assert.equal(result.tier, "error");
    assert.deepEqual(result.tags, []);
    assert.ok(result.reason.includes("API key expired"));
    assert.ok(result.suggestions.length > 0);
  });

  it("error tier suggests checking settings", () => {
    const result = explain({ providerError: "timeout" });
    const allSuggestions = result.suggestions.join(" ");
    assert.ok(allSuggestions.toLowerCase().includes("settings") || allSuggestions.toLowerCase().includes("provider"));
  });

  // --- Skipped (no provider) ---

  it("returns skipped tier when no data available", () => {
    const result = explain({
      headers: null,
      senderCacheEntry: null,
      llmResult: null,
      allowedTags: ["finance"],
    });
    assert.equal(result.tier, "skipped");
    assert.deepEqual(result.tags, []);
    assert.ok(result.suggestions.length > 0);
  });

  it("skipped tier suggests setting up a provider", () => {
    const result = explain({});
    assert.equal(result.tier, "skipped");
    const allSuggestions = result.suggestions.join(" ");
    assert.ok(allSuggestions.toLowerCase().includes("settings") || allSuggestions.toLowerCase().includes("provider"));
  });

  // --- LLM returned unmatched tags ---

  it("returns llm tier when tags do not match allowed list", () => {
    const result = explain({
      headers: {},
      llmResult: ["invoices", "billing"],
      allowedTags: ["finance", "work"],
    });
    assert.equal(result.tier, "llm");
    assert.deepEqual(result.tags, []);
    assert.ok(result.reason.includes("invoices"));
    assert.ok(result.suggestions.length > 0);
  });

  it("suggests adding the first unmatched tag", () => {
    const result = explain({
      headers: {},
      llmResult: ["receipts"],
      allowedTags: ["finance"],
    });
    const allSuggestions = result.suggestions.join(" ");
    assert.ok(allSuggestions.includes("receipts"));
  });

  // --- LLM returned empty ---

  it("returns llm tier when LLM returned empty array", () => {
    const result = explain({
      headers: {},
      llmResult: [],
      allowedTags: ["finance", "work"],
    });
    assert.equal(result.tier, "llm");
    assert.deepEqual(result.tags, []);
    assert.ok(result.reason.includes("could not"));
    assert.ok(result.suggestions.length > 0);
  });

  // --- Headers tier ---

  it("returns headers tier when headerTags provided", () => {
    const result = explain({
      headers: { "list-unsubscribe": ["<mailto:unsub@test.com>"] },
      headerTags: ["newsletters"],
      allowedTags: ["newsletters", "finance"],
    });
    assert.equal(result.tier, "headers");
    assert.deepEqual(result.tags, ["newsletters"]);
    assert.ok(result.reason.length > 0);
  });

  // --- Sender cache tier ---

  it("returns sender-cache tier when senderCacheTags provided", () => {
    const result = explain({
      headers: {},
      senderCacheTags: ["finance"],
      allowedTags: ["finance"],
    });
    assert.equal(result.tier, "sender-cache");
    assert.deepEqual(result.tags, ["finance"]);
    assert.ok(result.reason.length > 0);
  });

  // --- LLM success tier ---

  it("returns llm tier when llmTags provided", () => {
    const result = explain({
      headers: {},
      llmTags: ["work", "finance"],
      allowedTags: ["work", "finance"],
    });
    assert.equal(result.tier, "llm");
    assert.deepEqual(result.tags, ["work", "finance"]);
    assert.ok(result.reason.length > 0);
  });

  // --- Null/undefined handling ---

  it("handles null input", () => {
    const result = explain(null);
    assert.ok(result.tier);
    assert.ok(Array.isArray(result.tags));
    assert.ok(typeof result.reason === "string");
    assert.ok(Array.isArray(result.suggestions));
  });

  it("handles undefined input", () => {
    const result = explain(undefined);
    assert.ok(result.tier);
    assert.ok(Array.isArray(result.tags));
  });

  it("handles empty object", () => {
    const result = explain({});
    assert.ok(result.tier);
    assert.ok(Array.isArray(result.tags));
  });

  // --- Priority: existing tags > error > skipped > header > sender-cache > llm ---

  it("already-tagged takes priority over error", () => {
    const result = explain({
      existingTags: ["finance"],
      providerError: "timeout",
    });
    assert.equal(result.tier, "already-tagged");
  });

  it("error takes priority over header tags", () => {
    const result = explain({
      providerError: "timeout",
      headerTags: ["newsletters"],
    });
    assert.equal(result.tier, "error");
  });

  it("headers tier takes priority over sender cache", () => {
    const result = explain({
      headers: {},
      headerTags: ["newsletters"],
      senderCacheTags: ["promotions"],
      allowedTags: ["newsletters", "promotions"],
    });
    assert.equal(result.tier, "headers");
    assert.deepEqual(result.tags, ["newsletters"]);
  });

  it("sender cache tier takes priority over llm", () => {
    const result = explain({
      headers: {},
      senderCacheTags: ["finance"],
      llmTags: ["work"],
      allowedTags: ["finance", "work"],
    });
    assert.equal(result.tier, "sender-cache");
    assert.deepEqual(result.tags, ["finance"]);
  });

  // --- Return shape ---

  it("always returns { tier, tags, reason, suggestions }", () => {
    const cases = [
      { existingTags: ["x"] },
      { providerError: "err" },
      {},
      { headers: {}, llmResult: ["x"], allowedTags: ["y"] },
      { headers: {}, llmResult: [], allowedTags: ["y"] },
      { headers: {}, headerTags: ["x"], allowedTags: ["x"] },
    ];
    for (const input of cases) {
      const result = explain(input);
      assert.ok(typeof result.tier === "string", `tier should be string, got ${typeof result.tier}`);
      assert.ok(Array.isArray(result.tags), "tags should be array");
      assert.ok(typeof result.reason === "string", "reason should be string");
      assert.ok(Array.isArray(result.suggestions), "suggestions should be array");
    }
  });
});
