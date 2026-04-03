import { SYSTEM_PROMPT, BATCH_SYSTEM_PROMPT, formatEmail, filterTags, extractTags, safeParseJSON, apiError } from "../common.js";

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
      max_tokens: 1024,
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
  const prompt = SYSTEM_PROMPT.replaceAll("{tags}", tags.join(", "));
  const text = await chatCompletion(config, prompt, formatEmail(subject, sender, body));
  const result = safeParseJSON(text);
  const raw = extractTags(result);
  const filtered = filterTags(raw, tags);
  if (raw.length > 0 && filtered.length === 0) {
    console.warn("Thundersorter: LLM returned tags but none matched allowed list:", JSON.stringify(raw));
  }
  if (raw.length === 0 && Object.keys(result).length > 0) {
    console.warn("Thundersorter: LLM returned JSON but no tags found:", JSON.stringify(result).slice(0, 200));
  }
  return filtered;
}

export async function classifyBatch(config, emails, tags) {
  const prompt = BATCH_SYSTEM_PROMPT.replaceAll("{tags}", tags.join(", "));
  const numbered = emails
    .map((e, i) => `Email ${i + 1}:\n${formatEmail(e.subject, e.sender, e.body)}`)
    .join("\n---\n");

  const text = await chatCompletion(config, prompt, numbered);
  const result = safeParseJSON(text);
  const resultsArr = result.results || result.emails || [];
  const results = resultsArr.map((r) => filterTags(extractTags(r), tags));
  if (results.length !== emails.length) {
    console.warn(`Thundersorter: batch result count mismatch (got ${results.length}, expected ${emails.length})`);
  }
  return results;
}

const MAX_PAGES = 20;

// Fetch from a native API that returns { models: [...], nextPageToken }
// Used by providers like Fireworks that have their own models endpoint.
async function fetchNativeModels(modelsUrl, headers) {
  const all = [];
  let pageToken = "";

  for (let page = 0; page < MAX_PAGES; page++) {
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

  // Filter to chat-capable models (exclude embedding, vision-only, etc.)
  return all
    .map((m) => m.name)
    .filter((name) => {
      const n = name.toLowerCase();
      // Exclude known non-chat model types
      if (n.includes("embed") || n.includes("whisper") || n.includes("tts")) return false;
      if (n.includes("diffusion") || n.includes("stable-") || n.includes("sdxl")) return false;
      return true;
    });
}

// Fetch from an OpenAI-compatible /models endpoint.
async function fetchOpenAIModels(base, headers) {
  const all = [];
  let cursor = "";
  let style = "";

  for (let page = 0; page < MAX_PAGES; page++) {
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
