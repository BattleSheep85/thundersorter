export const TAG_PREFIX = "ts_";

// Attribute flags are the only secondary tags. Folders handle primary categorization.
export const ATTRIBUTE_FLAGS = ["action-required", "urgent", "receipt"];

export const TAG_COLORS = {
  "action-required": "#D32F2F",
  urgent: "#E65100",
  receipt: "#1565C0",
};

// Folder presets — the primary bucket each email gets moved into.
export const FOLDER_PRESETS = {
  home: {
    label: "Home",
    folders: ["Finance", "Shopping", "Travel", "Personal", "Newsletters", "Notifications"],
  },
  business: {
    label: "Business",
    folders: ["Clients", "Projects", "Meetings", "Reports", "Internal", "Newsletters", "Notifications"],
  },
  minimal: {
    label: "Minimal",
    folders: ["Important", "Newsletters", "Notifications"],
  },
};

export const DEFAULT_FOLDERS = FOLDER_PRESETS.home.folders;

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
You are an email sorter. Given an email's subject, sender, and body, choose
exactly ONE folder from the allowed list and zero or more flags from the allowed
flag list.

Allowed folders: {folders}
Allowed flags: {flags}

Rules:
- "folder" is the single best fit. If nothing fits, use "" (empty string).
- "flags" is a subset of the allowed flag list. Only add a flag when it clearly applies:
  - "action-required": needs a response or action from the user
  - "urgent": time-sensitive (deadlines, emergencies)
  - "receipt": a record worth keeping (invoices, order confirmations, tax docs)
- Automated notifications (login alerts, CI builds, shipping updates) usually go in "Notifications".
- Marketing and newsletters go in "Newsletters" or the matching folder.

Respond with ONLY a JSON object in this exact format: {"folder": "Name", "flags": ["flag1"]}
`;

export const BATCH_SYSTEM_PROMPT = `\
You are an email sorter. You will receive multiple emails, each numbered.
For each email, choose exactly ONE folder from the allowed list and zero or more
flags from the allowed flag list. Return results in the same order as the input.

Allowed folders: {folders}
Allowed flags: {flags}

Rules:
- "folder" is the single best fit. If nothing fits, use "" (empty string).
- "flags" is a subset of the allowed flag list. Only add a flag when it clearly applies:
  - "action-required": needs a response or action from the user
  - "urgent": time-sensitive (deadlines, emergencies)
  - "receipt": a record worth keeping (invoices, order confirmations, tax docs)

Respond with ONLY a JSON object in this exact format: {"results": [{"folder": "Name", "flags": ["flag1"]}, {"folder": "Name", "flags": []}]}
`;

export function formatEmail(subject, sender, body) {
  return `Subject: ${subject}\nFrom: ${sender}\n\n${body.slice(0, 4000)}`;
}

// --- Security filter: never send sensitive auth emails to an LLM ---

const SENSITIVE_SUBJECT_RE = new RegExp([
  "password\\s*reset",
  "reset\\s*(your\\s*)?password",
  "verification\\s*code",
  "verify\\s*(your\\s*)?(email|account|identity)",
  "confirm\\s*(your\\s*)?(email|account|identity)",
  "security\\s*(code|alert|notification)",
  "login\\s*(code|verification|attempt)",
  "sign[- ]?in\\s*(code|verification|attempt|link)",
  "two[- ]?(factor|step)",
  "\\b2fa\\b",
  "multi[- ]?factor",
  "one[- ]?time\\s*(password|code|pin)",
  "\\botp\\b",
  "account\\s*recovery",
  "authentication\\s*code",
  "magic\\s*link",
  "temporary\\s*password",
  "access\\s*code",
  "unlock\\s*(your\\s*)?account",
  "suspicious\\s*(activity|login|sign)",
].join("|"), "i");

const SENSITIVE_BODY_RE = new RegExp([
  "reset\\s*(your\\s*)?password",
  "verification\\s*code\\s*[:=]?\\s*\\d",
  "\\buse\\s*(this\\s*)?code\\s*[:=]",
  "\\btoken\\s*[:=]\\s*\\S",
  "one[- ]?time\\s*(password|code)",
].join("|"), "i");

export function isSensitiveEmail(subject, body) {
  if (SENSITIVE_SUBJECT_RE.test(subject || "")) return true;
  if (SENSITIVE_BODY_RE.test((body || "").slice(0, 2000))) return true;
  return false;
}

// --- Sender normalization ---

export function normalizeSender(sender) {
  const match = sender.match(/<([^>]+)>/);
  return (match ? match[1] : sender).toLowerCase().trim();
}

// --- Header-based pre-classification ---

// Returns a folder NAME (case-sensitive match against allowed folders) or "" if unknown.
export function classifyFromHeaders(headers) {
  const listUnsub = headers["list-unsubscribe"]?.[0];
  const listId = headers["list-id"]?.[0];
  const precedence = (headers["precedence"]?.[0] || "").toLowerCase();
  const autoSuppress = headers["x-auto-response-suppress"]?.[0];
  const returnPath = (headers["return-path"]?.[0] || "").toLowerCase();
  const from = (headers["from"]?.[0] || "").toLowerCase();

  if (listUnsub || listId || precedence === "list" || precedence === "bulk") {
    return "Newsletters";
  }

  if (autoSuppress) return "Notifications";

  if (/no-?reply|donotreply|mailer-daemon/i.test(returnPath) ||
      /no-?reply|donotreply/i.test(from)) {
    return "Notifications";
  }

  return "";
}

/**
 * Extract {folder, flags} from an LLM response object, tolerant of schema drift.
 * Folder may appear under "folder"/"category"/"bucket". Flags may be "flags"/"tags"/"labels".
 */
export function extractFolderAndFlags(result) {
  if (!result || typeof result !== "object") return { folder: "", flags: [] };
  const folderRaw = result.folder ?? result.category ?? result.bucket ?? result.classification ?? "";
  const flagsRaw = result.flags ?? result.tags ?? result.labels ?? [];
  return {
    folder: typeof folderRaw === "string" ? folderRaw : "",
    flags: Array.isArray(flagsRaw) ? flagsRaw : typeof flagsRaw === "string" ? [flagsRaw] : [],
  };
}

/**
 * Filter a folder name against the allowed list. Case-insensitive match, returns the canonical
 * spelling from the allowed list, or "" if no match.
 */
export function filterFolder(folder, allowed) {
  if (typeof folder !== "string") return "";
  const lower = folder.trim().toLowerCase();
  if (!lower) return "";
  return allowed.find((f) => f.toLowerCase() === lower) || "";
}

/**
 * Filter flags against the allowed attribute list. Returns lowercase canonical spellings.
 */
export function filterFlags(flags, allowed = ATTRIBUTE_FLAGS) {
  const arr = Array.isArray(flags) ? flags : typeof flags === "string" ? [flags] : [];
  const lower = allowed.map((f) => f.toLowerCase());
  return [...new Set(
    arr
      .map((f) => (typeof f === "string" ? f.trim().toLowerCase() : ""))
      .filter((f) => lower.includes(f)),
  )];
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
