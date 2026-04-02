import { SYSTEM_PROMPT, BATCH_SYSTEM_PROMPT, formatEmail, filterTags } from "../common.js";

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
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
    const err = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

export async function classify(config, subject, sender, body, tags) {
  const prompt = SYSTEM_PROMPT.replace("{tags}", tags.join(", "));
  const text = await generate(
    config.apiKey,
    config.model,
    prompt,
    formatEmail(subject, sender, body),
    TAG_SCHEMA,
  );
  const result = JSON.parse(text);
  return filterTags(result.tags || [], tags);
}

export async function classifyBatch(config, emails, tags) {
  const prompt = BATCH_SYSTEM_PROMPT.replace("{tags}", tags.join(", "));
  const numbered = emails
    .map((e, i) => `Email ${i + 1}:\n${formatEmail(e.subject, e.sender, e.body)}`)
    .join("\n---\n");

  const text = await generate(config.apiKey, config.model, prompt, numbered, BATCH_SCHEMA);
  const result = JSON.parse(text);
  return (result.results || []).map((r) => filterTags(r.tags || [], tags));
}

export async function fetchModels(config) {
  const all = [];
  let pageToken = "";

  for (;;) {
    const params = `key=${config.apiKey}&pageSize=100${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models?${params}`;
    const response = await fetch(url);
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini error (${response.status}): ${err}`);
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
