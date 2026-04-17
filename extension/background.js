import {
  TAG_PREFIX,
  TAG_COLORS,
  DEFAULT_FOLDERS,
  BATCH_SIZE,
  RETRY_INTERVAL_MS,
  BUILTIN_PROVIDERS,
  SKIP_FOLDER_TYPES,
  normalizeSender,
  classifyFromHeaders,
  isSensitiveEmail,
} from "./common.js";

import { explain } from "./diagnostics.js";

import * as gemini from "./providers/gemini.js";
import * as openai from "./providers/openai.js";
import * as anthropic from "./providers/anthropic.js";

const providers = { gemini, openai, anthropic };

let cancelRequested = false;
let classifiedCount = 0;

// --- Badge indicator ---

async function updateBadge() {
  const provider = await getActiveProvider();
  const consented = await hasConsent();

  if (!provider) {
    messenger.action.setBadgeText({ text: "!" });
    messenger.action.setBadgeBackgroundColor({ color: "#e65100" });
    messenger.action.setTitle({ title: "Thundersorter — click to set up" });
    return;
  }

  if (!consented) {
    messenger.action.setBadgeText({ text: "!" });
    messenger.action.setBadgeBackgroundColor({ color: "#e65100" });
    messenger.action.setTitle({ title: "Thundersorter — consent needed" });
    return;
  }

  const label = BUILTIN_PROVIDERS[provider.name]?.label || provider.name;
  if (classifiedCount > 0) {
    messenger.action.setBadgeText({ text: String(classifiedCount) });
    messenger.action.setBadgeBackgroundColor({ color: "#2e7d32" });
    messenger.action.setTitle({ title: `Thundersorter — ${classifiedCount} sorted (${label})` });
  } else {
    messenger.action.setBadgeText({ text: "\u2713" });
    messenger.action.setBadgeBackgroundColor({ color: "#2e7d32" });
    messenger.action.setTitle({ title: `Thundersorter — active (${label})` });
  }
}

// --- Diagnostic state (last classification result per message, for "Why this tag?" popup) ---
// Stores the most recent diagnostic info keyed by message ID. Capped to prevent memory growth.
const DIAG_CACHE_MAX = 100;
const diagCache = new Map();

function storeDiagnostic(messageId, info) {
  diagCache.set(messageId, info);
  if (diagCache.size > DIAG_CACHE_MAX) {
    // Delete the oldest entry
    const oldest = diagCache.keys().next().value;
    diagCache.delete(oldest);
  }
}

// Pending diagnostic requests keyed by nonce (multi-popup safe)
const pendingDiagnostics = new Map();

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

async function getCustomFolders() {
  const { customFolders } = await messenger.storage.local.get({ customFolders: null });
  return customFolders || DEFAULT_FOLDERS;
}

// --- Folder routing ---

// Cache of created folders: folderName → folderId
const FOLDER_CACHE_MAX = 200;
const folderIdCache = new Map();
const folderCreationPending = new Map();

function isValidFolderSegment(segment) {
  if (!segment || segment === "." || segment === "..") return false;
  if (/[\x00-\x1f]/.test(segment)) return false;
  return segment.trim().length > 0;
}

async function ensureFolderExists(account, folderName) {
  const cacheKey = `${account.id}:${folderName}`;
  if (folderIdCache.has(cacheKey)) return folderIdCache.get(cacheKey);
  if (folderCreationPending.has(cacheKey)) return folderCreationPending.get(cacheKey);

  const promise = createFolderPath(account, folderName, cacheKey);
  folderCreationPending.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    folderCreationPending.delete(cacheKey);
  }
}

async function createFolderPath(account, folderName, cacheKey) {
  // Validate all path segments before creating anything
  const parts = folderName.split("/");
  for (const part of parts) {
    if (!isValidFolderSegment(part)) return null;
  }

  // Find inbox folder (getSubFolders takes a MailFolderId string in MV3)
  const rootFolders = await messenger.folders.getSubFolders(account.rootFolder.id);
  const inbox = rootFolders.find((f) => f.specialUse?.includes("inbox"));
  if (!inbox) return null;

  // Handle nested paths (e.g., "Sorted/Finance")
  let parent = inbox;
  for (const part of parts) {
    const subfolders = await messenger.folders.getSubFolders(parent.id);
    const existing = subfolders.find((f) => f.name === part);
    if (existing) {
      parent = existing;
    } else {
      parent = await messenger.folders.create(parent.id, part);
    }
  }

  folderIdCache.set(cacheKey, parent);
  if (folderIdCache.size > FOLDER_CACHE_MAX) {
    const oldest = folderIdCache.keys().next().value;
    folderIdCache.delete(oldest);
  }
  return parent;
}

async function routeMessageToFolder(message, folderName) {
  if (!folderName) return;

  try {
    // Use message.folder if available, otherwise fetch it
    const msgFolder = message.folder || (await messenger.messages.get(message.id)).folder;
    if (!msgFolder) return;

    const accounts = await messenger.accounts.list();
    const account = accounts.find((a) => a.id === msgFolder.accountId);
    if (!account) return;

    const targetFolder = await ensureFolderExists(account, folderName);
    if (!targetFolder) return;

    markSelfMove(message.id);
    await messenger.messages.move([message.id], targetFolder.id);
    console.log(`Thundersorter: moved message ${message.id} to ${folderName}`);
  } catch (err) {
    console.warn(`Thundersorter: folder routing failed for ${message.id}:`, err.message);
  }
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
  // Entry shape: { folder, count, lastSeen }
  return entry.folder ? { folder: entry.folder } : null;
}

async function updateSenderCache(sender, folder) {
  if (!folder) return;
  const cache = await getSenderCache();
  const key = normalizeSender(sender);
  const existing = cache[key];

  const updated = existing && existing.folder === folder
    ? { folder, count: existing.count + 1, lastSeen: Date.now() }
    : { folder, count: 1, lastSeen: Date.now() };

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

async function applyClassification(message, folder, flags, diagInfo) {
  if (flags && flags.length > 0) {
    await applyTags(message, flags);
  }
  if (folder) {
    await updateSenderCache(message.author || "", folder);
    await routeMessageToFolder(message, folder);
  }
  classifiedCount++;
  updateBadge();
  diagInfo.folder = folder;
  diagInfo.flags = flags || [];
  storeDiagnostic(message.id, diagInfo);
}

async function classifyMessage(message) {
  if (hasThundersorterTags(message)) return;
  if (classifyingNow.has(message.id)) return;

  if (!(await hasConsent())) return;

  classifyingNow.add(message.id);
  const diagInfo = { allowedFolders: [], existingTags: [] };

  try {
    const allowedFolders = await getCustomFolders();
    diagInfo.allowedFolders = allowedFolders;

    // Tier 0: Header-based pre-classification (zero API cost)
    try {
      const headers = await getMessageHeaders(message.id);
      const headerFolder = classifyFromHeaders(headers);
      if (headerFolder && allowedFolders.includes(headerFolder)) {
        diagInfo.headerFolder = headerFolder;
        await applyClassification(message, headerFolder, [], diagInfo);
        console.log(`Thundersorter: routed message ${message.id} via headers → ${headerFolder}`);
        return;
      }
    } catch (err) {
      console.debug(`Thundersorter: header scan failed for ${message.id}:`, err.message);
    }

    // Tier 1: Sender cache lookup (zero API cost)
    const cached = await lookupSenderCache(message.author || "");
    if (cached && allowedFolders.includes(cached.folder)) {
      diagInfo.senderCacheFolder = cached.folder;
      await applyClassification(message, cached.folder, [], diagInfo);
      console.log(`Thundersorter: routed message ${message.id} via sender cache → ${cached.folder}`);
      return;
    }

    // Tier 2+3: LLM classification (API cost)
    const provider = await getActiveProvider();
    if (!provider) {
      console.warn("Thundersorter: no provider configured");
      storeDiagnostic(message.id, diagInfo);
      return;
    }

    const body = await extractBody(message.id);

    // Security gate: never send password resets, verification codes, etc. to an LLM
    if (isSensitiveEmail(message.subject, body)) {
      diagInfo.skippedReason = "sensitive (password/token/verification)";
      const safeFolder = allowedFolders.includes("Notifications") ? "Notifications" : "";
      await applyClassification(message, safeFolder, [], diagInfo);
      console.log(`Thundersorter: skipped LLM for sensitive message ${message.id}`);
      return;
    }

    const { folder, flags } = await provider.mod.classify(
      provider.config,
      message.subject || "",
      message.author || "",
      body,
      allowedFolders,
    );

    diagInfo.llmFolder = folder;
    diagInfo.llmFlags = flags || [];

    if (!folder && (!flags || flags.length === 0)) {
      storeDiagnostic(message.id, diagInfo);
      return;
    }

    await applyClassification(message, folder, flags, diagInfo);
    console.log(`Thundersorter: sorted ${message.id} → ${folder || "(no folder)"} flags=[${(flags || []).join(",")}]`);
  } catch (err) {
    diagInfo.providerError = err.message;
    storeDiagnostic(message.id, diagInfo);
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

function sendProgress(windowId, processed, total, tagged, currentSubject, tier) {
  messenger.runtime.sendMessage({
    type: "classify-progress",
    processed,
    total,
    tagged,
    currentSubject,
    tier: tier || "",
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
    return;
  }
  if (msg.type === "request-diagnostic" && msg.nonce) {
    const data = pendingDiagnostics.get(msg.nonce);
    if (data) {
      pendingDiagnostics.delete(msg.nonce);
      return Promise.resolve(data);
    }
  }
});

// --- Batch classification with progress ---

// Tunables for batched LLM classification.
// BATCH_SIZE: emails per API call. Keep small enough that a 4k-char-capped
//             body × N fits comfortably in a single request.
// CONCURRENCY: number of in-flight batches. Anthropic/Gemini/OpenAI free/paid
//             tiers all tolerate 4 concurrent requests without rate-limiting.
const LLM_BATCH_SIZE = 10;
const LLM_CONCURRENCY = 4;

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
  const allowedFolders = await getCustomFolders();

  const untagged = messages.filter((m) => !hasThundersorterTags(m));
  const total = untagged.length;

  if (total === 0) {
    sendDone(windowId, 0, 0, false);
    return 0;
  }

  let processed = 0;
  let tagged = 0;

  sendProgress(windowId, 0, total, 0, "");

  // ──────────────────────────────────────────────────────────────────
  // Phase 1: local tiers (headers + sender cache + security filter).
  // No API calls. Each message ends up with either a resolved folder
  // or flagged `needsLLM: true`, in which case we've already extracted
  // its body so Phase 2 can send it to the provider.
  // ──────────────────────────────────────────────────────────────────
  const resolutions = [];
  for (const msg of untagged) {
    if (cancelRequested) {
      sendDone(windowId, total, tagged, true);
      return tagged;
    }

    const diagInfo = { allowedFolders };
    let tier = "";
    let folder = "";
    let flags = [];
    let needsLLM = false;
    let body = "";

    try {
      try {
        const headers = await getMessageHeaders(msg.id);
        const headerFolder = classifyFromHeaders(headers);
        if (headerFolder && allowedFolders.includes(headerFolder)) {
          folder = headerFolder;
          tier = "headers";
          diagInfo.headerFolder = folder;
        }
      } catch (_) { /* header scan failed, continue */ }

      if (!folder) {
        const cached = await lookupSenderCache(msg.author || "");
        if (cached && allowedFolders.includes(cached.folder)) {
          folder = cached.folder;
          tier = "sender-cache";
          diagInfo.senderCacheFolder = folder;
        }
      }

      if (!folder) {
        body = await extractBody(msg.id);
        if (isSensitiveEmail(msg.subject, body)) {
          tier = "security-filter";
          diagInfo.skippedReason = "sensitive (password/token/verification)";
          if (allowedFolders.includes("Notifications")) folder = "Notifications";
        } else {
          needsLLM = true;
        }
      }
    } catch (err) {
      diagInfo.phase1Error = err.message;
    }

    resolutions.push({ msg, diagInfo, folder, flags, tier, needsLLM, body });
  }

  // ──────────────────────────────────────────────────────────────────
  // Phase 2: batched, concurrent LLM classification.
  // Messages are grouped into batches of LLM_BATCH_SIZE; up to
  // LLM_CONCURRENCY batches are in flight at once. One batch failure
  // is isolated to its own messages (retry-queued in Phase 3).
  // ──────────────────────────────────────────────────────────────────
  const llmItems = resolutions.filter((r) => r.needsLLM);
  if (llmItems.length > 0) {
    const batches = [];
    for (let i = 0; i < llmItems.length; i += LLM_BATCH_SIZE) {
      batches.push(llmItems.slice(i, i + LLM_BATCH_SIZE));
    }

    let llmDone = 0;
    const phase1Done = resolutions.length - llmItems.length;
    // Report "we're starting AI classification for N emails".
    sendProgress(windowId, phase1Done, total, tagged, `Classifying ${llmItems.length} via AI…`, "llm");

    for (let i = 0; i < batches.length; i += LLM_CONCURRENCY) {
      if (cancelRequested) break;

      const slice = batches.slice(i, i + LLM_CONCURRENCY);
      const settled = await Promise.allSettled(
        slice.map((batch) =>
          provider.mod.classifyBatch(
            provider.config,
            batch.map((item) => ({
              subject: item.msg.subject || "",
              sender: item.msg.author || "",
              body: item.body,
            })),
            allowedFolders,
          ),
        ),
      );

      for (let bi = 0; bi < slice.length; bi++) {
        const batch = slice[bi];
        const res = settled[bi];
        if (res.status === "fulfilled") {
          const batchResults = res.value || [];
          for (let ei = 0; ei < batch.length; ei++) {
            const item = batch[ei];
            const r = batchResults[ei];
            if (r) {
              item.folder = r.folder;
              item.flags = r.flags || [];
              item.tier = "llm";
              item.diagInfo.llmFolder = r.folder;
              item.diagInfo.llmFlags = r.flags || [];
            } else {
              item.diagInfo.providerError = "missing result in batch";
            }
          }
        } else {
          const errMsg = res.reason?.message || String(res.reason);
          console.warn(`Thundersorter: batch classify failed:`, errMsg);
          for (const item of batch) {
            item.diagInfo.providerError = errMsg;
          }
        }
        llmDone += batch.length;
      }

      sendProgress(windowId, phase1Done + llmDone, total, tagged, `Classifying ${llmItems.length} via AI…`, "llm");
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Phase 3: apply tags + route + update sender cache. Sequential to
  // avoid flooding the Thunderbird API with concurrent writes.
  // ──────────────────────────────────────────────────────────────────
  for (const r of resolutions) {
    if (cancelRequested) {
      sendDone(windowId, total, tagged, true);
      return tagged;
    }

    storeDiagnostic(r.msg.id, r.diagInfo);

    if (r.diagInfo.providerError) {
      console.warn(`Thundersorter: classify failed for ${r.msg.id}: ${r.diagInfo.providerError}`);
      await addToRetryQueue(r.msg.id);
      processed++;
      sendProgress(windowId, processed, total, tagged, "", r.tier);
      continue;
    }

    sendProgress(windowId, processed, total, tagged, r.msg.subject || "");

    try {
      if (r.folder || r.flags.length > 0) {
        if (r.flags.length > 0) await applyTags(r.msg, r.flags);
        if (r.folder) {
          await updateSenderCache(r.msg.author || "", r.folder);
          await routeMessageToFolder(r.msg, r.folder);
        }
        tagged++;
        classifiedCount++;
      }
    } catch (err) {
      r.diagInfo.applyError = err.message;
      storeDiagnostic(r.msg.id, r.diagInfo);
      console.warn(`Thundersorter: apply failed for ${r.msg.id}:`, err.message);
    }

    processed++;
    sendProgress(windowId, processed, total, tagged, "", r.tier);
  }

  sendDone(windowId, total, tagged, false);
  updateBadge();
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
  let page = await messenger.messages.list(folder.id);
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

messenger.menus.create({
  id: "thundersorter-why",
  title: "Why this tag?",
  contexts: ["message_list"],
});

messenger.menus.onClicked.addListener(async (info) => {
  if (info.menuItemId === "thundersorter-classify") {
    if (!info.selectedMessages || info.selectedMessages.messages.length === 0) return;

    let page = info.selectedMessages;
    const allMessages = [...page.messages];
    while (page.id) {
      page = await messenger.messages.continueList(page.id);
      allMessages.push(...page.messages);
    }

    await classifyBatchWithProgress(allMessages);
    return;
  }

  if (info.menuItemId === "thundersorter-why") {
    if (!info.selectedMessages || info.selectedMessages.messages.length === 0) return;

    const message = info.selectedMessages.messages[0];
    await openDiagnosticPopup(message);
  }
});

// --- Diagnostic popup ---

async function openDiagnosticPopup(message) {
  // Look up cached diagnostic, or build one from current state
  let diagInfo = diagCache.get(message.id);
  if (!diagInfo) {
    const allowedFolders = await getCustomFolders();
    const existingTsTags = (message.tags || [])
      .filter((t) => t.startsWith(TAG_PREFIX))
      .map((t) => t.slice(TAG_PREFIX.length));

    diagInfo = { allowedFolders, existingTags: existingTsTags };
  }

  const diagnostic = explain(diagInfo);
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  pendingDiagnostics.set(nonce, {
    subject: message.subject || "(no subject)",
    diagnostic,
  });

  await messenger.windows.create({
    url: `diagnostics/diagnostics.html?nonce=${nonce}`,
    type: "popup",
    width: 420,
    height: 300,
  });
}

// --- Toolbar action (classify current folder) ---

messenger.action.onClicked.addListener(async (tab) => {
  await classifyFolder(tab);
});

// --- New mail listener ---

messenger.messages.onNewMailReceived.addListener(async (folder, messages) => {
  if (folder && folder.specialUse?.some((u) => SKIP_FOLDER_TYPES.includes(u))) return;

  for (const message of messages.messages) {
    try {
      await classifyMessage(message);
    } catch (err) {
      console.error(`Thundersorter: error processing message ${message.id}:`, err.message);
    }
  }
});

// --- User correction listener: when the user moves a message into one of our folders,
// learn that the sender belongs there. Listener only fires for user-initiated moves
// because we track our own recent moves and skip them. ---

const recentSelfMoves = new Set();
const SELF_MOVE_TTL_MS = 5000;

function markSelfMove(messageId) {
  recentSelfMoves.add(messageId);
  setTimeout(() => recentSelfMoves.delete(messageId), SELF_MOVE_TTL_MS);
}

if (messenger.messages.onMoved) {
  messenger.messages.onMoved.addListener(async ({ messages }) => {
    const allowedFolders = await getCustomFolders();
    for (const msg of messages.messages) {
      if (recentSelfMoves.has(msg.id)) continue;
      const folderName = msg.folder?.name;
      if (folderName && allowedFolders.includes(folderName) && msg.author) {
        await updateSenderCache(msg.author, folderName);
        console.log(`Thundersorter: learned "${folderName}" for ${msg.author} from user move`);
      }
    }
  });
}

// Periodic retry queue drain
setInterval(processRetryQueue, RETRY_INTERVAL_MS);

// Update badge when provider or consent changes
messenger.storage.onChanged.addListener((changes) => {
  if (changes.activeProvider || changes.providerConfigs || changes.dataConsentGiven) {
    updateBadge();
  }
});

// Show status on startup
updateBadge();

console.log("Thundersorter: background script loaded");
