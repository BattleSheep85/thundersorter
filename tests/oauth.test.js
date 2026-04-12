import { describe, it, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

import { generatePKCE, exchangeCode, CALLBACK_URL } from "../extension/oauth.js";

// --- Mock fetch ---

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

afterEach(() => {
  if (fetchMock) fetchMock.mock.restore();
});

// ============================================================
// PKCE generation
// ============================================================

describe("generatePKCE", () => {
  it("returns a 64-char hex verifier and base64url challenge", async () => {
    const { verifier, challenge } = await generatePKCE();

    assert.equal(verifier.length, 64);
    assert.match(verifier, /^[0-9a-f]+$/);

    assert.ok(challenge.length > 0);
    assert.ok(!challenge.includes("+"), "challenge must not contain +");
    assert.ok(!challenge.includes("/"), "challenge must not contain /");
    assert.ok(!challenge.includes("="), "challenge must not contain =");
  });

  it("produces different verifiers on each call", async () => {
    const a = await generatePKCE();
    const b = await generatePKCE();
    assert.notEqual(a.verifier, b.verifier);
  });

  it("challenge is SHA-256 of verifier in base64url", async () => {
    const { verifier, challenge } = await generatePKCE();

    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const expected = btoa(String.fromCharCode(...new Uint8Array(hash)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    assert.equal(challenge, expected);
  });
});

// ============================================================
// Callback URL
// ============================================================

describe("CALLBACK_URL", () => {
  it("points to GitHub Pages", () => {
    assert.ok(CALLBACK_URL.startsWith("https://battlesheep85.github.io/"));
  });
});

// ============================================================
// Code exchange
// ============================================================

describe("exchangeCode", () => {
  it("sends code and verifier, returns API key", async () => {
    mockFetch(() => jsonResponse({ key: "sk-or-v1-test123" }));

    const key = await exchangeCode("auth-code-abc", "my-verifier");
    assert.equal(key, "sk-or-v1-test123");

    const call = fetchMock.mock.calls[0];
    assert.equal(call.arguments[0], "https://openrouter.ai/api/v1/auth/keys");

    const body = JSON.parse(call.arguments[1].body);
    assert.equal(body.code, "auth-code-abc");
    assert.equal(body.code_verifier, "my-verifier");
    assert.equal(body.code_challenge_method, "S256");
  });

  it("throws on API error", async () => {
    mockFetch(() => new Response("Invalid code", { status: 403 }));

    await assert.rejects(
      () => exchangeCode("bad-code", "verifier"),
      /OpenRouter error \(403\)/,
    );
  });

  it("throws when response has no key", async () => {
    mockFetch(() => jsonResponse({ error: "something" }));

    await assert.rejects(
      () => exchangeCode("code", "verifier"),
      /No API key in response/,
    );
  });
});
