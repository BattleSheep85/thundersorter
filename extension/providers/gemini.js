import { SYSTEM_PROMPT, BATCH_SYSTEM_PROMPT, formatEmail, filterTags, extractTags, safeParseJSON, apiError } from "../common.js";

const TAG_SCHEMA = {
  type: "OBJECT",
  properties: {
    tags: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["tags"],
};

const BATCH_SCHEMA = {
  type: "OBJECT",
  properties: {
    results: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          tags: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["tags"],
      },
    },
  },
  required: ["results"],
};

async function generate(apiKey, model, systemPrompt, userContent, schema) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userContent }] }],
      generation_config: {
        temperature: 0.1,
        response_mime_type: "application/json",
        response_schema: schema,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(apiError(response.status, await response.text()));
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error("Unexpected response structure from Gemini API");
  }
  return text;
}

export async function complete(config, systemPrompt, userContent) {
  return generate(config.apiKey, config.model, systemPrompt, userContent, TAG_SCHEMA);
}

export async function classify(config, subject, sender, body, tags) {
  const prompt = SYSTEM_PROMPT.replaceAll("{tags}", tags.join(", "));
  const text = await generate(
    config.apiKey,
    config.model,
    prompt,
    formatEmail(subject, sender, body),
    TAG_SCHEMA,
  );
  const result = safeParseJSON(text);
  const raw = extractTags(result);
  const filtered = filterTags(raw, tags);
  if (raw.length > 0 && filtered.length === 0) {
    console.warn("Thundersorter: LLM returned tags but none matched allowed list:", JSON.stringify(raw));
  }
  return filtered;
}

export async function classifyBatch(config, emails, tags) {
  const prompt = BATCH_SYSTEM_PROMPT.replaceAll("{tags}", tags.join(", "));
  const numbered = emails
    .map((e, i) => `Email ${i + 1}:\n${formatEmail(e.subject, e.sender, e.body)}`)
    .join("\n---\n");

  const text = await generate(config.apiKey, config.model, prompt, numbered, BATCH_SCHEMA);
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
  let pageToken = "";

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = `pageSize=100${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models?${params}`;
    const response = await fetch(url, {
      headers: { "x-goog-api-key": config.apiKey },
    });
    if (!response.ok) {
      throw new Error(apiError(response.status, await response.text()));
    }

    const data = await response.json();
    all.push(...(data.models || []));

    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  const models = all
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => m.name.replace("models/", ""));

  // Sort: flash-lite first (cheapest), then flash, then pro, then everything else
  const priority = (name) => {
    if (name.includes("flash-lite")) return 0;
    if (name.includes("flash")) return 1;
    if (name.includes("pro")) return 2;
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
