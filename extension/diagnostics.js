/**
 * Diagnostics module — template-based, zero-cost email classification explanations.
 * No LLM calls. Returns human-readable reasons why an email was (or wasn't) tagged.
 *
 * The background script passes pre-resolved results from each classification tier.
 * This module interprets them into plain-language explanations.
 */

/**
 * @param {object} info
 * @param {string[]} info.headerTags       — tags resolved from email headers (may be null/empty)
 * @param {string[]} info.senderCacheTags  — tags resolved from sender cache (may be null/empty)
 * @param {string[]} info.llmTags          — tags resolved from LLM that matched allowed list (may be null/empty)
 * @param {string[]} info.llmResult        — raw tags from LLM before filtering (may be null/empty)
 * @param {string[]} info.allowedTags      — currently configured tag list
 * @param {string[]} info.existingTags     — tags already on the message before classification
 * @param {string}   info.providerError    — error message if LLM call failed (may be null)
 * @returns {{ tier: string, tags: string[], reason: string, suggestions: string[] }}
 */
export function explain(info) {
  const {
    headerTags,
    senderCacheTags,
    llmTags,
    llmResult,
    allowedTags = [],
    existingTags = [],
    providerError,
  } = info || {};

  // 1. Already tagged
  if (existingTags && existingTags.length > 0) {
    return {
      tier: "already-tagged",
      tags: existingTags,
      reason: `This email already has tags: ${existingTags.join(", ")}.`,
      suggestions: [],
    };
  }

  // 2. Provider error
  if (providerError) {
    return {
      tier: "error",
      tags: [],
      reason: `Classification failed: ${providerError}`,
      suggestions: [
        "Check that your AI provider is configured in Settings.",
        "Make sure your API key is valid and has credit.",
      ],
    };
  }

  // 3. Headers matched
  if (headerTags && headerTags.length > 0) {
    return {
      tier: "headers",
      tags: headerTags,
      reason: `Tagged from email headers (no AI needed): ${headerTags.join(", ")}.`,
      suggestions: [],
    };
  }

  // 4. Sender cache matched
  if (senderCacheTags && senderCacheTags.length > 0) {
    return {
      tier: "sender-cache",
      tags: senderCacheTags,
      reason: `Tagged from a recognized sender (no AI needed): ${senderCacheTags.join(", ")}.`,
      suggestions: [],
    };
  }

  // 5. LLM returned matching tags
  if (llmTags && llmTags.length > 0) {
    return {
      tier: "llm",
      tags: llmTags,
      reason: `The AI classified this email as: ${llmTags.join(", ")}.`,
      suggestions: [],
    };
  }

  // 6. LLM returned tags but none matched allowed list
  if (llmResult && llmResult.length > 0) {
    const lowerAllowed = allowedTags.map((a) => a.toLowerCase());
    const matched = llmResult.filter((t) => lowerAllowed.includes(t.toLowerCase()));
    if (matched.length === 0) {
      return {
        tier: "llm",
        tags: [],
        reason: `The AI suggested "${llmResult.join(", ")}" but none of those are in your tag list.`,
        suggestions: [
          `Add "${llmResult[0]}" to your tags in Settings, or use "Analyze Inbox" to discover better tags.`,
        ],
      };
    }
  }

  // 7. LLM returned empty
  if (llmResult !== null && llmResult !== undefined && llmResult.length === 0) {
    return {
      tier: "llm",
      tags: [],
      reason: "The AI reviewed this email but could not confidently assign any of your tags.",
      suggestions: [
        "Your current tags may not cover this type of email.",
        'Try "Analyze Inbox" in Settings to discover tags that fit your mail.',
      ],
    };
  }

  // 8. No data at all — no provider configured
  if (!headerTags && !senderCacheTags && !llmTags && !llmResult) {
    return {
      tier: "skipped",
      tags: [],
      reason: "No AI provider is configured, so this email was not classified.",
      suggestions: ["Open Settings and set up an AI provider."],
    };
  }

  // 9. Fallthrough
  return {
    tier: "unknown",
    tags: [],
    reason: "No classification data is available for this email.",
    suggestions: ["Try classifying the email again from the right-click menu."],
  };
}
