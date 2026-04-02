"use strict";

document.getElementById("acceptBtn").addEventListener("click", async () => {
  await messenger.storage.local.set({
    dataConsentGiven: true,
    dataConsentDate: new Date().toISOString(),
  });
  // Close this tab — user is ready to go configure their provider
  const tabs = await messenger.tabs.query({ currentWindow: true, active: true });
  if (tabs.length > 0) {
    messenger.tabs.remove(tabs[0].id);
  }
  // Open the settings page so they can set up their provider
  messenger.runtime.openOptionsPage();
});

document.getElementById("declineBtn").addEventListener("click", async () => {
  await messenger.storage.local.set({
    dataConsentGiven: false,
    dataConsentDate: new Date().toISOString(),
  });
  const tabs = await messenger.tabs.query({ currentWindow: true, active: true });
  if (tabs.length > 0) {
    messenger.tabs.remove(tabs[0].id);
  }
});
