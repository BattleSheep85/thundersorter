import {
  TAG_PREFIX,
  TAG_COLORS,
  DEFAULT_TAGS,
  BATCH_SIZE,
  RETRY_INTERVAL_MS,
  BUILTIN_PROVIDERS,
  SKIP_FOLDER_TYPES,
  normalizeSender,
  classifyFromHeaders,
} from "./common.js";

import * as gemini from "./providers/gemini.js";
import * as openai from "./providers/openai.js";
import * as anthropic from "./providers/anthropic.js";

const providers = { gemini, openai, anthropic };

let cancelRequested = false;

// --- Consent gate ---

async function hasConsent() {
  const { dataConsentGiven } = await messenger.storage.local.get({ dataConsentGiven: false });
  return dataConsentGiven === true;
}

async function showConsentPage() {
  await messenger.tabs.create({ url: "consent/consent.html" });
}

// Show consent screen on first install or update that adds consent requirement
messenger.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install" || details.reason === "update") {
    const consented = await hasConsent();
    if (!consented) {
      await showConsentPage();
    }
  }
});

// --- Storage helpers ---

async function getActiveProvider() {
  const { activeProvider, providerConfigs } = await messenger.storage.local.get({
    activeProvider: "",
    providerConfigs: {},
  });

  if (!activeProvider || !providerConfigs[activeProvider]) {
    return null;
  }

  const stored = providerConfigs[activeProvider];
  const builtin = BUILTIN_PROVIDERS[activeProvider];
  const kind = stored.kind || builtin?.kind || activeProvider;
  const mod = providers[kind];
  if (!mod) return null;

  // Merge baseUrl from builtin definition if not in stored config
  const config = {
    ...stored,
    baseUrl: stored.baseUrl || builtin?.baseUrl || "",
  };

  return { name: activeProvider, kind, config, mod };
}

async function getCustomTags() {
  const { customTags } = await messenger.storage.local.get({ customTags: null });
  return customTags || DEFAULT_TAGS;
}

const MAX_RETRY_QUEUE = 200;

async function getRetryQueue() {
  const { retryQueue } = await messenger.storage.local.get({ retryQueue: [] });
  return retryQueue;
}

async function setRetryQueue(queue) {
  await messenger.storage.local.set({ retryQueue: queue });
}

async function addToRetryQueue(messageId) {
  const queue = await getRetryQueue();
  if (queue.includes(messageId)) return;
  // Cap queue size to prevent unbounded growth
  const updated = [...queue, messageId].slice(-MAX_RETRY_QUEUE);
  await setRetryQueue(updated);
}

// --- Sender cache ---

const SENDER_CACHE_KEY = "senderCache";
const SENDER_CACHE_MAX = 500;
const SENDER_CACHE_HIT_THRESHOLD = 2;

async function getSenderCache() {
  const { senderCache } = await messenger.storage.local.get({ [SENDER_CACHE_KEY]: {} });
  return senderCache;
}

async function lookupSenderCache(sender) {
  const cache = await getSenderCache();
  const key = normalizeSender(sender);
  const entry = cache[key];
  if (!entry || entry.count < SENDER_CACHE_HIT_THRESHOLD) return null;
  return entry.tags;
}

async function updateSenderCache(sender, tags) {
  if (!tags || tags.length === 0) return;
  const cache = await getSenderCache();
  const key = normalizeSender(sender);
  const existing = cache[key];

  const updated = existing
    ? { tags: [...new Set([...existing.tags, ...tags])], count: existing.count + 1, lastSeen: Date.now() }
    : { tags: [...tags], count: 1, lastSeen: Date.now() };

  const newCache = { ...cache, [key]: updated };

  const entries = Object.entries(newCache);
  if (entries.length > SENDER_CACHE_MAX) {
    entries.sort((a, b) => a[1].lastSeen - b[1].lastSeen);
    await messenger.storage.local.set({ [SENDER_CACHE_KEY]: Object.fromEntries(entries.slice(-SENDER_CACHE_MAX)) });
  } else {
    await messenger.storage.local.set({ [SENDER_CACHE_KEY]: newCache });
  }
}

// --- Header scanning ---

async function getMessageHeaders(messageId) {
  if (messenger.messages.getHeaders) {
    return messenger.messages.getHeaders(messageId);
  }
  const full = await messenger.messages.getFull(messageId);
  return full.headers || {};
}

// --- Deduplication: prevent classifying the same message concurrently ---

const classifyingNow = new Set();

// --- Tag helpers ---

function hasThundersorterTags(message) {
  return (message.tags || []).some((key) => key.startsWith(TAG_PREFIX));
}

async function ensureTagExists(tagKey) {
  const existing = await messenger.messages.tags.list();
  const fullKey = `${TAG_PREFIX}${tagKey}`;
  const found = existing.find((t) => t.key === fullKey);
  if (found) return found.key;

  const color = TAG_COLORS[tagKey] || "#607D8B";
  const key = await messenger.messages.tags.create(fullKey, `TS: ${tagKey}`, color);
  return key;
}

async function applyTags(message, tags) {
  const currentTags = message.tags || [];
  const newTagKeys = [];
  for (const tag of tags) {
    const key = await ensureTagExists(tag);
    newTagKeys.push(key);
  }

  const mergedTags = [...new Set([...currentTags, ...newTagKeys])];
  await messenger.messages.update(message.id, { tags: mergedTags });
}

// --- Body extraction ---

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#?\w+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function extractBody(messageId) {
  const parts = await messenger.messages.listInlineTextParts(messageId);
  const textParts = parts.filter((p) => p.contentType === "text/plain");
  if (textParts.length > 0) {
    return textParts.map((p) => p.content).join("\n");
  }
  const htmlParts = parts.filter((p) => p.contentType === "text/html");
  if (htmlParts.length > 0) {
    // Strip HTML to plain text before sending to LLM
    return stripHtml(htmlParts.map((p) => p.content).join("\n"));
  }
  return "";
}

// --- Classification ---

async function classifyMessage(message) {
  if (hasThundersorterTags(message)) return;
  if (classifyingNow.has(message.id)) return;

  if (!(await hasConsent())) return;

  classifyingNow.add(message.id);
  try {
    const allowedTags = await getCustomTags();

    // Tier 0: Header-based pre-classification (zero API cost)
    try {
      const headers = await getMessageHeaders(message.id);
      const headerTags = classifyFromHeaders(headers).filter((t) => allowedTags.includes(t));
      if (headerTags.length > 0) {
        await applyTags(message, headerTags);
        await updateSenderCache(message.author || "", headerTags);
        console.log(`Thundersorter: tagged message ${message.id} via headers [${headerTags.join(", ")}]`);
        return;
      }
    } catch (err) {
      // Header scan failed (e.g., message deleted) — continue to next tier
      console.debug(`Thundersorter: header scan failed for ${message.id}:`, err.message);
    }

    // Tier 1: Sender cache lookup (zero API cost)
    const cachedTags = await lookupSenderCache(message.author || "");
    if (cachedTags && cachedTags.length > 0) {
      const validCached = cachedTags.filter((t) => allowedTags.includes(t));
      if (validCached.length > 0) {
        await applyTags(message, validCached);
        console.log(`Thundersorter: tagged message ${message.id} via sender cache [${validCached.join(", ")}]`);
        return;
      }
    }

    // Tier 2+3: LLM classification (API cost)
    const provider = await getActiveProvider();
    if (!provider) {
      console.warn("Thundersorter: no provider configured");
      return;
    }

    const body = await extractBody(message.id);

    const resultTags = await provider.mod.classify(
      provider.config,
      message.subject || "",
      message.author || "",
      body,
      allowedTags,
    );

    if (!resultTags || resultTags.length === 0) return;

    await applyTags(message, resultTags);
    await updateSenderCache(message.author || "", resultTags);
    console.log(`Thundersorter: tagged message ${message.id} with [${resultTags.join(", ")}]`);
  } catch (err) {
    console.warn(`Thundersorter: classify failed, queuing message ${message.id}:`, err.message);
    await addToRetryQueue(message.id);
  } finally {
    classifyingNow.delete(message.id);
  }
}

// --- Retry queue processing ---

let retryInProgress = false;

async function processRetryQueue() {
  if (retryInProgress) return;
  if (!(await hasConsent())) return;

  const queue = await getRetryQueue();
  if (queue.length === 0) return;

  const provider = await getActiveProvider();
  if (!provider) return;

  retryInProgress = true;
  try {
    console.log(`Thundersorter: retrying ${queue.length} queued message(s)`);
    const remaining = [];

    for (const messageId of queue) {
      try {
        const message = await messenger.messages.get(messageId);
        if (hasThundersorterTags(message)) continue;
        await classifyMessage(message);
      } catch (err) {
        console.warn(`Thundersorter: retry failed for message ${messageId}:`, err.message);
        remaining.push(messageId);
      }
    }

    await setRetryQueue(remaining);
  } finally {
    retryInProgress = false;
  }
}

// --- Progress window ---

async function openProgressWindow() {
  const win = await messenger.windows.create({
    url: "progress/progress.html",
    type: "popup",
    width: 420,
    height: 240,
  });
  return win.id;
}

function sendProgress(windowId, processed, total, tagged, currentSubject) {
  messenger.runtime.sendMessage({
    type: "classify-progress",
    processed,
    total,
    tagged,
    currentSubject,
  }).catch(() => {});
}

function sendDone(windowId, total, tagged, cancelled) {
  messenger.runtime.sendMessage({
    type: "classify-done",
    total,
    tagged,
    cancelled,
  }).catch(() => {});
}

// --- Cancel listener ---

messenger.runtime.onMessage.addListener((msg) => {
  if (msg.type === "cancel-classify") {
    cancelRequested = true;
  }
});

// --- Batch classification with progress ---

async function classifyBatchWithProgress(messages) {
  cancelRequested = false;

  if (!(await hasConsent())) {
    console.warn("Thundersorter: data consent not given, opening consent page");
    await showConsentPage();
    return 0;
  }

  const provider = await getActiveProvider();
  if (!provider) {
    console.warn("Thundersorter: no provider configured");
    return 0;
  }

  const windowId = await openProgressWindow();
  const allowedTags = await getCustomTags();

  const untagged = messages.filter((m) => !hasThundersorterTags(m));
  const total = untagged.length;

  if (total === 0) {
    sendDone(windowId, 0, 0, false);
    return 0;
  }

  let processed = 0;
  let tagged = 0;

  sendProgress(windowId, 0, total, 0, "");

  for (const msg of untagged) {
    if (cancelRequested) {
      console.log("Thundersorter: classification cancelled by user");
      sendDone(windowId, total, tagged, true);
      return tagged;
    }

    sendProgress(windowId, processed, total, tagged, msg.subject || "");

    try {
      // Tier 0: Header-based pre-classification
      let resultTags = null;
      try {
        const headers = await getMessageHeaders(msg.id);
        const headerTags = classifyFromHeaders(headers).filter((t) => allowedTags.includes(t));
        if (headerTags.length > 0) resultTags = headerTags;
      } catch (_) { /* header scan failed, continue */ }

      // Tier 1: Sender cache
      if (!resultTags) {
        const cached = await lookupSenderCache(msg.author || "");
        if (cached && cached.length > 0) {
          const valid = cached.filter((t) => allowedTags.includes(t));
          if (valid.length > 0) resultTags = valid;
        }
      }

      // Tier 2: LLM classification (individual call)
      if (!resultTags) {
        const body = await extractBody(msg.id);
        const llmTags = await provider.mod.classify(
          provider.config,
          msg.subject || "",
          msg.author || "",
          body,
          allowedTags,
        );
        if (llmTags && llmTags.length > 0) resultTags = llmTags;
      }

      if (resultTags && resultTags.length > 0) {
        await applyTags(msg, resultTags);
        await updateSenderCache(msg.author || "", resultTags);
        tagged++;
      }
    } catch (err) {
      console.warn(`Thundersorter: classify failed for ${msg.id}:`, err.message);
      await addToRetryQueue(msg.id);
    }

    processed++;
    sendProgress(windowId, processed, total, tagged, "");
  }

  sendDone(windowId, total, tagged, false);
  console.log(`Thundersorter: classified ${tagged} of ${total} message(s)`);
  return tagged;
}

// --- Folder classification ---

async function classifyFolder(tab) {
  const folder = tab.displayedFolder;
  if (!folder) {
    console.warn("Thundersorter: no folder displayed");
    return;
  }

  if (!(await hasConsent())) {
    await showConsentPage();
    return;
  }

  const provider = await getActiveProvider();
  if (!provider) {
    await messenger.tabs.create({ url: "options/options.html" });
    return;
  }

  console.log(`Thundersorter: classifying folder "${folder.path}"`);
  let page = await messenger.messages.list(folder);
  const allMessages = [...page.messages];
  while (page.id) {
    page = await messenger.messages.continueList(page.id);
    allMessages.push(...page.messages);
  }

  await classifyBatchWithProgress(allMessages);
}

// --- Context menu ---

messenger.menus.create({
  id: "thundersorter-classify",
  title: "Classify with Thundersorter",
  contexts: ["message_list"],
});

messenger.menus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "thundersorter-classify") return;
  if (!info.selectedMessages || info.selectedMessages.messages.length === 0) return;

  let page = info.selectedMessages;
  const allMessages = [...page.messages];
  while (page.id) {
    page = await messenger.messages.continueList(page.id);
    allMessages.push(...page.messages);
  }

  await classifyBatchWithProgress(allMessages);
});

// --- Toolbar action (classify current folder) ---

messenger.action.onClicked.addListener(async (tab) => {
  await classifyFolder(tab);
});

// --- New mail listener ---

messenger.messages.onNewMailReceived.addListener(async (folder, messages) => {
  if (folder && SKIP_FOLDER_TYPES.includes(folder.type)) return;

  for (const message of messages.messages) {
    try {
      await classifyMessage(message);
    } catch (err) {
      console.error(`Thundersorter: error processing message ${message.id}:`, err.message);
    }
  }
});

// --- User correction listener: update sender cache when user changes tags ---

messenger.messages.onUpdated.addListener(async (message, changedProperties) => {
  if (!changedProperties.tags) return;

  const newTsTags = (changedProperties.tags || [])
    .filter((t) => t.startsWith(TAG_PREFIX))
    .map((t) => t.slice(TAG_PREFIX.length));

  // Update sender cache with user's preferred tags
  if (message.author && newTsTags.length > 0) {
    await updateSenderCache(message.author, newTsTags);
    console.log(`Thundersorter: sender cache updated from user correction on ${message.id}`);
  }
});

// Periodic retry queue drain
setInterval(processRetryQueue, RETRY_INTERVAL_MS);

console.log("Thundersorter: background script loaded");
