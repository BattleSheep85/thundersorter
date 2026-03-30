const DEFAULT_URL = "http://127.0.0.1:8465";
const DEFAULT_TAGS = [
  "finance", "receipts", "newsletters", "social", "work",
  "personal", "notifications", "shipping", "travel", "promotions",
];

let currentTags = [];

async function loadSettings() {
  const { serviceUrl, customTags } = await messenger.storage.local.get({
    serviceUrl: DEFAULT_URL,
    customTags: null,
  });
  document.getElementById("serviceUrl").value = serviceUrl;
  currentTags = customTags || [...DEFAULT_TAGS];
  renderTags();
}

function showStatus(message, ok) {
  const el = document.getElementById("status");
  el.textContent = message;
  el.className = ok ? "status ok" : "status err";
}

function renderTags() {
  const list = document.getElementById("tagList");
  list.innerHTML = "";
  for (const tag of currentTags) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.className = "tag-name";
    span.textContent = tag;
    const btn = document.createElement("button");
    btn.className = "danger";
    btn.textContent = "Remove";
    btn.addEventListener("click", () => removeTag(tag));
    li.appendChild(span);
    li.appendChild(btn);
    list.appendChild(li);
  }
}

async function saveTags() {
  await messenger.storage.local.set({ customTags: currentTags });
}

function removeTag(tag) {
  currentTags = currentTags.filter((t) => t !== tag);
  renderTags();
  saveTags();
  showStatus(`Removed "${tag}".`, true);
}

function addTag() {
  const input = document.getElementById("newTag");
  const tag = input.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (!tag) return;
  if (currentTags.includes(tag)) {
    showStatus(`Tag "${tag}" already exists.`, false);
    return;
  }
  currentTags = [...currentTags, tag];
  renderTags();
  saveTags();
  input.value = "";
  showStatus(`Added "${tag}".`, true);
}

document.getElementById("save").addEventListener("click", async () => {
  const serviceUrl = document.getElementById("serviceUrl").value.trim() || DEFAULT_URL;
  await messenger.storage.local.set({ serviceUrl });
  showStatus("Settings saved.", true);
});

document.getElementById("test").addEventListener("click", async () => {
  const serviceUrl = document.getElementById("serviceUrl").value.trim() || DEFAULT_URL;
  try {
    const response = await fetch(`${serviceUrl}/health`);
    if (response.ok) {
      const data = await response.json();
      showStatus(`Connected. Server tags: ${data.available_tags.join(", ")}`, true);
    } else {
      showStatus(`Service returned ${response.status}`, false);
    }
  } catch (err) {
    showStatus(`Cannot reach service: ${err.message}`, false);
  }
});

document.getElementById("addTag").addEventListener("click", addTag);

document.getElementById("newTag").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addTag();
});

document.getElementById("resetTags").addEventListener("click", () => {
  currentTags = [...DEFAULT_TAGS];
  renderTags();
  saveTags();
  showStatus("Tags reset to defaults.", true);
});

loadSettings();
