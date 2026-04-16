/**
 * Diagnostics module — template-based, zero-cost sorting explanations.
 * No LLM calls. Returns human-readable reasons why an email was (or wasn't) sorted.
 */

/**
 * @param {object} info
 * @param {string}   info.headerFolder       — folder resolved from email headers
 * @param {string}   info.senderCacheFolder  — folder resolved from sender cache
 * @param {string}   info.llmFolder          — folder chosen by the LLM
 * @param {string[]} info.llmFlags           — flags returned by the LLM
 * @param {string}   info.skippedReason      — reason this email skipped the LLM
 * @param {string[]} info.allowedFolders     — user's configured folder list
 * @param {string[]} info.existingTags       — flags already on the message
 * @param {string}   info.providerError      — error message if LLM call failed
 * @returns {{ tier: string, folder: string, flags: string[], reason: string, suggestions: string[] }}
 */
export function explain(info) {
  const {
    headerFolder,
    senderCacheFolder,
    llmFolder,
    llmFlags,
    skippedReason,
    allowedFolders = [],
    existingTags = [],
    providerError,
  } = info || {};

  if (providerError) {
    return {
      tier: "error",
      folder: "",
      flags: [],
      reason: `Sorting failed: ${providerError}`,
      suggestions: [
        "Check that your AI provider is configured in Settings.",
        "Make sure your API key is valid and has credit.",
      ],
    };
  }

  if (skippedReason) {
    return {
      tier: "security-filter",
      folder: "Notifications",
      flags: [],
      reason: `Security filter: ${skippedReason}. This email was never sent to the AI.`,
      suggestions: [],
    };
  }

  if (headerFolder) {
    return {
      tier: "headers",
      folder: headerFolder,
      flags: [],
      reason: `Routed to "${headerFolder}" from email headers (no AI needed).`,
      suggestions: [],
    };
  }

  if (senderCacheFolder) {
    return {
      tier: "sender-cache",
      folder: senderCacheFolder,
      flags: [],
      reason: `Routed to "${senderCacheFolder}" because this sender usually lands there (no AI needed).`,
      suggestions: [],
    };
  }

  if (llmFolder) {
    const flagSuffix = llmFlags && llmFlags.length > 0 ? ` with flags: ${llmFlags.join(", ")}` : "";
    return {
      tier: "llm",
      folder: llmFolder,
      flags: llmFlags || [],
      reason: `AI sorted this into "${llmFolder}"${flagSuffix}.`,
      suggestions: [],
    };
  }

  if (existingTags && existingTags.length > 0) {
    return {
      tier: "already-flagged",
      folder: "",
      flags: existingTags,
      reason: `This email already has flags: ${existingTags.join(", ")}.`,
      suggestions: [],
    };
  }

  if (allowedFolders.length === 0) {
    return {
      tier: "skipped",
      folder: "",
      flags: [],
      reason: "No folders are configured, so this email was not sorted.",
      suggestions: ['Open Settings and run "Analyze Inbox" to discover folders.'],
    };
  }

  return {
    tier: "unknown",
    folder: "",
    flags: [],
    reason: "The AI reviewed this email but could not confidently route it into any of your folders.",
    suggestions: [
      "Your current folders may not cover this type of email.",
      'Try "Analyze Inbox" in Settings to discover folders that fit your mail.',
    ],
  };
}
