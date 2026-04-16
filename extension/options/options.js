import { DEFAULT_FOLDERS, BUILTIN_PROVIDERS, FOLDER_PRESETS } from "../common.js";
import { buildSample, buildAnalysisPrompt, parseFolderSuggestions, buildRefinementPrompt, diagnoseEmptyFolders } from "../analyzer.js";
import { generatePKCE, watchTab, exchangeCode, CALLBACK_URL } from "../oauth.js";

let currentFolders = [];
let currentMode = "home";
let providerConfigs = {};
let activeProvider = "";

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
    message.textContent = "Data consent: enabled. Email data will be sent to your AI provider for sorting.";
  } else {
    banner.classList.add("warn");
    message.textContent = "Data consent: not given. Sorting is disabled until you consent.";
  }
}

// --- Storage ---

async function loadAll() {
  const data = await messenger.storage.local.get({
    activeProvider: "",
    providerConfigs: {},
    customFolders: null,
    folderMode: "home",
  });

  activeProvider = data.activeProvider;
  providerConfigs = data.providerConfigs;
  currentMode = data.folderMode || "home";
  currentFolders = data.customFolders || [...DEFAULT_FOLDERS];

  buildProviderDropdown();
  document.getElementById("modeSelect").value = currentMode;
  renderFolders();
  loadConsentStatus();
  updateConnectionStatus();

  if (activeProvider) {
    document.getElementById("provider").value = activeProvider;
  }
  onProviderChange();
}

async function saveAll() {
  await messenger.storage.local.set({ activeProvider, providerConfigs });
}

async function saveFolders() {
  await messenger.storage.local.set({ customFolders: currentFolders, folderMode: currentMode });
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

  const apiKeyGroup = document.getElementById("apiKeyGroup");
  if (info?.noKey) {
    apiKeyGroup.classList.add("hidden");
  } else {
    apiKeyGroup.classList.remove("hidden");
    document.getElementById("apiKey").value = saved.apiKey || "";
  }

  const hint = document.getElementById("keyHint");
  hint.textContent = "";
  if (info?.keyUrl) {
    hint.appendChild(document.createTextNode("Get a key at "));
    const link = document.createElement("a");
    link.href = info.keyUrl;
    link.target = "_blank";
    link.textContent = new URL(info.keyUrl).hostname;
    hint.appendChild(link);
  }

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

  const defaultModel = info?.defaultModel;
  const selectedModel =
    (saved.model && allModels.includes(saved.model) && saved.model) ||
    (defaultModel && allModels.includes(defaultModel) && defaultModel) ||
    allModels[0];

  document.getElementById("modelFilter").value = "";
  renderModelList("", selectedModel);

  return selectedModel;
}

// --- Folder management ---

function renderFolders() {
  const list = document.getElementById("folderList");
  list.replaceChildren();
  for (const folder of currentFolders) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.className = "tag-name";
    span.textContent = folder;
    const btn = document.createElement("button");
    btn.className = "danger";
    btn.textContent = "Remove";
    btn.addEventListener("click", () => removeFolder(folder));
    li.appendChild(span);
    li.appendChild(btn);
    list.appendChild(li);
  }
}

function switchToCustom() {
  currentMode = "custom";
  document.getElementById("modeSelect").value = "custom";
}

function normalizeFolderInput(raw) {
  const cleaned = raw.trim().replace(/[^A-Za-z0-9-]/g, "").slice(0, 30);
  if (!cleaned) return "";
  return cleaned[0].toUpperCase() + cleaned.slice(1).toLowerCase();
}

function removeFolder(folder) {
  switchToCustom();
  currentFolders = currentFolders.filter((f) => f !== folder);
  renderFolders();
  saveFolders();
}

function addFolder() {
  const input = document.getElementById("newFolder");
  const folder = normalizeFolderInput(input.value);
  if (!folder) return;
  if (currentFolders.includes(folder)) return;
  switchToCustom();
  currentFolders = [...currentFolders, folder];
  renderFolders();
  saveFolders();
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

document.getElementById("addFolder").addEventListener("click", addFolder);

document.getElementById("newFolder").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addFolder();
});

document.getElementById("modeSelect").addEventListener("change", () => {
  const mode = document.getElementById("modeSelect").value;
  currentMode = mode;
  if (FOLDER_PRESETS[mode]) {
    currentFolders = [...FOLDER_PRESETS[mode].folders];
    renderFolders();
    saveFolders();
  } else {
    saveFolders();
  }
});

document.getElementById("resetFolders").addEventListener("click", () => {
  const preset = FOLDER_PRESETS[currentMode];
  currentFolders = preset ? [...preset.folders] : [...DEFAULT_FOLDERS];
  renderFolders();
  saveFolders();
});

document.getElementById("reviewConsent").addEventListener("click", () => {
  messenger.tabs.create({ url: "../consent/consent.html" });
});

// --- Analyze Inbox ---

let cachedSamples = [];
let suggestedFolders = [];
let analyzeInProgress = false;

function showAnalyzeStatus(message, ok) {
  const el = document.getElementById("analyzeStatus");
  el.textContent = message;
  el.className = ok ? "status ok" : "status err";
}

function renderSuggestions(folders) {
  suggestedFolders = folders.map((f) => ({ name: f, accepted: true }));
  const container = document.getElementById("suggestedTags");
  container.replaceChildren();

  if (folders.length === 0) {
    container.textContent = "No suggestions found.";
    return;
  }

  const label = document.createElement("p");
  label.className = "hint";
  label.textContent = "Click a folder to toggle it. Then apply the ones you want.";
  container.appendChild(label);

  const chips = document.createElement("div");
  for (const item of suggestedFolders) {
    const chip = document.createElement("span");
    chip.className = "suggested-tag";
    chip.setAttribute("role", "button");
    chip.setAttribute("tabindex", "0");
    chip.textContent = item.name;
    const toggleChip = () => {
      item.accepted = !item.accepted;
      chip.classList.toggle("rejected", !item.accepted);
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
    const accepted = suggestedFolders.filter((t) => t.accepted).map((t) => t.name);
    if (accepted.length === 0) return;
    switchToCustom();
    currentFolders = accepted;
    renderFolders();
    saveFolders();
    showAnalyzeStatus("Folders applied!", true);
  });
  actions.appendChild(applyBtn);

  const mergeBtn = document.createElement("button");
  mergeBtn.className = "secondary";
  mergeBtn.textContent = "Merge with Current";
  mergeBtn.addEventListener("click", () => {
    const accepted = suggestedFolders.filter((t) => t.accepted).map((t) => t.name);
    if (accepted.length === 0) return;
    switchToCustom();
    currentFolders = [...new Set([...currentFolders, ...accepted])];
    renderFolders();
    saveFolders();
    showAnalyzeStatus("Folders merged!", true);
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
    const prompt = buildAnalysisPrompt(cachedSamples, currentMode, 6);

    showAnalyzeStatus("Asking AI to suggest folders...", true);
    const response = await mod.complete(config, prompt, "Suggest folders for these emails.");
    const folders = parseFolderSuggestions(response);

    if (folders.length > 0) {
      renderSuggestions(folders);
      document.getElementById("chatSection").classList.remove("hidden");
      showAnalyzeStatus(`Found ${folders.length} suggested folders.`, true);
    } else {
      showAnalyzeStatus(diagnoseEmptyFolders(response), false);
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

  showAnalyzeStatus("Refining folders...", true);

  try {
    const { mod, config } = await getAnalysisConfig();
    const prompt = buildRefinementPrompt(currentFolders, request, cachedSamples);
    const response = await mod.complete(config, prompt, request);
    const folders = parseFolderSuggestions(response);

    if (folders.length > 0) {
      renderSuggestions(folders);
      showAnalyzeStatus(`Refined to ${folders.length} folders.`, true);
    } else {
      showAnalyzeStatus(diagnoseEmptyFolders(response), false);
    }
  } catch (err) {
    showAnalyzeStatus(`Refinement failed: ${err.message}`, false);
  }
});

document.getElementById("chatInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("chatSend").click();
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
