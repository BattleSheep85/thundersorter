export const TAG_PREFIX = "ts_";

export const TAG_COLORS = {
  finance: "#2E7D32",
  receipts: "#1565C0",
  newsletters: "#6A1B9A",
  social: "#E91E63",
  work: "#F57F17",
  personal: "#00838F",
  notifications: "#78909C",
  shipping: "#4E342E",
  travel: "#00695C",
  promotions: "#D84315",
  health: "#00897B",
  "action-required": "#D32F2F",
  clients: "#1565C0",
  projects: "#6A1B9A",
  "follow-up": "#F9A825",
  meetings: "#5E35B1",
  internal: "#546E7A",
  reports: "#3949AB",
  important: "#C62828",
};

export const PRESETS = {
  home: {
    label: "Home",
    tags: ["finance", "receipts", "newsletters", "social", "promotions", "shipping", "travel", "notifications", "personal", "health"],
  },
  business: {
    label: "Business",
    tags: ["clients", "projects", "action-required", "follow-up", "finance", "meetings", "internal", "reports", "newsletters", "notifications"],
  },
  minimal: {
    label: "Minimal",
    tags: ["important", "finance", "newsletters", "notifications"],
  },
};

export const DEFAULT_TAGS = PRESETS.home.tags;

export const BATCH_SIZE = 10;
export const RETRY_INTERVAL_MS = 60_000;
export const SKIP_FOLDER_TYPES = ["sent", "drafts", "trash", "junk", "templates", "outbox"];

export const BUILTIN_PROVIDERS = {
  gemini: {
    label: "Gemini",
    kind: "gemini",
    keyUrl: "https://aistudio.google.com/apikey",
  },
  openai: {
    label: "OpenAI",
    kind: "openai",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  anthropic: {
    label: "Anthropic",
    kind: "anthropic",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  fireworks: {
    label: "Fireworks",
    kind: "openai",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    modelsUrl: "https://api.fireworks.ai/v1/accounts/fireworks/models",
  },
  openrouter: {
    label: "OpenRouter",
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openrouter/free",
    keyUrl: "https://openrouter.ai/keys",
  },
  groq: {
    label: "Groq",
    kind: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
  },
  together: {
    label: "Together",
    kind: "openai",
    baseUrl: "https://api.together.xyz/v1",
  },
  ollama: {
    label: "Ollama (local)",
    kind: "openai",
    baseUrl: "http://localhost:11434/v1",
    noKey: true,
  },
};

export const SYSTEM_PROMPT = `\
You are an email classifier. Given an email's subject, sender, and body,
assign one or more tags from the allowed list. Return ONLY tags that clearly
apply. If nothing fits, return an empty list.

Allowed tags: {tags}

Rules:
- Be precise: only assign tags with high confidence.
- An email can have multiple tags (e.g., a shipping receipt is both "shipping" and "receipts").
- Newsletters and marketing emails should get "newsletters" or "promotions" as appropriate.
- Automated notifications (password resets, login alerts, CI builds) get "notifications".

Respond with ONLY a JSON object in this exact format: {"tags": ["tag1", "tag2"]}
`;

export const BATCH_SYSTEM_PROMPT = `\
You are an email classifier. You will receive multiple emails, each numbered.
For each email, assign one or more tags from the allowed list. Return ONLY tags
that clearly apply. If nothing fits for an email, return an empty list for it.

Return results in the same order as the input emails.

Allowed tags: {tags}

Rules:
- Be precise: only assign tags with high confidence.
- An email can have multiple tags (e.g., a shipping receipt is both "shipping" and "receipts").
- Newsletters and marketing emails should get "newsletters" or "promotions" as appropriate.
- Automated notifications (password resets, login alerts, CI builds) get "notifications".

Respond with ONLY a JSON object in this exact format: {"results": [{"tags": ["tag1"]}, {"tags": ["tag2"]}]}
`;

export function formatEmail(subject, sender, body) {
  return `Subject: ${subject}\nFrom: ${sender}\n\n${body.slice(0, 4000)}`;
}

// --- Sender normalization ---

export function normalizeSender(sender) {
  const match = sender.match(/<([^>]+)>/);
  return (match ? match[1] : sender).toLowerCase().trim();
}

// --- Header-based pre-classification ---

export function classifyFromHeaders(headers) {
  const tags = [];

  const listUnsub = headers["list-unsubscribe"]?.[0];
  const listId = headers["list-id"]?.[0];
  const precedence = (headers["precedence"]?.[0] || "").toLowerCase();

  if (precedence === "bulk" || precedence === "junk") {
    tags.push("promotions");
  } else if (listUnsub || listId || precedence === "list") {
    tags.push("newsletters");
  }

  const autoSuppress = headers["x-auto-response-suppress"]?.[0];
  if (autoSuppress) {
    tags.push("notifications");
  }

  const returnPath = (headers["return-path"]?.[0] || "").toLowerCase();
  const from = (headers["from"]?.[0] || "").toLowerCase();

  if (/no-?reply|donotreply|mailer-daemon/i.test(returnPath) ||
      /no-?reply|donotreply/i.test(from)) {
    if (!tags.includes("newsletters") && !tags.includes("promotions")) {
      tags.push("notifications");
    }
  }

  return [...new Set(tags)];
}

/**
 * Extract tags array from an LLM response object.
 * Models return tags under various key names — try them all.
 */
export function extractTags(result) {
  if (!result || typeof result !== "object") return [];
  // Try common key names models use
  const candidates = result.tags ?? result.tag ?? result.labels ??
    result.categories ?? result.classification ?? result.category;
  if (candidates != null) return candidates;
  // If the result has a single array value, use it
  const values = Object.values(result);
  if (values.length === 1 && Array.isArray(values[0])) return values[0];
  return [];
}

export function filterTags(tags, allowed) {
  // Handle models that return a string instead of an array
  const arr = Array.isArray(tags) ? tags : typeof tags === "string" ? [tags] : [];
  const lower = allowed.map((t) => t.toLowerCase());
  return arr
    .map((t) => (typeof t === "string" ? t.trim().toLowerCase() : ""))
    .filter((t) => lower.includes(t));
}

/**
 * Build a safe error message from an API response.
 * Truncates to avoid leaking large payloads or echoed credentials.
 */
export function apiError(status, body) {
  const safe = (body || "").slice(0, 200);
  return `API error (${status}): ${safe}`;
}

/**
 * Safely parse JSON from an AI provider response.
 * Some providers wrap JSON in markdown code fences — strip those first.
 */
export function safeParseJSON(text) {
  let cleaned = text.trim();
  // Strip markdown code fences that some providers add
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }
  // Try direct parse first
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    // Model may have included text around the JSON — extract it
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new SyntaxError(`No valid JSON found in response: ${cleaned.slice(0, 100)}`);
  }
}
