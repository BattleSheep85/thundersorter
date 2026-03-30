const DEFAULT_SERVICE_URL = "http://127.0.0.1:8465";
const RETRY_INTERVAL_MS = 60_000;
const BATCH_SIZE = 10;
const TAG_PREFIX = "ts_";

const TAG_COLORS = {
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

const DEFAULT_TAGS = Object.keys(TAG_COLORS);

// --- Storage helpers ---

async function getServiceUrl() {
  const { serviceUrl } = await messenger.storage.local.get({ serviceUrl: DEFAULT_SERVICE_URL });
  return serviceUrl;
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

  const serviceUrl = await getServiceUrl();
  const tags = await getCustomTags();
  const body = await extractBody(message.id);

  let response;
  try {
    response = await fetch(`${serviceUrl}/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: message.subject || "",
        sender: message.author || "",
        body: body,
        message_id: String(message.id),
        tags: tags,
      }),
    });
  } catch {
    console.warn(`Thundersorter: service unreachable, queuing message ${message.id}`);
    await addToRetryQueue(message.id);
    return;
  }

  if (!response.ok) {
    console.error(`Thundersorter: classify failed (${response.status})`);
    await addToRetryQueue(message.id);
    return;
  }

  const result = await response.json();
  if (!result.tags || result.tags.length === 0) return;

  await applyTags(message, result.tags);
  console.log(`Thundersorter: tagged "${message.subject}" with [${result.tags.join(", ")}]`);
}

// --- Retry queue processing ---

async function isServiceHealthy() {
  const serviceUrl = await getServiceUrl();
  try {
    const response = await fetch(`${serviceUrl}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function processRetryQueue() {
  const queue = await getRetryQueue();
  if (queue.length === 0) return;

  if (!(await isServiceHealthy())) return;

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

// --- Batch classification ---

async function classifyBatch(messages) {
  const serviceUrl = await getServiceUrl();
  const tags = await getCustomTags();

  const untagged = messages.filter((m) => !hasThundersorterTags(m));
  if (untagged.length === 0) return 0;

  let classified = 0;
  for (let i = 0; i < untagged.length; i += BATCH_SIZE) {
    const batch = untagged.slice(i, i + BATCH_SIZE);
    const emails = [];
    for (const msg of batch) {
      const body = await extractBody(msg.id);
      emails.push({
        subject: msg.subject || "",
        sender: msg.author || "",
        body: body,
        message_id: String(msg.id),
      });
    }

    try {
      const response = await fetch(`${serviceUrl}/classify-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails, tags }),
      });

      if (!response.ok) {
        console.error(`Thundersorter: batch classify failed (${response.status})`);
        continue;
      }

      const data = await response.json();
      for (let j = 0; j < data.results.length; j++) {
        const result = data.results[j];
        if (result.tags && result.tags.length > 0) {
          await applyTags(batch[j], result.tags);
          classified++;
        }
      }
    } catch (err) {
      console.error("Thundersorter: batch classify error:", err);
    }

    console.log(
      `Thundersorter: batch progress ${Math.min(i + BATCH_SIZE, untagged.length)}/${untagged.length}`
    );
  }

  return classified;
}

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

  const count = await classifyBatch(allMessages);
  console.log(`Thundersorter: classified ${count} message(s) in "${folder.path}"`);
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

  const messages = info.selectedMessages.messages;
  console.log(`Thundersorter: classifying ${messages.length} selected message(s)`);
  const count = await classifyBatch(messages);
  console.log(`Thundersorter: classified ${count} of ${messages.length} selected message(s)`);
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
