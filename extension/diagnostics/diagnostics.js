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
    "llm": "AI classification",
    "skipped": "Not classified",
    "error": "Error",
    "already-tagged": "Already tagged",
    "unknown": "Unknown",
  };
  badge.textContent = tierLabels[data.tier] || data.tier;
  content.appendChild(badge);

  // Tags
  if (data.tags && data.tags.length > 0) {
    const tagsDiv = document.createElement("div");
    tagsDiv.className = "tags";
    for (const tag of data.tags) {
      const span = document.createElement("span");
      span.className = "tag";
      span.textContent = tag;
      tagsDiv.appendChild(span);
    }
    content.appendChild(tagsDiv);
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
