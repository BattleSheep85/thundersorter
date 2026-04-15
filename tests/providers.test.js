import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

// --- Mock fetch globally ---

let fetchMock;

function mockFetch(handler) {
  fetchMock = mock.fn(handler);
  globalThis.fetch = fetchMock;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(body, status = 400) {
  return new Response(body, { status });
}

afterEach(() => {
  if (fetchMock) fetchMock.mock.restore();
});

// ============================================================
// Gemini provider
// ============================================================

describe("gemini provider", async () => {
  const gemini = await import("../extension/providers/gemini.js");

  const config = { apiKey: "test-key", model: "gemini-2.0-flash" };

  describe("classify", () => {
    it("sends email and returns matching tags", async () => {
      mockFetch(() =>
        jsonResponse({
          candidates: [{ content: { parts: [{ text: '{"tags": ["finance", "receipts"]}' }] } }],
        }),
      );

      const tags = await gemini.classify(config, "Invoice #123", "billing@co.com", "Your invoice is attached", [
        "finance",
        "receipts",
        "travel",
      ]);
      assert.deepEqual(tags, ["finance", "receipts"]);
    });

    it("uses x-goog-api-key header, not URL param", async () => {
      mockFetch((url, opts) => {
        assert.ok(!url.includes("key="), "API key should not be in URL");
        assert.equal(opts.headers["x-goog-api-key"], "test-key");
        return jsonResponse({
          candidates: [{ content: { parts: [{ text: '{"tags": []}' }] } }],
        });
      });

      await gemini.classify(config, "S", "F", "B", ["finance"]);
    });

    it("filters out tags not in allowed list", async () => {
      mockFetch(() =>
        jsonResponse({
          candidates: [{ content: { parts: [{ text: '{"tags": ["finance", "spam"]}' }] } }],
        }),
      );

      const tags = await gemini.classify(config, "S", "F", "B", ["finance", "work"]);
      assert.deepEqual(tags, ["finance"]);
    });

    it("throws on API error", async () => {
      mockFetch(() => errorResponse("Bad request", 400));

      await assert.rejects(
        () => gemini.classify(config, "S", "F", "B", ["finance"]),
        (err) => err.message.includes("400"),
      );
    });

    it("throws on unexpected response structure", async () => {
      mockFetch(() => jsonResponse({ candidates: [] }));

      await assert.rejects(
        () => gemini.classify(config, "S", "F", "B", ["finance"]),
        (err) => err.message.includes("Unexpected response"),
      );
    });
  });

  describe("classifyBatch", () => {
    it("classifies multiple emails and returns tag arrays", async () => {
      mockFetch(() =>
        jsonResponse({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '{"results": [{"tags": ["finance"]}, {"tags": ["travel"]}]}',
                  },
                ],
              },
            },
          ],
        }),
      );

      const emails = [
        { subject: "Invoice", sender: "a@b.com", body: "Pay" },
        { subject: "Flight", sender: "c@d.com", body: "Booking" },
      ];
      const results = await gemini.classifyBatch(config, emails, ["finance", "travel"]);
      assert.deepEqual(results, [["finance"], ["travel"]]);
    });
  });

  describe("fetchModels", () => {
    it("returns filtered and sorted model list", async () => {
      mockFetch(() =>
        jsonResponse({
          models: [
            { name: "models/gemini-2.0-pro", supportedGenerationMethods: ["generateContent"] },
            { name: "models/gemini-2.0-flash", supportedGenerationMethods: ["generateContent"] },
            { name: "models/gemini-2.0-flash-lite", supportedGenerationMethods: ["generateContent"] },
            { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
          ],
        }),
      );

      const models = await gemini.fetchModels(config);
      // flash-lite first, then flash, then pro. Embedding excluded.
      assert.equal(models[0], "gemini-2.0-flash-lite");
      assert.equal(models[1], "gemini-2.0-flash");
      assert.equal(models[2], "gemini-2.0-pro");
      assert.equal(models.length, 3);
    });

    it("uses header auth for model listing too", async () => {
      mockFetch((url, opts) => {
        assert.ok(!url.includes("key="), "API key should not be in URL");
        assert.equal(opts.headers["x-goog-api-key"], "test-key");
        return jsonResponse({ models: [] });
      });

      await gemini.fetchModels(config);
    });

    it("handles pagination", async () => {
      let calls = 0;
      mockFetch(() => {
        calls++;
        if (calls === 1) {
          return jsonResponse({
            models: [{ name: "models/m1", supportedGenerationMethods: ["generateContent"] }],
            nextPageToken: "page2",
          });
        }
        return jsonResponse({
          models: [{ name: "models/m2", supportedGenerationMethods: ["generateContent"] }],
        });
      });

      const models = await gemini.fetchModels(config);
      assert.equal(models.length, 2);
      assert.equal(calls, 2);
    });
  });
});

// ============================================================
// OpenAI provider
// ============================================================

describe("openai provider", async () => {
  const openai = await import("../extension/providers/openai.js");

  const config = { apiKey: "sk-test", model: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1" };

  describe("classify", () => {
    it("sends email and returns matching tags", async () => {
      mockFetch(() =>
        jsonResponse({
          choices: [{ message: { content: '{"tags": ["work"]}' } }],
        }),
      );

      const tags = await openai.classify(config, "Meeting", "boss@co.com", "Standup at 10", ["work", "personal"]);
      assert.deepEqual(tags, ["work"]);
    });

    it("uses Bearer auth header", async () => {
      mockFetch((_url, opts) => {
        assert.equal(opts.headers["Authorization"], "Bearer sk-test");
        return jsonResponse({
          choices: [{ message: { content: '{"tags": []}' } }],
        });
      });

      await openai.classify(config, "S", "F", "B", ["work"]);
    });

    it("throws on unexpected response structure", async () => {
      mockFetch(() => jsonResponse({ choices: [] }));

      await assert.rejects(
        () => openai.classify(config, "S", "F", "B", ["work"]),
        (err) => err.message.includes("empty response"),
      );
    });
  });

  describe("fetchModels", () => {
    it("returns model IDs sorted by created date", async () => {
      mockFetch(() =>
        jsonResponse({
          data: [
            { id: "gpt-4o", created: 100 },
            { id: "gpt-4o-mini", created: 200 },
          ],
        }),
      );

      const models = await openai.fetchModels(config);
      assert.equal(models[0], "gpt-4o-mini"); // newer first
      assert.equal(models[1], "gpt-4o");
    });
  });
});

// ============================================================
// Anthropic provider
// ============================================================

describe("anthropic provider", async () => {
  const anthropic = await import("../extension/providers/anthropic.js");

  const config = { apiKey: "sk-ant-test", model: "claude-sonnet-4-20250514" };

  describe("classify", () => {
    it("sends email and returns matching tags", async () => {
      mockFetch(() =>
        jsonResponse({
          content: [{ text: '{"tags": ["newsletters"]}' }],
        }),
      );

      const tags = await anthropic.classify(config, "Weekly digest", "news@co.com", "This week...", [
        "newsletters",
        "work",
      ]);
      assert.deepEqual(tags, ["newsletters"]);
    });

    it("uses x-api-key and anthropic-version headers", async () => {
      mockFetch((_url, opts) => {
        assert.equal(opts.headers["x-api-key"], "sk-ant-test");
        assert.ok(opts.headers["anthropic-version"]);
        return jsonResponse({
          content: [{ text: '{"tags": []}' }],
        });
      });

      await anthropic.classify(config, "S", "F", "B", ["work"]);
    });

    it("throws on unexpected response structure", async () => {
      mockFetch(() => jsonResponse({ content: [] }));

      await assert.rejects(
        () => anthropic.classify(config, "S", "F", "B", ["work"]),
        (err) => err.message.includes("Unexpected response"),
      );
    });
  });

  describe("fetchModels", () => {
    it("returns model IDs sorted by preference", async () => {
      mockFetch(() =>
        jsonResponse({
          data: [
            { id: "claude-opus-4-20250514" },
            { id: "claude-haiku-4-20250514" },
            { id: "claude-sonnet-4-20250514" },
          ],
        }),
      );

      const models = await anthropic.fetchModels(config);
      assert.equal(models[0], "claude-haiku-4-20250514"); // cheapest first
      assert.equal(models[1], "claude-sonnet-4-20250514");
      assert.equal(models[2], "claude-opus-4-20250514");
    });

    it("handles pagination with has_more and after_id", async () => {
      let calls = 0;
      mockFetch(() => {
        calls++;
        if (calls === 1) {
          return jsonResponse({
            data: [{ id: "claude-haiku-4-20250514" }],
            has_more: true,
          });
        }
        return jsonResponse({
          data: [{ id: "claude-sonnet-4-20250514" }],
          has_more: false,
        });
      });

      const models = await anthropic.fetchModels(config);
      assert.equal(models.length, 2);
      assert.equal(calls, 2);
    });
  });
});
