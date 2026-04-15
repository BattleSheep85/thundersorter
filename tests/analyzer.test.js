import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildSample,
  buildAnalysisPrompt,
  parseTagSuggestions,
  buildRefinementPrompt,
  diagnoseEmptyTags,
} from "../extension/analyzer.js";

// --- buildSample ---

describe("buildSample", () => {
  it("returns empty array for empty messages", () => {
    assert.deepEqual(buildSample([]), []);
    assert.deepEqual(buildSample(null), []);
    assert.deepEqual(buildSample(undefined), []);
  });

  it("returns samples with subject and sender", () => {
    const messages = [
      { author: "alice@test.com", subject: "Hello", date: "2024-01-01" },
      { author: "bob@work.com", subject: "Meeting", date: "2024-01-02" },
    ];
    const result = buildSample(messages, 10);
    assert.ok(result.length === 2);
    assert.ok(result[0].subject);
    assert.ok(result[0].sender);
  });

  it("limits to targetSize", () => {
    const messages = Array.from({ length: 200 }, (_, i) => ({
      author: `user${i}@domain${i % 50}.com`,
      subject: `Subject ${i}`,
      date: new Date(2024, 0, i + 1).toISOString(),
    }));
    const result = buildSample(messages, 75);
    assert.ok(result.length <= 75);
  });

  it("includes messages from different domains", () => {
    const messages = [
      ...Array.from({ length: 50 }, (_, i) => ({
        author: `user${i}@gmail.com`,
        subject: `Gmail ${i}`,
        date: new Date(2024, 0, i + 1).toISOString(),
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        author: `user${i}@raredomain.com`,
        subject: `Rare ${i}`,
        date: new Date(2024, 0, i + 1).toISOString(),
      })),
    ];
    const result = buildSample(messages, 20);
    const senders = result.map((s) => s.sender);
    const hasRare = senders.some((s) => s.includes("raredomain.com"));
    assert.ok(hasRare, "should include messages from rare domains");
  });

  it("handles messages without dates", () => {
    const messages = [
      { author: "alice@test.com", subject: "No date" },
      { author: "bob@test.com", subject: "Also no date" },
    ];
    const result = buildSample(messages, 10);
    assert.ok(result.length > 0);
  });

  it("handles messages without author", () => {
    const messages = [
      { subject: "No author", date: "2024-01-01" },
    ];
    const result = buildSample(messages, 10);
    assert.ok(result.length > 0);
    assert.equal(result[0].sender, "");
  });
});

// --- buildAnalysisPrompt ---

describe("buildAnalysisPrompt", () => {
  const samples = [
    { subject: "Invoice #123", sender: "billing@shop.com" },
    { subject: "Weekly Newsletter", sender: "news@blog.com" },
  ];

  it("includes all sample subjects", () => {
    const prompt = buildAnalysisPrompt(samples, "home", 10);
    assert.ok(prompt.includes("Invoice #123"));
    assert.ok(prompt.includes("Weekly Newsletter"));
  });

  it("includes sender addresses", () => {
    const prompt = buildAnalysisPrompt(samples, "home");
    assert.ok(prompt.includes("billing@shop.com"));
    assert.ok(prompt.includes("news@blog.com"));
  });

  it("requests JSON response format", () => {
    const prompt = buildAnalysisPrompt(samples, "home");
    assert.ok(prompt.includes("JSON"));
    assert.ok(prompt.includes('"tags"'));
  });

  it("mentions business context for business preset", () => {
    const prompt = buildAnalysisPrompt(samples, "business");
    assert.ok(prompt.toLowerCase().includes("work") || prompt.toLowerCase().includes("business"));
  });

  it("mentions minimal for minimal preset", () => {
    const prompt = buildAnalysisPrompt(samples, "minimal");
    assert.ok(prompt.toLowerCase().includes("few") || prompt.toLowerCase().includes("broad"));
  });

  it("includes target count", () => {
    const prompt = buildAnalysisPrompt(samples, "home", 8);
    assert.ok(prompt.includes("8"));
  });

  it("enforces single/double word tag rule", () => {
    const prompt = buildAnalysisPrompt(samples, "home");
    assert.ok(prompt.includes("ONE word") || prompt.includes("one word") || prompt.includes("two words"));
  });
});

// --- parseTagSuggestions ---

describe("parseTagSuggestions", () => {
  it("parses valid JSON with tags array", () => {
    assert.deepEqual(
      parseTagSuggestions('{"tags": ["finance", "newsletters"]}'),
      ["finance", "newsletters"],
    );
  });

  it("strips markdown code fences", () => {
    assert.deepEqual(
      parseTagSuggestions('```json\n{"tags": ["work"]}\n```'),
      ["work"],
    );
  });

  it("handles suggestions key", () => {
    assert.deepEqual(
      parseTagSuggestions('{"suggestions": ["travel", "social"]}'),
      ["travel", "social"],
    );
  });

  it("handles categories key", () => {
    assert.deepEqual(
      parseTagSuggestions('{"categories": ["health"]}'),
      ["health"],
    );
  });

  it("normalizes to lowercase", () => {
    assert.deepEqual(
      parseTagSuggestions('{"tags": ["Finance", "WORK"]}'),
      ["finance", "work"],
    );
  });

  it("strips invalid characters", () => {
    assert.deepEqual(
      parseTagSuggestions('{"tags": ["fin@nce!", "wo rk"]}'),
      ["finnce", "work"],
    );
  });

  it("filters out empty strings", () => {
    assert.deepEqual(
      parseTagSuggestions('{"tags": ["finance", "", "  "]}'),
      ["finance"],
    );
  });

  it("filters out very long strings", () => {
    const longTag = "a".repeat(50);
    assert.deepEqual(
      parseTagSuggestions(`{"tags": ["finance", "${longTag}"]}`),
      ["finance"],
    );
  });

  it("returns empty array for invalid input", () => {
    assert.deepEqual(parseTagSuggestions("not json at all"), []);
  });

  it("extracts JSON from surrounding text", () => {
    assert.deepEqual(
      parseTagSuggestions('Here are my suggestions: {"tags": ["finance"]} Hope this helps!'),
      ["finance"],
    );
  });
});

// --- diagnoseEmptyTags ---

describe("diagnoseEmptyTags", () => {
  it("flags an empty response", () => {
    assert.match(diagnoseEmptyTags(""), /empty response/);
    assert.match(diagnoseEmptyTags("   "), /empty response/);
  });

  it("flags non-JSON responses with a preview", () => {
    const reason = diagnoseEmptyTags("I cannot help with that.");
    assert.match(reason, /didn't return JSON/);
    assert.match(reason, /I cannot help/);
  });

  it("flags JSON missing a tags field", () => {
    const reason = diagnoseEmptyTags('{"foo": 1, "bar": 2}');
    assert.match(reason, /no "tags" field/);
    assert.match(reason, /foo/);
  });

  it("flags an empty tag list", () => {
    assert.match(diagnoseEmptyTags('{"tags": []}'), /empty tag list/);
  });

  it("flags tags-not-a-list", () => {
    assert.match(diagnoseEmptyTags('{"tags": "finance"}'), /wasn't a list/);
  });

  it("flags all-invalid tags", () => {
    assert.match(diagnoseEmptyTags('{"tags": ["", "  "]}'), /all invalid/);
  });

  it("strips markdown fences before parsing", () => {
    assert.match(diagnoseEmptyTags('```json\n{"tags": []}\n```'), /empty tag list/);
  });
});

// --- buildRefinementPrompt ---

describe("buildRefinementPrompt", () => {
  const currentTags = ["finance", "newsletters"];
  const samples = [
    { subject: "Invoice", sender: "billing@shop.com" },
  ];

  it("includes current tags", () => {
    const prompt = buildRefinementPrompt(currentTags, "add a health tag", samples);
    assert.ok(prompt.includes("finance"));
    assert.ok(prompt.includes("newsletters"));
  });

  it("includes user request", () => {
    const prompt = buildRefinementPrompt(currentTags, "add a health tag", samples);
    assert.ok(prompt.includes("add a health tag"));
  });

  it("includes sample emails", () => {
    const prompt = buildRefinementPrompt(currentTags, "add tags", samples);
    assert.ok(prompt.includes("Invoice"));
    assert.ok(prompt.includes("billing@shop.com"));
  });

  it("requests JSON response", () => {
    const prompt = buildRefinementPrompt(currentTags, "adjust", samples);
    assert.ok(prompt.includes("JSON"));
    assert.ok(prompt.includes('"tags"'));
  });

  it("asks for complete tag list", () => {
    const prompt = buildRefinementPrompt(currentTags, "adjust", samples);
    assert.ok(prompt.toLowerCase().includes("complete") || prompt.toLowerCase().includes("updated"));
  });

  it("limits sample count in prompt", () => {
    const manySamples = Array.from({ length: 100 }, (_, i) => ({
      subject: `Email ${i}`,
      sender: `user${i}@test.com`,
    }));
    const prompt = buildRefinementPrompt(currentTags, "adjust", manySamples);
    // Should only include first 30
    assert.ok(prompt.includes("Email 29"));
    assert.ok(!prompt.includes("Email 30"));
  });
});
