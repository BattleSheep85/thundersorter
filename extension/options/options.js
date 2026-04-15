import { DEFAULT_TAGS, BUILTIN_PROVIDERS, PRESETS } from "../common.js";
import { buildSample, buildAnalysisPrompt, parseTagSuggestions, buildRefinementPrompt, diagnoseEmptyTags } from "../analyzer.js";
import { generateFolderName, buildDefaultMapping } from "../folder-router.js";
import { generatePKCE, watchTab, exchangeCode, CALLBACK_URL } from "../oauth.js";

let currentTags = [];
let currentMode = "home";
let providerConfigs = {};
let activeProvider = "";
let folderRoutingEnabled = false;
let tagPriority = [];

// --- PKCE OAuth ---

async function connectOpenRouter() {
  const btn = document.getElementById("connectOpenRouter");
  btn.disabled = true;
  showStatus("Opening OpenRouter login...", true);

  try {
    const { verifier, challenge } = await generatePKCE();
    const authUrl = `https://openrouter.ai/auth?callback_url=${encodeURIComponent(CALLBACK_URL)}&code_challenge=${challenge}&code_challenge_method=S256`;
    const tab = await messenger.tabs.create({ url: authUrl });
    const code = await watchTab(tab.id);

    showStatus("Exchanging code for API key...", true);
    const apiKey = await exchangeCode(code, verifier);

    providerConfigs = {
      ...providerConfigs,
      openrouter: { apiKey, kind: "openai", baseUrl: "https://openrouter.ai/api/v1", model: "openrouter/free" },
    };
    activeProvider = "openrouter";
    await saveAll();

    updateConnectionStatus();
    showStatus("Connected! Emails will be sorted using OpenRouter (free).", true);

    const { dataConsentGiven } = await messenger.storage.local.get({ dataConsentGiven: false });
    if (!dataConsentGiven) {
      messenger.tabs.create({ url: "../consent/consent.html" });
    }
  } catch (err) {
    showStatus(err.message, false);
  } finally {
    btn.disabled = false;
  }
}

function updateConnectionStatus() {
  const banner = document.getElementById("connectedBanner");
  const connectSection = document.getElementById("connectSection");
  const providerLabel = document.getElementById("connectedProvider");

  if (activeProvider && providerConfigs[activeProvider]) {
    const info = BUILTIN_PROVIDERS[activeProvider];
    const config = providerConfigs[activeProvider];
    const label = info?.label || activeProvider;
    const model = config.model || "auto";
    providerLabel.textContent = `${label} (${model})`;
    banner.classList.remove("hidden");
    connectSection.classList.add("hidden");
  } else {
    banner.classList.add("hidden");
    connectSection.classList.remove("hidden");
  }
}

// --- Consent status ---

async function loadConsentStatus() {
  const { dataConsentGiven } = await messenger.storage.local.get({ dataConsentGiven: false });
  const banner = document.getElementById("consentBanner");
  const message = document.getElementById("consentMessage");

  banner.classList.remove("hidden", "ok", "warn");

  if (dataConsentGiven) {
    banner.classList.add("ok");
    message.textContent = "Data consent: enabled. Email data will be sent to your AI provider for classification.";
  } else {
    banner.classList.add("warn");
    message.textContent = "Data consent: not given. Classification is disabled until you consent.";
  }
}

// --- Storage ---

async function loadAll() {
  const data = await messenger.storage.local.get({
    activeProvider: "",
    providerConfigs: {},
    customTags: null,
    tagMode: "home",
    folderRoutingEnabled: false,
    tagPriority: [],
  });

  activeProvider = data.activeProvider;
  providerConfigs = data.providerConfigs;
  currentMode = data.tagMode || "home";
  currentTags = data.customTags || [...DEFAULT_TAGS];
  folderRoutingEnabled = data.folderRoutingEnabled || false;
  tagPriority = data.tagPriority || [];

  buildProviderDropdown();
  document.getElementById("modeSelect").value = currentMode;
  renderTags();
  loadConsentStatus();
  updateConnectionStatus();

  // Folder routing UI
  document.getElementById("folderRoutingEnabled").checked = folderRoutingEnabled;
  if (folderRoutingEnabled) {
    document.getElementById("folderMappingSection").classList.remove("hidden");
    renderPriorityList();
  }

  if (activeProvider) {
    document.getElementById("provider").value = activeProvider;
  }
  onProviderChange();
}

async function saveAll() {
  await messenger.storage.local.set({ activeProvider, providerConfigs });
}

async function saveTags() {
  await messenger.storage.local.set({ customTags: currentTags, tagMode: currentMode });
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
    hint.textContent = "";
    const text = document.createTextNode("Get a key at ");
    const link = document.createElement("a");
    link.href = info.keyUrl;
    link.target = "_blank";
    link.textContent = new URL(info.keyUrl).hostname;
    hint.appendChild(text);
    hint.appendChild(link);
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

  // Keep the previously saved model if it's still available, then try provider default, then first
  const defaultModel = info?.defaultModel;
  const selectedModel =
    (saved.model && allModels.includes(saved.model) && saved.model) ||
    (defaultModel && allModels.includes(defaultModel) && defaultModel) ||
    allModels[0];

  document.getElementById("modelFilter").value = "";
  renderModelList("", selectedModel);

  return selectedModel;
}

// --- Tag management ---

function renderTags() {
  const list = document.getElementById("tagList");
  list.replaceChildren();
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

function switchToCustom() {
  currentMode = "custom";
  document.getElementById("modeSelect").value = "custom";
}

function removeTag(tag) {
  switchToCustom();
  currentTags = currentTags.filter((t) => t !== tag);
  renderTags();
  saveTags();
}

function addTag() {
  const input = document.getElementById("newTag");
  const tag = input.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (!tag) return;
  if (currentTags.includes(tag)) return;
  switchToCustom();
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

  // Check consent before allowing provider setup
  const { dataConsentGiven } = await messenger.storage.local.get({ dataConsentGiven: false });
  if (!dataConsentGiven) {
    showStatus("Please review and accept the data consent first.", false);
    messenger.tabs.create({ url: "../consent/consent.html" });
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

document.getElementById("connectOpenRouter").addEventListener("click", connectOpenRouter);

document.getElementById("advancedToggle").addEventListener("click", () => {
  const section = document.getElementById("advancedSection");
  const toggle = document.getElementById("advancedToggle");
  const isHidden = section.classList.toggle("hidden");
  toggle.textContent = isHidden ? "Use a different provider" : "Hide provider options";
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

document.getElementById("modeSelect").addEventListener("change", () => {
  const mode = document.getElementById("modeSelect").value;
  currentMode = mode;
  if (PRESETS[mode]) {
    currentTags = [...PRESETS[mode].tags];
    renderTags();
    saveTags();
  } else {
    saveTags();
  }
  // Re-render priority list if folder routing is active
  if (folderRoutingEnabled) renderPriorityList();
  saveFolderRouting();
});

document.getElementById("resetTags").addEventListener("click", () => {
  const preset = PRESETS[currentMode];
  currentTags = preset ? [...preset.tags] : [...DEFAULT_TAGS];
  renderTags();
  saveTags();
});

document.getElementById("reviewConsent").addEventListener("click", () => {
  messenger.tabs.create({ url: "../consent/consent.html" });
});

// --- Analyze Inbox ---

let cachedSamples = [];
let suggestedTags = [];
let analyzeInProgress = false;

function showAnalyzeStatus(message, ok) {
  const el = document.getElementById("analyzeStatus");
  el.textContent = message;
  el.className = ok ? "status ok" : "status err";
}

function renderSuggestions(tags) {
  suggestedTags = tags.map((t) => ({ name: t, accepted: true }));
  const container = document.getElementById("suggestedTags");
  container.replaceChildren();

  if (tags.length === 0) {
    container.textContent = "No suggestions found.";
    return;
  }

  const label = document.createElement("p");
  label.className = "hint";
  label.textContent = "Click a tag to toggle it. Then apply the ones you want.";
  container.appendChild(label);

  const chips = document.createElement("div");
  for (const tag of suggestedTags) {
    const chip = document.createElement("span");
    chip.className = "suggested-tag";
    chip.setAttribute("role", "button");
    chip.setAttribute("tabindex", "0");
    chip.textContent = tag.name;
    const toggleChip = () => {
      tag.accepted = !tag.accepted;
      chip.classList.toggle("rejected", !tag.accepted);
    };
    chip.addEventListener("click", toggleChip);
    chip.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleChip(); }
    });
    chips.appendChild(chip);
  }
  container.appendChild(chips);

  const actions = document.createElement("div");
  actions.className = "suggestion-actions";

  const applyBtn = document.createElement("button");
  applyBtn.textContent = "Apply Selected";
  applyBtn.addEventListener("click", () => {
    const accepted = suggestedTags.filter((t) => t.accepted).map((t) => t.name);
    if (accepted.length === 0) return;
    switchToCustom();
    currentTags = accepted;
    renderTags();
    saveTags();
    showAnalyzeStatus("Tags applied!", true);
  });
  actions.appendChild(applyBtn);

  const mergeBtn = document.createElement("button");
  mergeBtn.className = "secondary";
  mergeBtn.textContent = "Merge with Current";
  mergeBtn.addEventListener("click", () => {
    const accepted = suggestedTags.filter((t) => t.accepted).map((t) => t.name);
    if (accepted.length === 0) return;
    switchToCustom();
    currentTags = [...new Set([...currentTags, ...accepted])];
    renderTags();
    saveTags();
    showAnalyzeStatus("Tags merged!", true);
  });
  actions.appendChild(mergeBtn);

  container.appendChild(actions);
}

async function getAnalysisConfig() {
  if (!activeProvider || !providerConfigs[activeProvider]) {
    throw new Error("Click \"Connect OpenRouter\" above first, or set up a provider in Advanced.");
  }
  const info = BUILTIN_PROVIDERS[activeProvider];
  const config = providerConfigs[activeProvider];
  const mod = await getProviderModule(info.kind);
  return {
    mod,
    config: { ...config, baseUrl: config.baseUrl || info.baseUrl || "" },
  };
}

async function analyzeInbox() {
  if (analyzeInProgress) return;
  analyzeInProgress = true;
  cachedSamples = [];
  const analyzeBtn = document.getElementById("analyzeInbox");
  analyzeBtn.disabled = true;

  const analyzeSection = document.getElementById("analyzeSection");
  analyzeSection.classList.remove("hidden");
  showAnalyzeStatus("Fetching emails from inbox...", true);

  try {
    // Get all accounts and find inbox folders
    const accounts = await messenger.accounts.list();
    const allMessages = [];

    for (const account of accounts) {
      const folders = await messenger.folders.getSubFolders(account.rootFolder.id);
      const inbox = folders.find((f) => f.specialUse?.includes("inbox"));
      if (!inbox) continue;

      let page = await messenger.messages.list(inbox.id);
      allMessages.push(...page.messages);
      while (page.id && allMessages.length < 500) {
        page = await messenger.messages.continueList(page.id);
        allMessages.push(...page.messages);
      }
    }

    if (allMessages.length === 0) {
      showAnalyzeStatus("No emails found in your inbox.", false);
      return;
    }

    showAnalyzeStatus(`Sampling ${allMessages.length} emails...`, true);
    cachedSamples = buildSample(allMessages, 75);

    const { mod, config } = await getAnalysisConfig();
    const prompt = buildAnalysisPrompt(cachedSamples, currentMode, 10);

    showAnalyzeStatus("Asking AI to suggest tags...", true);
    const response = await mod.complete(config, prompt, "Suggest tags for these emails.");
    const tags = parseTagSuggestions(response);

    if (tags.length > 0) {
      renderSuggestions(tags);
      document.getElementById("chatSection").classList.remove("hidden");
      showAnalyzeStatus(`Found ${tags.length} suggested tags.`, true);
    } else {
      showAnalyzeStatus(diagnoseEmptyTags(response), false);
    }
  } catch (err) {
    showAnalyzeStatus(`Analysis failed: ${err.message}`, false);
  } finally {
    analyzeInProgress = false;
    document.getElementById("analyzeInbox").disabled = false;
  }
}

document.getElementById("analyzeInbox").addEventListener("click", analyzeInbox);

document.getElementById("chatSend").addEventListener("click", async () => {
  const input = document.getElementById("chatInput");
  const request = input.value.trim();
  if (!request) return;
  input.value = "";

  showAnalyzeStatus("Refining tags...", true);

  try {
    const { mod, config } = await getAnalysisConfig();
    const prompt = buildRefinementPrompt(currentTags, request, cachedSamples);
    const response = await mod.complete(config, prompt, request);
    const tags = parseTagSuggestions(response);

    if (tags.length > 0) {
      renderSuggestions(tags);
      showAnalyzeStatus(`Refined to ${tags.length} tags.`, true);
    } else {
      showAnalyzeStatus(diagnoseEmptyTags(response), false);
    }
  } catch (err) {
    showAnalyzeStatus(`Refinement failed: ${err.message}`, false);
  }
});

document.getElementById("chatInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("chatSend").click();
});

// --- Folder Routing ---

function syncTagPriority() {
  const allTags = [...currentTags];
  const prioritized = tagPriority.filter((t) => allTags.includes(t));
  const remaining = allTags.filter((t) => !prioritized.includes(t));
  tagPriority = [...prioritized, ...remaining];
}

function renderPriorityList() {
  syncTagPriority();
  const list = document.getElementById("priorityList");
  list.replaceChildren();

  for (const tag of tagPriority) {
    const li = document.createElement("li");
    li.className = "priority-item";
    li.draggable = true;
    li.setAttribute("tabindex", "0");
    li.dataset.tag = tag;

    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.setAttribute("aria-hidden", "true");
    handle.textContent = "\u2261";
    li.appendChild(handle);

    const name = document.createElement("span");
    name.textContent = tag;
    li.appendChild(name);

    const folder = document.createElement("span");
    folder.className = "folder-name";
    folder.textContent = "\u2192 " + generateFolderName(tag, currentMode === "business" ? "business" : "home");
    li.appendChild(folder);

    // Keyboard reorder (Alt+Up / Alt+Down)
    li.addEventListener("keydown", (e) => {
      if (!e.altKey) return;
      const idx = tagPriority.indexOf(tag);
      if (e.key === "ArrowUp" && idx > 0) {
        e.preventDefault();
        tagPriority = [...tagPriority.slice(0, idx - 1), tag, tagPriority[idx - 1], ...tagPriority.slice(idx + 1)];
        renderPriorityList();
        saveFolderRouting();
        list.children[idx - 1]?.focus();
      } else if (e.key === "ArrowDown" && idx < tagPriority.length - 1) {
        e.preventDefault();
        tagPriority = [...tagPriority.slice(0, idx), tagPriority[idx + 1], tag, ...tagPriority.slice(idx + 2)];
        renderPriorityList();
        saveFolderRouting();
        list.children[idx + 1]?.focus();
      }
    });
    // Drag and drop
    li.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", tag);
      li.style.opacity = "0.5";
    });
    li.addEventListener("dragend", () => { li.style.opacity = "1"; });
    li.addEventListener("dragover", (e) => { e.preventDefault(); });
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      const from = e.dataTransfer.getData("text/plain");
      const to = tag;
      if (from === to) return;
      // Build new order: filter out dragged item, then insert at drop target position
      const without = tagPriority.filter((t) => t !== from);
      const dropIdx = without.indexOf(to);
      tagPriority = [
        ...without.slice(0, dropIdx),
        from,
        ...without.slice(dropIdx),
      ];
      renderPriorityList();
      saveFolderRouting();
    });

    list.appendChild(li);
  }
}

async function saveFolderRouting() {
  const folderMapping = buildDefaultMapping(
    currentTags,
    currentMode === "business" ? "business" : "home",
  );
  await messenger.storage.local.set({
    folderRoutingEnabled,
    folderMapping,
    tagPriority,
  });
}

document.getElementById("folderRoutingEnabled").addEventListener("change", (e) => {
  folderRoutingEnabled = e.target.checked;
  document.getElementById("folderMappingSection").classList.toggle("hidden", !folderRoutingEnabled);
  if (folderRoutingEnabled) renderPriorityList();
  saveFolderRouting();
});

// Refresh consent status when storage changes (e.g., user accepts consent in another tab)
messenger.storage.onChanged.addListener((changes) => {
  if (changes.dataConsentGiven) {
    loadConsentStatus();
  }
  if (changes.activeProvider || changes.providerConfigs) {
    if (changes.activeProvider) activeProvider = changes.activeProvider.newValue || "";
    if (changes.providerConfigs) providerConfigs = changes.providerConfigs.newValue || {};
    updateConnectionStatus();
    buildProviderDropdown();
  }
});

loadAll();
