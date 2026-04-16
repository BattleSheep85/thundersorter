import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  filterFolder,
  filterFlags,
  extractFolderAndFlags,
  formatEmail,
  safeParseJSON,
  apiError,
  normalizeSender,
  classifyFromHeaders,
  isSensitiveEmail,
  TAG_PREFIX,
  TAG_COLORS,
  DEFAULT_FOLDERS,
  ATTRIBUTE_FLAGS,
  BATCH_SIZE,
  SKIP_FOLDER_TYPES,
  BUILTIN_PROVIDERS,
  FOLDER_PRESETS,
} from "../extension/common.js";

// --- filterFolder ---

describe("filterFolder", () => {
  it("returns the allowed spelling for a case-insensitive match", () => {
    assert.equal(filterFolder("finance", ["Finance", "Travel"]), "Finance");
    assert.equal(filterFolder("TRAVEL", ["Finance", "Travel"]), "Travel");
  });

  it("returns empty string for unknown folder", () => {
    assert.equal(filterFolder("spam", ["Finance", "Travel"]), "");
  });

  it("returns empty for non-string input", () => {
    assert.equal(filterFolder(null, ["Finance"]), "");
    assert.equal(filterFolder(123, ["Finance"]), "");
    assert.equal(filterFolder("", ["Finance"]), "");
  });

  it("trims whitespace", () => {
    assert.equal(filterFolder("  Finance  ", ["Finance"]), "Finance");
  });
});

// --- filterFlags ---

describe("filterFlags", () => {
  it("keeps only allowed flags", () => {
    assert.deepEqual(filterFlags(["urgent", "foo", "receipt"]), ["urgent", "receipt"]);
  });

  it("lowercases flags", () => {
    assert.deepEqual(filterFlags(["URGENT", "Receipt"]), ["urgent", "receipt"]);
  });

  it("deduplicates", () => {
    assert.deepEqual(filterFlags(["urgent", "URGENT"]), ["urgent"]);
  });

  it("handles string input", () => {
    assert.deepEqual(filterFlags("urgent"), ["urgent"]);
  });

  it("handles non-array, non-string input", () => {
    assert.deepEqual(filterFlags(null), []);
    assert.deepEqual(filterFlags(undefined), []);
    assert.deepEqual(filterFlags(42), []);
  });
});

// --- extractFolderAndFlags ---

describe("extractFolderAndFlags", () => {
  it("extracts folder and flags from canonical shape", () => {
    const { folder, flags } = extractFolderAndFlags({ folder: "Finance", flags: ["urgent"] });
    assert.equal(folder, "Finance");
    assert.deepEqual(flags, ["urgent"]);
  });

  it("accepts 'category' as a folder alias", () => {
    assert.equal(extractFolderAndFlags({ category: "Travel" }).folder, "Travel");
  });

  it("accepts 'tags' as a flags alias", () => {
    assert.deepEqual(extractFolderAndFlags({ folder: "X", tags: ["urgent"] }).flags, ["urgent"]);
  });

  it("returns empty/empty for null or garbage", () => {
    assert.deepEqual(extractFolderAndFlags(null), { folder: "", flags: [] });
    assert.deepEqual(extractFolderAndFlags("bogus"), { folder: "", flags: [] });
  });

  it("coerces a string flag into a one-element array", () => {
    assert.deepEqual(extractFolderAndFlags({ folder: "X", flags: "urgent" }).flags, ["urgent"]);
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
});

// --- safeParseJSON ---

describe("safeParseJSON", () => {
  it("parses valid JSON", () => {
    assert.deepEqual(safeParseJSON('{"folder": "Finance"}'), { folder: "Finance" });
  });

  it("strips markdown code fences", () => {
    assert.deepEqual(
      safeParseJSON('```json\n{"folder": "Travel"}\n```'),
      { folder: "Travel" },
    );
  });

  it("extracts JSON from surrounding text", () => {
    assert.deepEqual(
      safeParseJSON('Here is the result: {"folder": "Work"}'),
      { folder: "Work" },
    );
  });

  it("throws on no JSON at all", () => {
    assert.throws(() => safeParseJSON("not json at all"), SyntaxError);
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
});

// --- classifyFromHeaders ---

describe("classifyFromHeaders", () => {
  it("returns Newsletters for List-Unsubscribe header", () => {
    assert.equal(classifyFromHeaders({ "list-unsubscribe": ["<mailto:unsub@test.com>"] }), "Newsletters");
  });

  it("returns Newsletters for List-Id header", () => {
    assert.equal(classifyFromHeaders({ "list-id": ["<weekly.test.com>"] }), "Newsletters");
  });

  it("returns Newsletters for Precedence: list or bulk", () => {
    assert.equal(classifyFromHeaders({ "precedence": ["list"] }), "Newsletters");
    assert.equal(classifyFromHeaders({ "precedence": ["bulk"] }), "Newsletters");
  });

  it("returns Notifications for X-Auto-Response-Suppress", () => {
    assert.equal(classifyFromHeaders({ "x-auto-response-suppress": ["All"] }), "Notifications");
  });

  it("returns Notifications for noreply sender", () => {
    assert.equal(classifyFromHeaders({ "from": ["noreply@example.com"] }), "Notifications");
  });

  it("returns Notifications for no-reply return path", () => {
    assert.equal(classifyFromHeaders({ "return-path": ["<no-reply@example.com>"] }), "Notifications");
  });

  it("returns empty string for no matching headers", () => {
    assert.equal(classifyFromHeaders({ "subject": ["Hello"], "from": ["alice@test.com"] }), "");
  });

  it("prefers Newsletters over Notifications when both signals present", () => {
    assert.equal(
      classifyFromHeaders({
        "list-unsubscribe": ["<mailto:unsub@test.com>"],
        "from": ["noreply@test.com"],
      }),
      "Newsletters",
    );
  });
});

// --- Constants ---

describe("constants", () => {
  it("TAG_PREFIX is a non-empty string", () => {
    assert.equal(typeof TAG_PREFIX, "string");
    assert.ok(TAG_PREFIX.length > 0);
  });

  it("every ATTRIBUTE_FLAG has a color in TAG_COLORS", () => {
    for (const flag of ATTRIBUTE_FLAGS) {
      assert.ok(TAG_COLORS[flag], `${flag} has no color in TAG_COLORS`);
    }
  });

  it("ATTRIBUTE_FLAGS has the expected short set", () => {
    assert.ok(ATTRIBUTE_FLAGS.includes("urgent"));
    assert.ok(ATTRIBUTE_FLAGS.includes("action-required"));
    assert.ok(ATTRIBUTE_FLAGS.includes("receipt"));
    assert.ok(ATTRIBUTE_FLAGS.length <= 5, "flag set should stay minimal");
  });

  it("BATCH_SIZE is a positive integer", () => {
    assert.ok(Number.isInteger(BATCH_SIZE));
    assert.ok(BATCH_SIZE > 0);
  });

  it("all BUILTIN_PROVIDERS have required fields", () => {
    for (const [key, info] of Object.entries(BUILTIN_PROVIDERS)) {
      assert.ok(info.label, `${key} missing label`);
      assert.ok(info.kind, `${key} missing kind`);
      assert.ok(["gemini", "openai", "anthropic"].includes(info.kind));
    }
  });

  it("SKIP_FOLDER_TYPES includes sent, drafts, trash, junk", () => {
    for (const type of ["sent", "drafts", "trash", "junk"]) {
      assert.ok(SKIP_FOLDER_TYPES.includes(type));
    }
  });
});

// --- FOLDER_PRESETS ---

describe("FOLDER_PRESETS", () => {
  it("has home, business, and minimal presets", () => {
    assert.ok(FOLDER_PRESETS.home);
    assert.ok(FOLDER_PRESETS.business);
    assert.ok(FOLDER_PRESETS.minimal);
  });

  it("each preset has a label and folders array", () => {
    for (const [key, preset] of Object.entries(FOLDER_PRESETS)) {
      assert.ok(typeof preset.label === "string", `${key} missing label`);
      assert.ok(Array.isArray(preset.folders), `${key} folders is not an array`);
      assert.ok(preset.folders.length > 0, `${key} has empty folders`);
    }
  });

  it("every preset includes Notifications", () => {
    for (const [key, preset] of Object.entries(FOLDER_PRESETS)) {
      assert.ok(preset.folders.includes("Notifications"), `${key} missing Notifications folder`);
    }
  });

  it("folder names are capitalized single words", () => {
    for (const [key, preset] of Object.entries(FOLDER_PRESETS)) {
      for (const f of preset.folders) {
        assert.ok(/^[A-Z][A-Za-z-]*$/.test(f), `${key}/${f} is not a capitalized word`);
      }
    }
  });

  it("DEFAULT_FOLDERS equals home preset folders", () => {
    assert.deepEqual(DEFAULT_FOLDERS, FOLDER_PRESETS.home.folders);
  });
});

// --- isSensitiveEmail ---

describe("isSensitiveEmail", () => {
  it("flags password reset subjects", () => {
    assert.ok(isSensitiveEmail("Reset your password", ""));
    assert.ok(isSensitiveEmail("Password Reset Request", ""));
  });

  it("flags verification code subjects", () => {
    assert.ok(isSensitiveEmail("Your verification code", ""));
    assert.ok(isSensitiveEmail("Verify your email address", ""));
  });

  it("flags 2FA / OTP / MFA subjects", () => {
    assert.ok(isSensitiveEmail("Your two-factor code", ""));
    assert.ok(isSensitiveEmail("2FA code for your account", ""));
    assert.ok(isSensitiveEmail("One-time password", ""));
    assert.ok(isSensitiveEmail("Multi-factor authentication", ""));
  });

  it("flags security alert / suspicious activity", () => {
    assert.ok(isSensitiveEmail("Security alert: new login", ""));
    assert.ok(isSensitiveEmail("Suspicious activity detected", ""));
  });

  it("flags magic link / access code", () => {
    assert.ok(isSensitiveEmail("Your magic link", ""));
    assert.ok(isSensitiveEmail("Your access code", ""));
    assert.ok(isSensitiveEmail("Account recovery", ""));
  });

  it("flags sensitive body content even with safe subject", () => {
    assert.ok(isSensitiveEmail("Welcome!", "Your verification code: 123456"));
    assert.ok(isSensitiveEmail("Hello", "Use this code: ABC123 to continue"));
  });

  it("allows normal emails through", () => {
    assert.ok(!isSensitiveEmail("Invoice #1234", "Your order total is $50"));
    assert.ok(!isSensitiveEmail("Weekly newsletter", "Top stories this week"));
    assert.ok(!isSensitiveEmail("Meeting tomorrow", "Let's sync at 3pm"));
  });

  it("handles null/empty inputs", () => {
    assert.ok(!isSensitiveEmail(null, null));
    assert.ok(!isSensitiveEmail("", ""));
    assert.ok(!isSensitiveEmail(undefined, undefined));
  });
});
