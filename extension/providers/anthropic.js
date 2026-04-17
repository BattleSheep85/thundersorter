import {
  SYSTEM_PROMPT,
  BATCH_SYSTEM_PROMPT,
  ATTRIBUTE_FLAGS,
  formatEmail,
  filterFolder,
  filterFlags,
  extractFolderAndFlags,
  safeParseJSON,
  apiError,
} from "../common.js";

function buildPrompt(template, folders) {
  return template
    .replaceAll("{folders}", folders.join(", "))
    .replaceAll("{flags}", ATTRIBUTE_FLAGS.join(", "));
}

const JSON_INSTRUCTION = '\nRespond with ONLY a JSON object. No other text.\n';

const ANTHROPIC_HEADERS = {
  "Content-Type": "application/json",
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true",
};

function authHeaders(apiKey) {
  return { ...ANTHROPIC_HEADERS, "x-api-key": apiKey };
}

async function createMessage(config, systemPrompt, userContent, options = {}) {
  const maxTokens = options.maxTokens ?? 1024;
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: authHeaders(config.apiKey),
    body: JSON.stringify({
      model: config.model,
      max_tokens: maxTokens,
      // System prompt is stable across calls for a given folder set; marking
      // it cacheable lets Anthropic reuse the prefix on repeat classification.
      // (At Haiku's 2048-token cache minimum the current prompt is too small
      // to actually cache — but if the prompt grows, or future models drop
      // the minimum, this kicks in automatically with zero code change.)
      system: [
        { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: userContent }],
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("Anthropic rate limit reached. Check your usage at console.anthropic.com.");
    }
    throw new Error(`Model "${config.model}": ${apiError(response.status, await response.text())}`);
  }

  const data = await response.json();
  const text = data?.content?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error("Unexpected response structure from Anthropic API");
  }
  return text;
}

export async function complete(config, systemPrompt, userContent) {
  return createMessage(config, systemPrompt, userContent);
}

export async function classify(config, subject, sender, body, folders) {
  const prompt = buildPrompt(SYSTEM_PROMPT, folders) + JSON_INSTRUCTION;
  const text = await createMessage(config, prompt, formatEmail(subject, sender, body));
  const result = safeParseJSON(text);
  const { folder, flags } = extractFolderAndFlags(result);
  return {
    folder: filterFolder(folder, folders),
    flags: filterFlags(flags),
  };
}

export async function classifyBatch(config, emails, folders) {
  const prompt = buildPrompt(BATCH_SYSTEM_PROMPT, folders) + JSON_INSTRUCTION;
  const numbered = emails
    .map((e, i) => `Email ${i + 1}:\n${formatEmail(e.subject, e.sender, e.body)}`)
    .join("\n---\n");

  // Each email's JSON response is ~40-80 tokens; give headroom for the outer
  // envelope and the rare long flag list. Cap floor at the single-call default.
  const maxTokens = Math.max(1024, emails.length * 100 + 256);
  const text = await createMessage(config, prompt, numbered, { maxTokens });
  const result = safeParseJSON(text);
  const resultsArr = result.results || result.emails || [];
  const results = resultsArr.map((r) => {
    const { folder, flags } = extractFolderAndFlags(r);
    return { folder: filterFolder(folder, folders), flags: filterFlags(flags) };
  });
  if (results.length !== emails.length) {
    console.warn(`Thundersorter: batch result count mismatch (got ${results.length}, expected ${emails.length})`);
  }
  return results;
}

const MAX_PAGES = 20;

export async function fetchModels(config) {
  const all = [];
  let after = "";

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = after
      ? `limit=100&after_id=${encodeURIComponent(after)}`
      : "limit=100";
    const response = await fetch(`https://api.anthropic.com/v1/models?${params}`, {
      headers: authHeaders(config.apiKey),
    });

    if (!response.ok) {
      throw new Error(apiError(response.status, await response.text()));
    }

    const data = await response.json();
    const page = data.data || [];
    all.push(...page);

    if (!data.has_more || page.length === 0) break;
    after = page[page.length - 1].id;
  }

  const models = all.map((m) => m.id);

  // Sort: haiku first (cheapest), then sonnet, then opus
  const priority = (name) => {
    if (name.includes("haiku")) return 0;
    if (name.includes("sonnet")) return 1;
    if (name.includes("opus")) return 2;
    return 3;
  };

  models.sort((a, b) => priority(a) - priority(b));
  return models;
}

export async function testConnection(config) {
  const models = await fetchModels(config);
  if (models.length === 0) throw new Error("No models available.");
  return `Connected. ${models.length} models available.`;
}
