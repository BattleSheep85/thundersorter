const CALLBACK_URL = "https://battlesheep85.github.io/thundersorter/auth-callback.html";

export { CALLBACK_URL };

export async function generatePKCE() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return { verifier, challenge };
}

export function watchTab(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Login timed out. Please try again."));
    }, 300_000);

    function cleanup() {
      clearTimeout(timeout);
      messenger.tabs.onUpdated.removeListener(onUpdated);
      messenger.tabs.onRemoved.removeListener(onRemoved);
    }

    function onUpdated(id, changeInfo) {
      if (id !== tabId || !changeInfo.url) return;
      if (!changeInfo.url.startsWith(CALLBACK_URL)) return;
      cleanup();
      const url = new URL(changeInfo.url);
      const code = url.searchParams.get("code");
      messenger.tabs.remove(id).catch(() => {});
      if (code) {
        resolve(code);
      } else {
        reject(new Error("No authorization code received."));
      }
    }

    function onRemoved(id) {
      if (id !== tabId) return;
      cleanup();
      reject(new Error("Login cancelled."));
    }

    messenger.tabs.onUpdated.addListener(onUpdated);
    messenger.tabs.onRemoved.addListener(onRemoved);
  });
}

export async function exchangeCode(code, verifier) {
  const response = await fetch("https://openrouter.ai/api/v1/auth/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter error (${response.status}): ${text.slice(0, 200)}`);
  }
  const data = await response.json();
  if (!data.key) throw new Error("No API key in response.");
  return data.key;
}
