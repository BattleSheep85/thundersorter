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

async function chatCompletion(config, systemPrompt, userContent, jsonMode) {
  const url = `${config.baseUrl || "https://api.openai.com/v1"}/chat/completions`;

  const headers = { "Content-Type": "application/json" };
  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  const body = {
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    temperature: 0.1,
    max_tokens: 1024,
  };
  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("Rate limit reached. Free tier allows ~50 requests/day. Add OpenRouter credits ($5 = 1,000/day) or use Ollama (unlimited, local).");
    }
    throw new Error(`Model "${config.model}": ${apiError(response.status, await response.text())}`);
  }

  const data = await response.json();
  const message = data?.choices?.[0]?.message;
  const text = message?.content ?? message?.reasoning;
  if (typeof text !== "string") {
    const preview = JSON.stringify(data).slice(0, 300);
    throw new Error(`Model "${config.model}": empty response (${preview})`);
  }
  return text;
}

export async function complete(config, systemPrompt, userContent) {
  return chatCompletion(config, systemPrompt, userContent, false);
}

export async function classify(config, subject, sender, body, folders) {
  const prompt = buildPrompt(SYSTEM_PROMPT, folders);
  const text = await chatCompletion(config, prompt, formatEmail(subject, sender, body), true);
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

  const text = await chatCompletion(config, prompt, numbered, true);
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
