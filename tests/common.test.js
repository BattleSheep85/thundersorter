import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  filterTags,
  formatEmail,
  safeParseJSON,
  apiError,
  normalizeSender,
  classifyFromHeaders,
  TAG_PREFIX,
  TAG_COLORS,
  DEFAULT_TAGS,
  BATCH_SIZE,
  SKIP_FOLDER_TYPES,
  BUILTIN_PROVIDERS,
} from "../extension/common.js";

// --- filterTags ---

describe("filterTags", () => {
  it("returns only tags in the allowed list", () => {
    assert.deepEqual(
      filterTags(["finance", "spam", "travel"], ["finance", "travel", "work"]),
      ["finance", "travel"],
    );
  });

  it("returns empty array when no tags match", () => {
    assert.deepEqual(filterTags(["unknown", "bogus"], ["finance", "work"]), []);
  });

  it("handles empty input", () => {
    assert.deepEqual(filterTags([], ["finance"]), []);
  });

  it("handles empty allowed list", () => {
    assert.deepEqual(filterTags(["finance"], []), []);
  });
});

// --- formatEmail ---

describe("formatEmail", () => {
  it("formats email with subject, sender, and body", () => {
    const result = formatEmail("Test Subject", "alice@test.com", "Hello world");
    assert.equal(result, "Subject: Test Subject\nFrom: alice@test.com\n\nHello world");
  });

  it("truncates body to 4000 characters", () => {
    const longBody = "x".repeat(10000);
    const result = formatEmail("S", "F", longBody);
    assert.ok(result.length <= 4000 + "Subject: S\nFrom: F\n\n".length);
    assert.ok(result.endsWith("x".repeat(4000)));
  });

  it("handles empty fields", () => {
    const result = formatEmail("", "", "");
    assert.equal(result, "Subject: \nFrom: \n\n");
  });
});

// --- safeParseJSON ---

describe("safeParseJSON", () => {
  it("parses valid JSON", () => {
    assert.deepEqual(safeParseJSON('{"tags": ["finance"]}'), { tags: ["finance"] });
  });

  it("strips markdown code fences", () => {
    assert.deepEqual(
      safeParseJSON('```json\n{"tags": ["travel"]}\n```'),
      { tags: ["travel"] },
    );
  });

  it("strips code fences without language tag", () => {
    assert.deepEqual(
      safeParseJSON('```\n{"tags": ["work"]}\n```'),
      { tags: ["work"] },
    );
  });

  it("handles whitespace around JSON", () => {
    assert.deepEqual(
      safeParseJSON('  \n {"tags": []}  \n '),
      { tags: [] },
    );
  });

  it("throws on invalid JSON", () => {
    assert.throws(() => safeParseJSON("not json at all"), SyntaxError);
  });

  it("throws on empty string", () => {
    assert.throws(() => safeParseJSON(""), SyntaxError);
  });
});

// --- apiError ---

describe("apiError", () => {
  it("formats status and body", () => {
    assert.equal(apiError(401, "Unauthorized"), "API error (401): Unauthorized");
  });

  it("truncates long bodies to 200 characters", () => {
    const longBody = "a".repeat(500);
    const result = apiError(500, longBody);
    assert.ok(result.length <= "API error (500): ".length + 200);
    assert.ok(result.includes("a".repeat(200)));
    assert.ok(!result.includes("a".repeat(201)));
  });

  it("handles empty body", () => {
    assert.equal(apiError(404, ""), "API error (404): ");
  });

  it("handles null/undefined body", () => {
    assert.equal(apiError(500, null), "API error (500): ");
    assert.equal(apiError(500, undefined), "API error (500): ");
  });
});

// --- normalizeSender ---

describe("normalizeSender", () => {
  it("extracts email from angle bracket format", () => {
    assert.equal(normalizeSender("John Doe <john@example.com>"), "john@example.com");
  });

  it("lowercases the result", () => {
    assert.equal(normalizeSender("Alice <ALICE@EXAMPLE.COM>"), "alice@example.com");
  });

  it("handles plain email without brackets", () => {
    assert.equal(normalizeSender("bob@test.com"), "bob@test.com");
  });

  it("trims whitespace", () => {
    assert.equal(normalizeSender("  carol@test.com  "), "carol@test.com");
  });

  it("handles empty string", () => {
    assert.equal(normalizeSender(""), "");
  });
});

// --- classifyFromHeaders ---

describe("classifyFromHeaders", () => {
  it("returns newsletters for List-Unsubscribe header", () => {
    const tags = classifyFromHeaders({ "list-unsubscribe": ["<mailto:unsub@test.com>"] });
    assert.deepEqual(tags, ["newsletters"]);
  });

  it("returns newsletters for List-Id header", () => {
    const tags = classifyFromHeaders({ "list-id": ["<weekly.test.com>"] });
    assert.deepEqual(tags, ["newsletters"]);
  });

  it("returns newsletters for Precedence: list", () => {
    const tags = classifyFromHeaders({ "precedence": ["list"] });
    assert.deepEqual(tags, ["newsletters"]);
  });

  it("returns promotions for Precedence: bulk", () => {
    const tags = classifyFromHeaders({ "precedence": ["bulk"] });
    assert.deepEqual(tags, ["promotions"]);
  });

  it("returns promotions for Precedence: junk", () => {
    const tags = classifyFromHeaders({ "precedence": ["junk"] });
    assert.deepEqual(tags, ["promotions"]);
  });

  it("returns notifications for X-Auto-Response-Suppress", () => {
    const tags = classifyFromHeaders({ "x-auto-response-suppress": ["All"] });
    assert.deepEqual(tags, ["notifications"]);
  });

  it("returns notifications for noreply sender", () => {
    const tags = classifyFromHeaders({ "from": ["noreply@example.com"] });
    assert.deepEqual(tags, ["notifications"]);
  });

  it("returns notifications for no-reply return path", () => {
    const tags = classifyFromHeaders({ "return-path": ["<no-reply@example.com>"] });
    assert.deepEqual(tags, ["notifications"]);
  });

  it("does not double-tag noreply sender that is also a newsletter", () => {
    const tags = classifyFromHeaders({
      "list-unsubscribe": ["<mailto:unsub@test.com>"],
      "from": ["noreply@test.com"],
    });
    assert.deepEqual(tags, ["newsletters"]);
  });

  it("returns empty array for no matching headers", () => {
    const tags = classifyFromHeaders({ "subject": ["Hello"], "from": ["alice@test.com"] });
    assert.deepEqual(tags, []);
  });

  it("returns empty array for empty headers", () => {
    assert.deepEqual(classifyFromHeaders({}), []);
  });

  it("deduplicates tags", () => {
    const tags = classifyFromHeaders({
      "precedence": ["bulk"],
      "x-auto-response-suppress": ["All"],
    });
    assert.ok(tags.includes("promotions"));
    assert.ok(tags.includes("notifications"));
    assert.equal(new Set(tags).size, tags.length);
  });
});

// --- Constants ---

describe("constants", () => {
  it("TAG_PREFIX is a non-empty string", () => {
    assert.equal(typeof TAG_PREFIX, "string");
    assert.ok(TAG_PREFIX.length > 0);
  });

  it("DEFAULT_TAGS matches TAG_COLORS keys", () => {
    assert.deepEqual(DEFAULT_TAGS, Object.keys(TAG_COLORS));
  });

  it("BATCH_SIZE is a positive integer", () => {
    assert.ok(Number.isInteger(BATCH_SIZE));
    assert.ok(BATCH_SIZE > 0);
  });

  it("all BUILTIN_PROVIDERS have required fields", () => {
    for (const [key, info] of Object.entries(BUILTIN_PROVIDERS)) {
      assert.ok(info.label, `${key} missing label`);
      assert.ok(info.kind, `${key} missing kind`);
      assert.ok(
        ["gemini", "openai", "anthropic"].includes(info.kind),
        `${key} has unknown kind: ${info.kind}`,
      );
    }
  });

  it("all non-local providers use HTTPS base URLs", () => {
    for (const [key, info] of Object.entries(BUILTIN_PROVIDERS)) {
      if (info.baseUrl && !info.baseUrl.startsWith("http://localhost")) {
        assert.ok(
          info.baseUrl.startsWith("https://"),
          `${key} baseUrl is not HTTPS: ${info.baseUrl}`,
        );
      }
    }
  });

  it("Ollama is marked noKey", () => {
    assert.equal(BUILTIN_PROVIDERS.ollama.noKey, true);
  });

  it("Fireworks has a modelsUrl for native API", () => {
    assert.ok(BUILTIN_PROVIDERS.fireworks.modelsUrl);
    assert.ok(BUILTIN_PROVIDERS.fireworks.modelsUrl.includes("accounts/fireworks/models"));
  });

  it("SKIP_FOLDER_TYPES includes sent, drafts, trash, junk", () => {
    for (const type of ["sent", "drafts", "trash", "junk"]) {
      assert.ok(SKIP_FOLDER_TYPES.includes(type), `missing: ${type}`);
    }
  });
});
