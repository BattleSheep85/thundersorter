import { describe, it, afterEach, mock } from "node:test";
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
  const folders = ["Finance", "Shopping", "Travel"];

  describe("classify", () => {
    it("sends email and returns {folder, flags}", async () => {
      mockFetch(() =>
        jsonResponse({
          candidates: [{ content: { parts: [{ text: '{"folder": "Finance", "flags": ["receipt"]}' }] } }],
        }),
      );

      const result = await gemini.classify(config, "Invoice #123", "billing@co.com", "Your invoice is attached", folders);
      assert.equal(result.folder, "Finance");
      assert.deepEqual(result.flags, ["receipt"]);
    });

    it("uses x-goog-api-key header, not URL param", async () => {
      mockFetch((url, opts) => {
        assert.ok(!url.includes("key="), "API key should not be in URL");
        assert.equal(opts.headers["x-goog-api-key"], "test-key");
        return jsonResponse({
          candidates: [{ content: { parts: [{ text: '{"folder": "", "flags": []}' }] } }],
        });
      });

      await gemini.classify(config, "S", "F", "B", folders);
    });

    it("filters out folder not in allowed list", async () => {
      mockFetch(() =>
        jsonResponse({
          candidates: [{ content: { parts: [{ text: '{"folder": "Spam", "flags": []}' }] } }],
        }),
      );

      const result = await gemini.classify(config, "S", "F", "B", folders);
      assert.equal(result.folder, "");
    });

    it("filters out flags not in allowed attribute list", async () => {
      mockFetch(() =>
        jsonResponse({
          candidates: [{ content: { parts: [{ text: '{"folder": "Finance", "flags": ["urgent", "bogus"]}' }] } }],
        }),
      );

      const result = await gemini.classify(config, "S", "F", "B", folders);
      assert.deepEqual(result.flags, ["urgent"]);
    });

    it("returns 429 rate limit message", async () => {
      mockFetch(() => errorResponse("Too many", 429));
      await assert.rejects(
        () => gemini.classify(config, "S", "F", "B", folders),
        (err) => err.message.toLowerCase().includes("rate limit"),
      );
    });
  });

  describe("classifyBatch", () => {
    it("classifies multiple emails and returns {folder, flags} per email", async () => {
      mockFetch(() =>
        jsonResponse({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '{"results": [{"folder": "Finance", "flags": []}, {"folder": "Travel", "flags": ["urgent"]}]}',
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
      const results = await gemini.classifyBatch(config, emails, folders);
      assert.equal(results.length, 2);
      assert.equal(results[0].folder, "Finance");
      assert.equal(results[1].folder, "Travel");
      assert.deepEqual(results[1].flags, ["urgent"]);
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
      assert.equal(models[0], "gemini-2.0-flash-lite");
      assert.equal(models[1], "gemini-2.0-flash");
      assert.equal(models[2], "gemini-2.0-pro");
      assert.equal(models.length, 3);
    });
  });
});

// ============================================================
// OpenAI provider
// ============================================================

describe("openai provider", async () => {
  const openai = await import("../extension/providers/openai.js");

  const config = { apiKey: "sk-test", model: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1" };
  const folders = ["Work", "Personal"];

  describe("classify", () => {
    it("sends email and returns {folder, flags}", async () => {
      mockFetch(() =>
        jsonResponse({
          choices: [{ message: { content: '{"folder": "Work", "flags": ["action-required"]}' } }],
        }),
      );

      const result = await openai.classify(config, "Meeting", "boss@co.com", "Standup at 10", folders);
      assert.equal(result.folder, "Work");
      assert.deepEqual(result.flags, ["action-required"]);
    });

    it("uses Bearer auth header", async () => {
      mockFetch((_url, opts) => {
        assert.equal(opts.headers["Authorization"], "Bearer sk-test");
        return jsonResponse({
          choices: [{ message: { content: '{"folder": "", "flags": []}' } }],
        });
      });

      await openai.classify(config, "S", "F", "B", folders);
    });

    it("throws on empty response", async () => {
      mockFetch(() => jsonResponse({ choices: [] }));

      await assert.rejects(
        () => openai.classify(config, "S", "F", "B", folders),
        (err) => err.message.includes("empty response"),
      );
    });

    it("returns 429 rate limit message with OpenRouter guidance", async () => {
      mockFetch(() => errorResponse("Too many", 429));
      await assert.rejects(
        () => openai.classify(config, "S", "F", "B", folders),
        (err) => err.message.toLowerCase().includes("rate limit"),
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
      assert.equal(models[0], "gpt-4o-mini");
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
  const folders = ["Newsletters", "Work"];

  describe("classify", () => {
    it("sends email and returns {folder, flags}", async () => {
      mockFetch(() =>
        jsonResponse({
          content: [{ text: '{"folder": "Newsletters", "flags": []}' }],
        }),
      );

      const result = await anthropic.classify(config, "Weekly digest", "news@co.com", "This week...", folders);
      assert.equal(result.folder, "Newsletters");
      assert.deepEqual(result.flags, []);
    });

    it("uses x-api-key and anthropic-version headers", async () => {
      mockFetch((_url, opts) => {
        assert.equal(opts.headers["x-api-key"], "sk-ant-test");
        assert.ok(opts.headers["anthropic-version"]);
        return jsonResponse({
          content: [{ text: '{"folder": "", "flags": []}' }],
        });
      });

      await anthropic.classify(config, "S", "F", "B", folders);
    });

    it("throws on unexpected response structure", async () => {
      mockFetch(() => jsonResponse({ content: [] }));

      await assert.rejects(
        () => anthropic.classify(config, "S", "F", "B", folders),
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
      assert.equal(models[0], "claude-haiku-4-20250514");
      assert.equal(models[1], "claude-sonnet-4-20250514");
      assert.equal(models[2], "claude-opus-4-20250514");
    });
  });
});
