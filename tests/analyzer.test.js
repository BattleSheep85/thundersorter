import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildSample,
  buildAnalysisPrompt,
  parseFolderSuggestions,
  buildRefinementPrompt,
  diagnoseEmptyFolders,
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

  it("excludes security-sensitive emails from samples", () => {
    const messages = [
      { author: "noreply@shop.com", subject: "Your verification code", date: "2024-01-01" },
      { author: "billing@shop.com", subject: "Invoice #100", date: "2024-01-02" },
      { author: "security@bank.com", subject: "Password Reset Request", date: "2024-01-03" },
    ];
    const result = buildSample(messages, 10);
    const subjects = result.map((s) => s.subject);
    assert.ok(subjects.includes("Invoice #100"));
    assert.ok(!subjects.some((s) => /verification|password/i.test(s)));
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
    const prompt = buildAnalysisPrompt(samples, "home", 6);
    assert.ok(prompt.includes("Invoice #123"));
    assert.ok(prompt.includes("Weekly Newsletter"));
  });

  it("includes sender addresses", () => {
    const prompt = buildAnalysisPrompt(samples, "home");
    assert.ok(prompt.includes("billing@shop.com"));
    assert.ok(prompt.includes("news@blog.com"));
  });

  it("requests JSON response with folders key", () => {
    const prompt = buildAnalysisPrompt(samples, "home");
    assert.ok(prompt.includes("JSON"));
    assert.ok(prompt.includes('"folders"'));
  });

  it("mentions business context for business preset", () => {
    const prompt = buildAnalysisPrompt(samples, "business");
    assert.ok(prompt.toLowerCase().includes("work") || prompt.toLowerCase().includes("business"));
  });

  it("includes target count", () => {
    const prompt = buildAnalysisPrompt(samples, "home", 5);
    assert.ok(prompt.includes("5"));
  });

  it("requires Notifications folder and capitalized names", () => {
    const prompt = buildAnalysisPrompt(samples, "home");
    assert.ok(prompt.includes("Notifications"));
    assert.ok(prompt.toLowerCase().includes("capitalized"));
  });
});

// --- parseFolderSuggestions ---

describe("parseFolderSuggestions", () => {
  it("parses valid JSON with folders array", () => {
    assert.deepEqual(
      parseFolderSuggestions('{"folders": ["Finance", "Newsletters"]}'),
      ["Finance", "Newsletters"],
    );
  });

  it("strips markdown code fences", () => {
    assert.deepEqual(
      parseFolderSuggestions('```json\n{"folders": ["Work"]}\n```'),
      ["Work"],
    );
  });

  it("accepts tags / suggestions / categories as aliases", () => {
    assert.deepEqual(parseFolderSuggestions('{"tags": ["Travel"]}'), ["Travel"]);
    assert.deepEqual(parseFolderSuggestions('{"suggestions": ["Health"]}'), ["Health"]);
    assert.deepEqual(parseFolderSuggestions('{"categories": ["Family"]}'), ["Family"]);
  });

  it("titlecases folder names", () => {
    assert.deepEqual(
      parseFolderSuggestions('{"folders": ["finance", "WORK"]}'),
      ["Finance", "Work"],
    );
  });

  it("strips invalid characters but keeps dashes", () => {
    assert.deepEqual(
      parseFolderSuggestions('{"folders": ["Fin@nce!", "Follow-up"]}'),
      ["Finnce", "Follow-up"],
    );
  });

  it("filters out empty strings", () => {
    assert.deepEqual(
      parseFolderSuggestions('{"folders": ["Finance", "", "  "]}'),
      ["Finance"],
    );
  });

  it("truncates very long folder names to 30 chars", () => {
    const longName = "A".repeat(50);
    const result = parseFolderSuggestions(`{"folders": ["${longName}"]}`);
    assert.equal(result[0].length, 30);
  });

  it("returns empty array for invalid input", () => {
    assert.deepEqual(parseFolderSuggestions("not json at all"), []);
  });

  it("extracts JSON from surrounding text", () => {
    assert.deepEqual(
      parseFolderSuggestions('Here you go: {"folders": ["Finance"]} Hope this helps!'),
      ["Finance"],
    );
  });
});

// --- diagnoseEmptyFolders ---

describe("diagnoseEmptyFolders", () => {
  it("flags an empty response", () => {
    assert.match(diagnoseEmptyFolders(""), /empty response/);
    assert.match(diagnoseEmptyFolders("   "), /empty response/);
  });

  it("flags non-JSON responses with a preview", () => {
    const reason = diagnoseEmptyFolders("I cannot help with that.");
    assert.match(reason, /didn't return JSON/);
    assert.match(reason, /I cannot help/);
  });

  it("flags JSON missing a folders field", () => {
    const reason = diagnoseEmptyFolders('{"foo": 1, "bar": 2}');
    assert.match(reason, /no "folders" field/);
    assert.match(reason, /foo/);
  });

  it("flags an empty folder list", () => {
    assert.match(diagnoseEmptyFolders('{"folders": []}'), /empty folder list/);
  });

  it("flags folders-not-a-list", () => {
    assert.match(diagnoseEmptyFolders('{"folders": "Finance"}'), /wasn't a list/);
  });
});

// --- buildRefinementPrompt ---

describe("buildRefinementPrompt", () => {
  const currentFolders = ["Finance", "Newsletters"];
  const samples = [
    { subject: "Invoice", sender: "billing@shop.com" },
  ];

  it("includes current folders", () => {
    const prompt = buildRefinementPrompt(currentFolders, "add a Health folder", samples);
    assert.ok(prompt.includes("Finance"));
    assert.ok(prompt.includes("Newsletters"));
  });

  it("includes user request", () => {
    const prompt = buildRefinementPrompt(currentFolders, "add a Health folder", samples);
    assert.ok(prompt.includes("add a Health folder"));
  });

  it("includes sample emails", () => {
    const prompt = buildRefinementPrompt(currentFolders, "adjust", samples);
    assert.ok(prompt.includes("Invoice"));
    assert.ok(prompt.includes("billing@shop.com"));
  });

  it("requests JSON response with folders key", () => {
    const prompt = buildRefinementPrompt(currentFolders, "adjust", samples);
    assert.ok(prompt.includes("JSON"));
    assert.ok(prompt.includes('"folders"'));
  });

  it("asks for complete folder list", () => {
    const prompt = buildRefinementPrompt(currentFolders, "adjust", samples);
    assert.ok(prompt.toLowerCase().includes("complete") || prompt.toLowerCase().includes("updated"));
  });

  it("limits sample count in prompt", () => {
    const manySamples = Array.from({ length: 100 }, (_, i) => ({
      subject: `Email ${i}`,
      sender: `user${i}@test.com`,
    }));
    const prompt = buildRefinementPrompt(currentFolders, "adjust", manySamples);
    assert.ok(prompt.includes("Email 29"));
    assert.ok(!prompt.includes("Email 30"));
  });
});
