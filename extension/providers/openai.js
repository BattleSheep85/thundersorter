import { SYSTEM_PROMPT, BATCH_SYSTEM_PROMPT, formatEmail, filterTags, safeParseJSON, apiError } from "../common.js";

async function chatCompletion(config, systemPrompt, userContent) {
  const url = `${config.baseUrl || "https://api.openai.com/v1"}/chat/completions`;

  const headers = { "Content-Type": "application/json" };
  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    throw new Error(apiError(response.status, await response.text()));
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") {
    throw new Error("Unexpected response structure from API");
  }
  return text;
}

export async function classify(config, subject, sender, body, tags) {
  const prompt = SYSTEM_PROMPT.replace("{tags}", tags.join(", "));
  const text = await chatCompletion(config, prompt, formatEmail(subject, sender, body));
  const result = safeParseJSON(text);
  return filterTags(result.tags || [], tags);
}

export async function classifyBatch(config, emails, tags) {
  const prompt = BATCH_SYSTEM_PROMPT.replace("{tags}", tags.join(", "));
  const numbered = emails
    .map((e, i) => `Email ${i + 1}:\n${formatEmail(e.subject, e.sender, e.body)}`)
    .join("\n---\n");

  const text = await chatCompletion(config, prompt, numbered);
  const result = safeParseJSON(text);
  return (result.results || []).map((r) => filterTags(r.tags || [], tags));
}

// Fetch from a native API that returns { models: [...], nextPageToken }
// Used by providers like Fireworks that have their own models endpoint.
async function fetchNativeModels(modelsUrl, headers) {
  const all = [];
  let pageToken = "";

  for (;;) {
    const params = new URLSearchParams({ pageSize: "200" });
    if (pageToken) params.set("pageToken", pageToken);

    const response = await fetch(`${modelsUrl}?${params}`, { headers });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    const page = data.models || [];
    all.push(...page);

    if (!data.nextPageToken || page.length === 0) break;
    pageToken = data.nextPageToken;
  }

  return all.map((m) => m.name);
}

// Fetch from an OpenAI-compatible /models endpoint.
async function fetchOpenAIModels(base, headers) {
  const all = [];
  let cursor = "";
  let style = "";

  for (;;) {
    const params = new URLSearchParams();

    if (!style || style === "openai") {
      params.set("limit", "100");
      if (cursor && style === "openai") params.set("after", cursor);
    }
    if (!style || style === "pageToken") {
      params.set("pageSize", "200");
      if (cursor && style === "pageToken") params.set("pageToken", cursor);
    }

    const response = await fetch(`${base}?${params}`, { headers });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    const page = data.data || [];
    all.push(...page);

    if (page.length === 0) break;

    if (data.nextPageToken) {
      style = "pageToken";
      cursor = data.nextPageToken;
    } else if (data.has_more) {
      style = "openai";
      cursor = page[page.length - 1].id;
    } else {
      break;
    }
  }

  return all
    .map((m) => ({ id: m.id, created: m.created || 0 }))
    .sort((a, b) => b.created - a.created)
    .map((m) => m.id);
}

export async function fetchModels(config) {
  const headers = {};
  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  // If the provider has a native models endpoint (e.g. Fireworks), use it
  // for the full catalog. Otherwise use the OpenAI-compatible /models endpoint.
  if (config.modelsUrl) {
    return fetchNativeModels(config.modelsUrl, headers);
  }

  const base = `${config.baseUrl || "https://api.openai.com/v1"}/models`;
  return fetchOpenAIModels(base, headers);
}

export async function testConnection(config) {
  const models = await fetchModels(config);
  if (models.length === 0) throw new Error("No models available.");
  return `Connected. ${models.length} models available.`;
}
