document.getElementById("closeBtn").addEventListener("click", () => {
  window.close();
});

function renderDiagnostic(data) {
  const content = document.getElementById("content");
  content.innerHTML = "";

  // Tier badge
  const badge = document.createElement("span");
  badge.className = `tier-badge tier-${data.tier}`;
  const tierLabels = {
    "headers": "Detected from email headers",
    "sender-cache": "Recognized sender",
    "llm": "AI sort",
    "security-filter": "Security filter (no AI)",
    "skipped": "Not sorted",
    "error": "Error",
    "already-flagged": "Already flagged",
    "unknown": "Unknown",
  };
  badge.textContent = tierLabels[data.tier] || data.tier;
  content.appendChild(badge);

  // Folder
  if (data.folder) {
    const folderDiv = document.createElement("div");
    folderDiv.className = "tags";
    const span = document.createElement("span");
    span.className = "tag";
    span.textContent = `Folder: ${data.folder}`;
    folderDiv.appendChild(span);
    content.appendChild(folderDiv);
  }

  // Flags
  if (data.flags && data.flags.length > 0) {
    const flagsDiv = document.createElement("div");
    flagsDiv.className = "tags";
    for (const flag of data.flags) {
      const span = document.createElement("span");
      span.className = "tag";
      span.textContent = flag;
      flagsDiv.appendChild(span);
    }
    content.appendChild(flagsDiv);
  }

  // Reason
  const reason = document.createElement("p");
  reason.className = "reason";
  reason.textContent = data.reason;
  content.appendChild(reason);

  // Suggestions
  if (data.suggestions && data.suggestions.length > 0) {
    const list = document.createElement("ul");
    list.className = "suggestions";
    for (const s of data.suggestions) {
      const li = document.createElement("li");
      li.textContent = s;
      list.appendChild(li);
    }
    content.appendChild(list);
  }
}

// Request diagnostic data from background using nonce for multi-popup safety
(async () => {
  const nonce = new URL(window.location.href).searchParams.get("nonce");
  if (!nonce) return;
  const data = await messenger.runtime.sendMessage({ type: "request-diagnostic", nonce });
  if (data?.diagnostic) {
    document.getElementById("subject").textContent = data.subject || "";
    renderDiagnostic(data.diagnostic);
  }
})();
