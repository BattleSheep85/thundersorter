import { DEFAULT_TAGS, BUILTIN_PROVIDERS } from "../common.js";

let currentTags = [];
let providerConfigs = {};
let activeProvider = "";

// --- Storage ---

async function loadAll() {
  const data = await messenger.storage.local.get({
    activeProvider: "",
    providerConfigs: {},
    customTags: null,
  });

  activeProvider = data.activeProvider;
  providerConfigs = data.providerConfigs;
  currentTags = data.customTags || [...DEFAULT_TAGS];

  buildProviderDropdown();
  renderTags();

  if (activeProvider) {
    document.getElementById("provider").value = activeProvider;
  }
  onProviderChange();
}

async function saveAll() {
  await messenger.storage.local.set({ activeProvider, providerConfigs });
}

async function saveTags() {
  await messenger.storage.local.set({ customTags: currentTags });
}

// --- Provider dropdown ---

function buildProviderDropdown() {
  const select = document.getElementById("provider");
  select.innerHTML = '<option value="" disabled>Choose a provider...</option>';

  for (const [key, info] of Object.entries(BUILTIN_PROVIDERS)) {
    const opt = document.createElement("option");
    opt.value = key;
    const configured = providerConfigs[key]?.apiKey || (info.noKey && providerConfigs[key]) ? " \u2713" : "";
    opt.textContent = `${info.label}${configured}`;
    select.appendChild(opt);
  }
}

function onProviderChange() {
  const name = document.getElementById("provider").value;
  if (!name) return;

  const info = BUILTIN_PROVIDERS[name];
  const saved = providerConfigs[name] || {};

  // API key
  const apiKeyGroup = document.getElementById("apiKeyGroup");
  if (info?.noKey) {
    apiKeyGroup.classList.add("hidden");
  } else {
    apiKeyGroup.classList.remove("hidden");
    document.getElementById("apiKey").value = saved.apiKey || "";
  }

  // Key hint
  const hint = document.getElementById("keyHint");
  if (info?.keyUrl) {
    hint.innerHTML = `Get a key at <a href="${info.keyUrl}" target="_blank">${new URL(info.keyUrl).hostname}</a>`;
  } else {
    hint.textContent = "";
  }

  // Model dropdown — show saved model if any
  const modelSelect = document.getElementById("modelSelect");
  if (saved.model) {
    modelSelect.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = saved.model;
    opt.textContent = saved.model;
    modelSelect.appendChild(opt);
    modelSelect.value = saved.model;
  } else {
    modelSelect.innerHTML = '<option value="">Save to load models</option>';
  }
}

// --- Status ---

function showStatus(message, ok) {
  const el = document.getElementById("status");
  el.textContent = message;
  el.className = ok ? "status ok" : "status err";
}

// --- Model fetching ---

let allModels = [];

async function getProviderModule(kind) {
  if (kind === "gemini") return import("../providers/gemini.js");
  if (kind === "openai") return import("../providers/openai.js");
  if (kind === "anthropic") return import("../providers/anthropic.js");
  throw new Error(`Unknown provider kind: ${kind}`);
}

function renderModelList(filter, selectedModel) {
  const modelSelect = document.getElementById("modelSelect");
  modelSelect.innerHTML = "";

  const query = (filter || "").toLowerCase();
  const filtered = query
    ? allModels.filter((id) => id.toLowerCase().includes(query))
    : allModels;

  for (const id of filtered) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = id;
    if (id === selectedModel) opt.selected = true;
    modelSelect.appendChild(opt);
  }
}

async function fetchAndSelectModel(name) {
  const info = BUILTIN_PROVIDERS[name];
  const saved = providerConfigs[name] || {};
  const config = {
    apiKey: document.getElementById("apiKey").value.trim(),
    baseUrl: info?.baseUrl || "",
    modelsUrl: info?.modelsUrl || "",
  };

  const mod = await getProviderModule(info.kind);
  allModels = await mod.fetchModels(config);

  if (allModels.length === 0) {
    throw new Error("No models found for this provider.");
  }

  // Keep the previously saved model if it's still available, otherwise use the first
  const selectedModel = saved.model && allModels.includes(saved.model) ? saved.model : allModels[0];

  document.getElementById("modelFilter").value = "";
  renderModelList("", selectedModel);

  return selectedModel;
}

// --- Tag management ---

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

function removeTag(tag) {
  currentTags = currentTags.filter((t) => t !== tag);
  renderTags();
  saveTags();
}

function addTag() {
  const input = document.getElementById("newTag");
  const tag = input.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (!tag) return;
  if (currentTags.includes(tag)) return;
  currentTags = [...currentTags, tag];
  renderTags();
  saveTags();
  input.value = "";
}

// --- Event listeners ---

document.getElementById("provider").addEventListener("change", onProviderChange);

document.getElementById("save").addEventListener("click", async () => {
  const name = document.getElementById("provider").value;
  if (!name) {
    showStatus("Choose a provider first.", false);
    return;
  }

  const info = BUILTIN_PROVIDERS[name];
  const apiKey = document.getElementById("apiKey").value.trim();

  if (!info.noKey && !apiKey) {
    showStatus("Paste your API key.", false);
    return;
  }

  showStatus("Connecting and fetching models...", true);

  try {
    const config = {
      apiKey,
      kind: info.kind,
      baseUrl: info.baseUrl || "",
    };

    // Temporarily store so fetchAndSelectModel can read it
    providerConfigs = { ...providerConfigs, [name]: config };

    const model = await fetchAndSelectModel(name);

    providerConfigs = {
      ...providerConfigs,
      [name]: { ...config, model },
    };
    activeProvider = name;
    await saveAll();
    buildProviderDropdown();
    document.getElementById("provider").value = name;

    showStatus(`Saved! Using model: ${model}`, true);
  } catch (err) {
    showStatus(err.message, false);
  }
});

document.getElementById("advancedToggle").addEventListener("click", () => {
  const section = document.getElementById("advancedSection");
  const toggle = document.getElementById("advancedToggle");
  const isHidden = section.classList.toggle("hidden");
  toggle.textContent = isHidden ? "Advanced options" : "Hide advanced options";
});

document.getElementById("modelSelect").addEventListener("change", async () => {
  const name = document.getElementById("provider").value;
  if (!name) return;

  const model = document.getElementById("modelSelect").value;
  if (!model) return;

  const existing = providerConfigs[name];
  if (!existing) return;

  providerConfigs = {
    ...providerConfigs,
    [name]: { ...existing, model },
  };
  await saveAll();
  showStatus(`Model changed to: ${model}`, true);
});

document.getElementById("modelFilter").addEventListener("input", () => {
  const query = document.getElementById("modelFilter").value;
  const current = document.getElementById("modelSelect").value;
  renderModelList(query, current);
});

document.getElementById("addTag").addEventListener("click", addTag);

document.getElementById("newTag").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addTag();
});

document.getElementById("resetTags").addEventListener("click", () => {
  currentTags = [...DEFAULT_TAGS];
  renderTags();
  saveTags();
});

loadAll();
