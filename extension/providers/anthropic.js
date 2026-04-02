import { SYSTEM_PROMPT, BATCH_SYSTEM_PROMPT, formatEmail, filterTags } from "../common.js";

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
    const err = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

export async function classify(config, subject, sender, body, tags) {
  const prompt =
    SYSTEM_PROMPT.replace("{tags}", tags.join(", ")) +
    JSON_INSTRUCTION +
    '{"tags": [...]}\n';

  const text = await createMessage(config, prompt, formatEmail(subject, sender, body));
  const result = JSON.parse(text);
  return filterTags(result.tags || [], tags);
}

export async function classifyBatch(config, emails, tags) {
  const prompt =
    BATCH_SYSTEM_PROMPT.replace("{tags}", tags.join(", ")) +
    JSON_INSTRUCTION +
    '{"results": [{"tags": [...]}, ...]}\n';

  const numbered = emails
    .map((e, i) => `Email ${i + 1}:\n${formatEmail(e.subject, e.sender, e.body)}`)
    .join("\n---\n");

  const text = await createMessage(config, prompt, numbered);
  const result = JSON.parse(text);
  return (result.results || []).map((r) => filterTags(r.tags || [], tags));
}

export async function fetchModels(config) {
  const all = [];
  let after = "";

  for (;;) {
    const params = after
      ? `limit=100&after_id=${encodeURIComponent(after)}`
      : "limit=100";
    const response = await fetch(`https://api.anthropic.com/v1/models?${params}`, {
      headers: authHeaders(config.apiKey),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic error (${response.status}): ${err}`);
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
