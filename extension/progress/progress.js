const cancelBtn = document.getElementById("cancelBtn");
const closeBtn = document.getElementById("closeBtn");

cancelBtn.addEventListener("click", () => {
  cancelBtn.disabled = true;
  cancelBtn.textContent = "Cancelling...";
  messenger.runtime.sendMessage({ type: "cancel-classify" });
});

closeBtn.addEventListener("click", () => {
  window.close();
});

messenger.runtime.onMessage.addListener((msg) => {
  if (msg.type === "classify-progress") {
    const pct = msg.total > 0 ? Math.round((msg.processed / msg.total) * 100) : 0;
    document.getElementById("progressFill").style.width = `${pct}%`;
    document.getElementById("stats").textContent =
      `${msg.processed} of ${msg.total} — ${msg.tagged} tagged`;
    if (msg.currentSubject) {
      document.getElementById("currentSubject").textContent = msg.currentSubject;
    }
    const tierLabels = {
      "headers": "Detected from headers",
      "sender-cache": "Recognized sender",
      "llm": "AI classified",
    };
    document.getElementById("tierInfo").textContent =
      msg.tier ? tierLabels[msg.tier] || "" : "";
  }

  if (msg.type === "classify-done") {
    document.getElementById("progressFill").style.width = "100%";
    document.getElementById("stats").textContent = "Done";
    document.getElementById("currentSubject").textContent = "";
    cancelBtn.style.display = "none";
    closeBtn.style.display = "inline-block";

    const summary = document.getElementById("doneSummary");
    if (msg.cancelled) {
      summary.textContent =
        `Cancelled. Tagged ${msg.tagged} of ${msg.total} emails.`;
      summary.classList.add("cancelled");
    } else {
      summary.textContent =
        `Complete. Tagged ${msg.tagged} of ${msg.total} emails.`;
    }
    summary.classList.add("visible");
  }
});
