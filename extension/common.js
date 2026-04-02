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
`;

export function formatEmail(subject, sender, body) {
  return `Subject: ${subject}\nFrom: ${sender}\n\n${body.slice(0, 4000)}`;
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
