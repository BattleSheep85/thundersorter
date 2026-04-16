/**
 * Inbox analyzer — domain-stratified sampling and LLM-powered tag discovery.
 */

import { isSensitiveEmail } from "./common.js";

/**
 * Build a representative sample from a list of messages.
 * Uses domain-stratified temporal spread to get diverse coverage.
 * @param {object[]} messages — array of { author, subject, date }
 * @param {number} targetSize — desired sample size (default 75)
 * @returns {object[]} — array of { subject, sender }
 */
export function buildSample(messages, targetSize = 75) {
  if (!messages || messages.length === 0) return [];

  // Filter out security-sensitive emails (password resets, verification codes, etc.)
  const safe = messages.filter((m) => !isSensitiveEmail(m.subject));

  if (safe.length === 0) return [];

  // Group by sender domain
  const byDomain = new Map();
  for (const msg of safe) {
    const sender = (msg.author || "").toLowerCase();
    const domain = sender.includes("@") ? sender.split("@").pop() : "unknown";
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain).push(msg);
  }

  // Take from each domain proportionally, with a minimum of 1
  const domains = [...byDomain.entries()];
  const totalMessages = safe.length;
  const sample = [];

  for (const [, group] of domains) {
    // Sort a copy by date (newest first) — never mutate the original
    const sorted = [...group].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    const proportion = sorted.length / totalMessages;
    const count = Math.max(1, Math.round(proportion * targetSize));
    // Spread picks across the group (temporal spread)
    const step = Math.max(1, Math.floor(sorted.length / count));
    let picked = 0;
    for (let i = 0; i < sorted.length && picked < count && sample.length < targetSize; i += step) {
      sample.push({
        subject: sorted[i].subject || "",
        sender: sorted[i].author || "",
      });
      picked++;
    }
  }

  return sample.slice(0, targetSize);
}

/**
 * Build a prompt for the LLM to discover FOLDER names from email samples.
 * @param {object[]} samples — from buildSample()
 * @param {string} preset — "home", "business", "minimal", or "custom"
 * @param {number} targetCount — how many folders to suggest (default 6)
 * @returns {string}
 */
export function buildAnalysisPrompt(samples, preset = "home", targetCount = 6) {
  const emailList = samples
    .map((s, i) => `${i + 1}. Subject: ${s.subject}\n   From: ${s.sender}`)
    .join("\n");

  const context = preset === "business"
    ? "This is a work/business email account."
    : preset === "minimal"
      ? "The user wants very few, broad folders."
      : "This is a personal/home email account.";

  return `You are an email organization expert. Based on these email subjects and senders, suggest ${targetCount} folder names the user should create to organize their inbox.

${context}

Rules:
- Every folder name is ONE word, capitalized (e.g., "Finance", "Shopping", "Travel").
- Folders are mutually exclusive buckets — every email belongs to exactly ONE of them.
- Each folder should cover a meaningful slice of the inbox (at least 5% of emails).
- Always include "Notifications" for automated, low-value emails.
- Always include "Newsletters" if any bulk/marketing mail is present.
- Order folders most-used first.

Here are sample emails from the inbox:
${emailList}

Respond with ONLY a JSON object: {"folders": ["Folder1", "Folder2", ...]}`;
}

/**
 * Normalize a folder name to "Titlecase", safe for filesystem use.
 * Strips anything non-alphanumeric/-, collapses dashes, caps at 30 chars.
 */
function normalizeFolderName(raw) {
  if (typeof raw !== "string") return "";
  const cleaned = raw.trim().replace(/[^A-Za-z0-9-]/g, "").slice(0, 30);
  if (!cleaned) return "";
  return cleaned[0].toUpperCase() + cleaned.slice(1).toLowerCase();
}

/**
 * Parse folder suggestions from an LLM response.
 * Accepts various key names (folders / tags / categories / suggestions) for resilience.
 * @param {string} llmResponse
 * @returns {string[]}
 */
export function parseFolderSuggestions(llmResponse) {
  let cleaned = (llmResponse || "").trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }
  const tryParse = (text) => {
    const parsed = JSON.parse(text);
    const list = parsed.folders || parsed.tags || parsed.suggestions || parsed.categories || [];
    return list
      .map(normalizeFolderName)
      .filter((f) => f.length > 0);
  };
  try {
    return tryParse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match && match[0] !== cleaned) {
      try { return tryParse(match[0]); } catch { /* fall through */ }
    }
    return [];
  }
}

/**
 * Inspect a response that produced no tags and return a short reason why.
 * Returned reason fits in a status bar (≈80 chars).
 * @param {string} llmResponse
 * @returns {string}
 */
export function diagnoseEmptyFolders(llmResponse) {
  const raw = (llmResponse || "").trim();
  if (raw.length === 0) return "AI returned an empty response.";

  let cleaned = raw;
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }
  const jsonText = (() => {
    try { JSON.parse(cleaned); return cleaned; } catch { /* try extract */ }
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) { try { JSON.parse(m[0]); return m[0]; } catch { /* nope */ } }
    return null;
  })();

  if (!jsonText) {
    const preview = raw.slice(0, 80).replace(/\s+/g, " ");
    return `AI didn't return JSON. Got: "${preview}${raw.length > 80 ? "…" : ""}"`;
  }

  const parsed = JSON.parse(jsonText);
  const list = parsed.folders ?? parsed.tags ?? parsed.suggestions ?? parsed.categories;
  if (list === undefined) {
    const keys = Object.keys(parsed).slice(0, 3).join(", ") || "(empty)";
    return `AI's JSON had no "folders" field. Keys: ${keys}.`;
  }
  if (!Array.isArray(list)) return `AI's "folders" wasn't a list (got ${typeof list}).`;
  if (list.length === 0) return "AI returned an empty folder list.";
  return "AI's folder names were all invalid (empty or unparseable).";
}

/**
 * Build a refinement prompt for when the user wants to adjust folder suggestions.
 * @param {string[]} currentFolders
 * @param {string} userRequest — natural language request
 * @param {object[]} samples — from buildSample()
 * @returns {string}
 */
export function buildRefinementPrompt(currentFolders, userRequest, samples) {
  const emailList = samples
    .slice(0, 30)
    .map((s, i) => `${i + 1}. Subject: ${s.subject}\n   From: ${s.sender}`)
    .join("\n");

  return `You are an email organization expert. The user has these folders: ${currentFolders.join(", ")}

They want to change them: "${userRequest}"

Sample emails from their inbox:
${emailList}

Rules:
- Each folder name is ONE word, capitalized (e.g., "Finance", "Shopping").
- Folders are mutually exclusive buckets.
- Return the COMPLETE updated folder list (not just changes).

Respond with ONLY a JSON object: {"folders": ["Folder1", "Folder2", ...]}`;
}
