import {
  TAG_PREFIX,
  TAG_COLORS,
  DEFAULT_TAGS,
  BATCH_SIZE,
  RETRY_INTERVAL_MS,
  BUILTIN_PROVIDERS,
} from "./common.js";

import * as gemini from "./providers/gemini.js";
import * as openai from "./providers/openai.js";
import * as anthropic from "./providers/anthropic.js";

const providers = { gemini, openai, anthropic };

let cancelRequested = false;

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

async function getRetryQueue() {
  const { retryQueue } = await messenger.storage.local.get({ retryQueue: [] });
  return retryQueue;
}

async function setRetryQueue(queue) {
  await messenger.storage.local.set({ retryQueue: queue });
}

async function addToRetryQueue(messageId) {
  const queue = await getRetryQueue();
  if (!queue.includes(messageId)) {
    await setRetryQueue([...queue, messageId]);
  }
}

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

async function extractBody(messageId) {
  const parts = await messenger.messages.listInlineTextParts(messageId);
  const textParts = parts.filter((p) => p.contentType === "text/plain");
  if (textParts.length > 0) {
    return textParts.map((p) => p.content).join("\n");
  }
  const htmlParts = parts.filter((p) => p.contentType === "text/html");
  if (htmlParts.length > 0) {
    return htmlParts.map((p) => p.content).join("\n");
  }
  return "";
}

// --- Classification ---

async function classifyMessage(message) {
  if (hasThundersorterTags(message)) return;

  const provider = await getActiveProvider();
  if (!provider) {
    console.warn("Thundersorter: no provider configured");
    return;
  }

  const tags = await getCustomTags();
  const body = await extractBody(message.id);

  let resultTags;
  try {
    resultTags = await provider.mod.classify(
      provider.config,
      message.subject || "",
      message.author || "",
      body,
      tags,
    );
  } catch (err) {
    console.warn(`Thundersorter: classify failed, queuing message ${message.id}:`, err.message);
    await addToRetryQueue(message.id);
    return;
  }

  if (!resultTags || resultTags.length === 0) return;

  await applyTags(message, resultTags);
  console.log(`Thundersorter: tagged "${message.subject}" with [${resultTags.join(", ")}]`);
}

// --- Retry queue processing ---

async function processRetryQueue() {
  const queue = await getRetryQueue();
  if (queue.length === 0) return;

  const provider = await getActiveProvider();
  if (!provider) return;

  console.log(`Thundersorter: retrying ${queue.length} queued message(s)`);
  const remaining = [];

  for (const messageId of queue) {
    try {
      const message = await messenger.messages.get(messageId);
      if (hasThundersorterTags(message)) continue;
      await classifyMessage(message);
    } catch (err) {
      console.warn(`Thundersorter: retry failed for message ${messageId}:`, err);
      remaining.push(messageId);
    }
  }

  await setRetryQueue(remaining);
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

  const provider = await getActiveProvider();
  if (!provider) {
    console.warn("Thundersorter: no provider configured");
    return 0;
  }

  const windowId = await openProgressWindow();
  const tags = await getCustomTags();

  const untagged = messages.filter((m) => !hasThundersorterTags(m));
  const total = untagged.length;

  if (total === 0) {
    sendDone(windowId, 0, 0, false);
    return 0;
  }

  let processed = 0;
  let tagged = 0;

  sendProgress(windowId, 0, total, 0, "");

  for (let i = 0; i < untagged.length; i += BATCH_SIZE) {
    if (cancelRequested) {
      console.log("Thundersorter: classification cancelled by user");
      sendDone(windowId, total, tagged, true);
      return tagged;
    }

    const batch = untagged.slice(i, i + BATCH_SIZE);

    sendProgress(windowId, processed, total, tagged, batch[0]?.subject || "");

    const emails = [];
    for (const msg of batch) {
      const body = await extractBody(msg.id);
      emails.push({
        subject: msg.subject || "",
        sender: msg.author || "",
        body,
      });
    }

    try {
      const tagLists = await provider.mod.classifyBatch(provider.config, emails, tags);
      for (let j = 0; j < tagLists.length; j++) {
        if (tagLists[j] && tagLists[j].length > 0) {
          await applyTags(batch[j], tagLists[j]);
          tagged++;
        }
      }
    } catch (err) {
      console.error("Thundersorter: batch classify error:", err.message);
    }

    processed += batch.length;
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

messenger.messages.onNewMailReceived.addListener(async (_folder, messages) => {
  for (const message of messages.messages) {
    try {
      await classifyMessage(message);
    } catch (err) {
      console.error(`Thundersorter: error processing "${message.subject}":`, err);
    }
  }
});

// Periodic retry queue drain
setInterval(processRetryQueue, RETRY_INTERVAL_MS);

console.log("Thundersorter: background script loaded");
