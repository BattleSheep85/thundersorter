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
};

export const DEFAULT_TAGS = Object.keys(TAG_COLORS);

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

export function filterTags(tags, allowed) {
  return tags.filter((t) => allowed.includes(t));
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
  return JSON.parse(cleaned);
}
