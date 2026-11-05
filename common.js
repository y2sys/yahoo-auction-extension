(() => {
  "use strict";
  const PREFIX = "yahHidden:";
  function auctionId(value) {
    try {
      const url = new URL(value, "https://auctions.yahoo.co.jp");
      if (url.protocol !== "https:" || !["auctions.yahoo.co.jp", "page.auctions.yahoo.co.jp"].includes(url.hostname)) return null;
      return url.pathname.match(/^\/jp\/auction\/([a-zA-Z0-9]+)\/?$/)?.[1] ?? null;
    } catch { return null; }
  }
  function entries(data) {
    return Object.entries(data).filter(([key, item]) =>
      key.startsWith(PREFIX) && item && typeof item.id === "string" &&
      key === PREFIX + item.id && auctionId(item.url) === item.id
    ).map(([, item]) => item);
  }
  async function read() { return entries(await chrome.storage.local.get(null)); }
  async function hide(item) {
    if (auctionId(item.url) !== item.id) throw new Error("Invalid auction ID");
    await chrome.storage.local.set({ [PREFIX + item.id]: {
      id: item.id, url: `https://auctions.yahoo.co.jp/jp/auction/${item.id}`,
      title: String(item.title || item.id).slice(0, 500), hiddenAt: Date.now()
    } });
  }
  async function restore(id) { await chrome.storage.local.remove(PREFIX + id); }
  function watch(callback) {
    const listener = (changes, area) => {
      if (area === "local" && Object.keys(changes).some(key => key.startsWith(PREFIX))) callback();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }
  globalThis.YAHide = { PREFIX, auctionId, entries, read, hide, restore, watch };
})();
