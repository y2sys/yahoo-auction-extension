"use strict";
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "yah-open-manager" || sender.id !== chrome.runtime.id) return;
  chrome.runtime.openOptionsPage().then(
    () => sendResponse({ ok: true }),
    () => sendResponse({ ok: false })
  );
  return true;
});
