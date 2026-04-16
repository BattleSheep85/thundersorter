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

const CLASSIFY_SCHEMA = {
  type: "OBJECT",
  properties: {
    folder: { type: "STRING" },
    flags: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["folder"],
};

const BATCH_SCHEMA = {
  type: "OBJECT",
  properties: {
    results: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          folder: { type: "STRING" },
          flags: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["folder"],
      },
    },
  },
  required: ["results"],
};

function buildPrompt(template, folders) {
  return template
    .replaceAll("{folders}", folders.join(", "))
    .replaceAll("{flags}", ATTRIBUTE_FLAGS.join(", "));
}

async function generate(apiKey, model, systemPrompt, userContent, schema) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const generationConfig = { temperature: 0.1 };
  if (schema) {
    generationConfig.response_mime_type = "application/json";
    generationConfig.response_schema = schema;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userContent }] }],
      generation_config: generationConfig,
    }),
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("Gemini rate limit reached. Wait a minute or check your API quota at console.cloud.google.com.");
    }
    throw new Error(`Model "${model}": ${apiError(response.status, await response.text())}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error("Unexpected response structure from Gemini API");
  }
  return text;
}

export async function complete(config, systemPrompt, userContent) {
  return generate(config.apiKey, config.model, systemPrompt, userContent, null);
}

export async function classify(config, subject, sender, body, folders) {
  const prompt = buildPrompt(SYSTEM_PROMPT, folders);
  const text = await generate(
    config.apiKey,
    config.model,
    prompt,
    formatEmail(subject, sender, body),
    CLASSIFY_SCHEMA,
  );
  const result = safeParseJSON(text);
  const { folder, flags } = extractFolderAndFlags(result);
  return {
    folder: filterFolder(folder, folders),
    flags: filterFlags(flags),
  };
}

export async function classifyBatch(config, emails, folders) {
  const prompt = buildPrompt(BATCH_SYSTEM_PROMPT, folders);
  const numbered = emails
    .map((e, i) => `Email ${i + 1}:\n${formatEmail(e.subject, e.sender, e.body)}`)
    .join("\n---\n");

  const text = await generate(config.apiKey, config.model, prompt, numbered, BATCH_SCHEMA);
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
