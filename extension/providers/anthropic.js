import { SYSTEM_PROMPT, BATCH_SYSTEM_PROMPT, formatEmail, filterTags, extractTags, safeParseJSON, apiError } from "../common.js";

const JSON_INSTRUCTION = '\nRespond with ONLY a JSON object. No other text.\n';

const ANTHROPIC_HEADERS = {
  "Content-Type": "application/json",
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true",
};

function authHeaders(apiKey) {
  return { ...ANTHROPIC_HEADERS, "x-api-key": apiKey };
}

async function createMessage(config, systemPrompt, userContent) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: authHeaders(config.apiKey),
    body: JSON.stringify({
      model: config.model,
      max_tokens: 1024,
      system: systemPrompt,
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

export async function classify(config, subject, sender, body, tags) {
  const prompt =
    SYSTEM_PROMPT.replaceAll("{tags}", tags.join(", ")) +
    JSON_INSTRUCTION +
    '{"tags": [...]}\n';

  const text = await createMessage(config, prompt, formatEmail(subject, sender, body));
  const result = safeParseJSON(text);
  const raw = extractTags(result);
  const filtered = filterTags(raw, tags);
  if (raw.length > 0 && filtered.length === 0) {
    console.warn("Thundersorter: LLM returned tags but none matched allowed list:", JSON.stringify(raw));
  }
  return filtered;
}

export async function classifyBatch(config, emails, tags) {
  const prompt =
    BATCH_SYSTEM_PROMPT.replaceAll("{tags}", tags.join(", ")) +
    JSON_INSTRUCTION +
    '{"results": [{"tags": [...]}, ...]}\n';

  const numbered = emails
    .map((e, i) => `Email ${i + 1}:\n${formatEmail(e.subject, e.sender, e.body)}`)
    .join("\n---\n");

  const text = await createMessage(config, prompt, numbered);
  const result = safeParseJSON(text);
  const resultsArr = result.results || result.emails || [];
  const results = resultsArr.map((r) => filterTags(extractTags(r), tags));
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
