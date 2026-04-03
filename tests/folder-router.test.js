import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  resolveFolder,
  generateFolderName,
  buildDefaultMapping,
} from "../extension/folder-router.js";

// --- resolveFolder ---

describe("resolveFolder", () => {
  const mapping = {
    finance: "/Inbox/Finance",
    newsletters: "/Inbox/Newsletters",
    work: "/Inbox/Work",
  };
  const priority = ["work", "finance", "newsletters"];

  it("returns folder for highest-priority matching tag", () => {
    assert.equal(resolveFolder(["finance", "work"], mapping, priority), "/Inbox/Work");
  });

  it("returns folder for single matching tag", () => {
    assert.equal(resolveFolder(["newsletters"], mapping, priority), "/Inbox/Newsletters");
  });

  it("returns null for empty tags", () => {
    assert.equal(resolveFolder([], mapping, priority), null);
  });

  it("returns null for null tags", () => {
    assert.equal(resolveFolder(null, mapping, priority), null);
  });

  it("returns null for empty mapping", () => {
    assert.equal(resolveFolder(["finance"], {}, priority), null);
  });

  it("returns null for null mapping", () => {
    assert.equal(resolveFolder(["finance"], null, priority), null);
  });

  it("falls back to tag order when no priority list", () => {
    assert.equal(resolveFolder(["newsletters", "finance"], mapping, []), "/Inbox/Newsletters");
  });

  it("falls back to tag order when priority is null", () => {
    assert.equal(resolveFolder(["finance", "newsletters"], mapping, null), "/Inbox/Finance");
  });

  it("returns null when tags don't match any mapping", () => {
    assert.equal(resolveFolder(["social", "travel"], mapping, priority), null);
  });

  it("is case-insensitive for tag matching", () => {
    assert.equal(resolveFolder(["Finance"], mapping, priority), "/Inbox/Finance");
  });

  it("skips priority tags not in the message's tags", () => {
    // priority: work > finance > newsletters, but message only has newsletters
    assert.equal(resolveFolder(["newsletters"], mapping, priority), "/Inbox/Newsletters");
  });
});

// --- generateFolderName ---

describe("generateFolderName", () => {
  it("capitalizes tag for home mode", () => {
    assert.equal(generateFolderName("finance", "home"), "Finance");
  });

  it("adds Sorted/ prefix for business mode", () => {
    assert.equal(generateFolderName("finance", "business"), "Sorted/Finance");
  });

  it("defaults to home mode", () => {
    assert.equal(generateFolderName("newsletters"), "Newsletters");
  });

  it("handles hyphenated tags", () => {
    assert.equal(generateFolderName("action-required", "home"), "Action-required");
  });

  it("handles single character tag", () => {
    assert.equal(generateFolderName("x", "home"), "X");
  });
});

// --- buildDefaultMapping ---

describe("buildDefaultMapping", () => {
  it("creates mapping for all tags in home mode", () => {
    const mapping = buildDefaultMapping(["finance", "newsletters"], "home");
    assert.deepEqual(mapping, {
      finance: "Finance",
      newsletters: "Newsletters",
    });
  });

  it("creates mapping for all tags in business mode", () => {
    const mapping = buildDefaultMapping(["finance", "newsletters"], "business");
    assert.deepEqual(mapping, {
      finance: "Sorted/Finance",
      newsletters: "Sorted/Newsletters",
    });
  });

  it("handles empty tags array", () => {
    const mapping = buildDefaultMapping([], "home");
    assert.deepEqual(mapping, {});
  });

  it("defaults to home mode", () => {
    const mapping = buildDefaultMapping(["work"]);
    assert.deepEqual(mapping, { work: "Work" });
  });
});
