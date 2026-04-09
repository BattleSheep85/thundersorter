/**
 * Inbox analyzer — domain-stratified sampling and LLM-powered tag discovery.
 */

/**
 * Build a representative sample from a list of messages.
 * Uses domain-stratified temporal spread to get diverse coverage.
 * @param {object[]} messages — array of { author, subject, date }
 * @param {number} targetSize — desired sample size (default 75)
 * @returns {object[]} — array of { subject, sender }
 */
export function buildSample(messages, targetSize = 75) {
  if (!messages || messages.length === 0) return [];

  // Group by sender domain
  const byDomain = new Map();
  for (const msg of messages) {
    const sender = (msg.author || "").toLowerCase();
    const domain = sender.includes("@") ? sender.split("@").pop() : "unknown";
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain).push(msg);
  }

  // Take from each domain proportionally, with a minimum of 1
  const domains = [...byDomain.entries()];
  const totalMessages = messages.length;
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
 * Build a prompt for the LLM to discover tag categories from email samples.
 * @param {object[]} samples — from buildSample()
 * @param {string} preset — "home", "business", "minimal", or "custom"
 * @param {number} targetCount — how many tags to suggest (default 10)
 * @returns {string}
 */
export function buildAnalysisPrompt(samples, preset = "home", targetCount = 10) {
  const emailList = samples
    .map((s, i) => `${i + 1}. Subject: ${s.subject}\n   From: ${s.sender}`)
    .join("\n");

  const context = preset === "business"
    ? "This is a work/business email account."
    : preset === "minimal"
      ? "The user wants very few, broad categories."
      : "This is a personal/home email account.";

  return `You are an email organization expert. Analyze these email subjects and senders to suggest ${targetCount} tag categories for automatic classification.

${context}

Rules:
- Each tag must be ONE word (two words max, like "action-required")
- Tags must be broad categories, not specific senders or topics
- Tags should cover the majority of these emails
- Suggest tags in order of usefulness (most useful first)

Here are sample emails from the inbox:
${emailList}

Respond with ONLY a JSON object: {"tags": ["tag1", "tag2", ...]}`;
}

/**
 * Parse tag suggestions from an LLM response.
 * @param {string} llmResponse — raw LLM output
 * @returns {string[]}
 */
export function parseTagSuggestions(llmResponse) {
  let cleaned = llmResponse.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }
  try {
    const parsed = JSON.parse(cleaned);
    const tags = parsed.tags || parsed.suggestions || parsed.categories || [];
    return tags
      .filter((t) => typeof t === "string")
      .map((t) => t.trim().toLowerCase().replace(/[^a-z0-9-]/g, ""))
      .filter((t) => t.length > 0 && t.length <= 30);
  } catch {
    // Try extracting JSON from surrounding text (non-recursive to prevent stack overflow)
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match && match[0] !== cleaned) {
      try {
        const parsed = JSON.parse(match[0]);
        const tags = parsed.tags || parsed.suggestions || parsed.categories || [];
        return tags
          .filter((t) => typeof t === "string")
          .map((t) => t.trim().toLowerCase().replace(/[^a-z0-9-]/g, ""))
          .filter((t) => t.length > 0 && t.length <= 30);
      } catch { /* fall through */ }
    }
    return [];
  }
}

/**
 * Build a refinement prompt for when the user wants to adjust suggestions.
 * @param {string[]} currentTags — current tag list
 * @param {string} userRequest — natural language request
 * @param {object[]} samples — from buildSample()
 * @returns {string}
 */
export function buildRefinementPrompt(currentTags, userRequest, samples) {
  const emailList = samples
    .slice(0, 30)
    .map((s, i) => `${i + 1}. Subject: ${s.subject}\n   From: ${s.sender}`)
    .join("\n");

  return `You are an email organization expert. The user has these tags: ${currentTags.join(", ")}

They want to change them: "${userRequest}"

Sample emails from their inbox:
${emailList}

Rules:
- Each tag must be ONE word (two words max, like "action-required")
- Tags must be broad categories
- Return the COMPLETE updated tag list (not just changes)

Respond with ONLY a JSON object: {"tags": ["tag1", "tag2", ...]}`;
}
