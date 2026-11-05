(() => {
  "use strict";
  if (globalThis.__yahHideStarted) return;
  globalThis.__yahHideStarted = true;
  const api = globalThis.YAHide;
  const scopeSelector = "#searchItems, #featuredItems, .Products";
  let hidden = new Set();
  let ready = false;
  let readVersion = 0;
  let timer;
  let bar;
  let toast;
  const records = new WeakMap();
  const managed = new Set();

  function button(text, handler) {
    const node = document.createElement("button");
    node.type = "button";
    node.textContent = text;
    node.addEventListener("click", handler);
    return node;
  }
  function notice(message, undoId) {
    toast?.remove();
    toast = document.createElement("div");
    toast.className = "yah-toast";
    toast.dataset.yahUi = "true";
    toast.setAttribute("role", "status");
    const text = document.createElement("span");
    text.textContent = message;
    toast.append(text);
    if (undoId) toast.append(button("元に戻す", async event => {
      event.currentTarget.disabled = true;
      try {
        await api.restore(undoId);
        await refresh();
        notice("非表示を解除しました");
      } catch { notice("解除できませんでした。ページを再読み込みしてお試しください。"); }
    }));
    toast.append(button("閉じる", () => toast?.remove()));
    document.body.append(toast);
  }

  function scan() {
    if (!ready) return;
    const cards = new Map();
    for (const scope of document.querySelectorAll(scopeSelector)) {
      for (const link of scope.querySelectorAll('a[href*="/jp/auction/"]')) {
        const id = api.auctionId(link.href);
        const card = link.closest("li, .Product");
        if (!id || !card || !scope.contains(card)) continue;
        // Never hide a container holding multiple different auctions.
        const ids = new Set(Array.from(card.querySelectorAll('a[href*="/jp/auction/"]'), a => api.auctionId(a.href)).filter(Boolean));
        if (ids.size !== 1) continue;
        const title = link.querySelector("img")?.alt || link.textContent.trim() || id;
        if (!cards.has(card)) cards.set(card, { id, title, url: link.href });
      }
    }
    for (const card of managed) {
      if (!cards.has(card)) {
        card.classList.remove("yah-hidden", "yah-card");
        records.get(card)?.control.remove();
        records.delete(card);
        managed.delete(card);
      }
    }
    let count = 0;
    for (const [card, item] of cards) {
      let record = records.get(card);
      if (!record) {
        const control = button("非表示", async event => {
          event.preventDefault();
          event.stopPropagation();
          control.disabled = true;
          const current = records.get(card)?.item;
          if (!current) return;
          try {
            await api.hide(current);
            await refresh();
            notice("商品を非表示にしました", current.id);
          } catch { notice("保存できませんでした。拡張機能を確認し、ページを再読み込みしてください。"); }
          finally { control.disabled = false; }
        });
        control.className = "yah-hide-button";
        control.dataset.yahUi = "true";
        record = { control, item };
        records.set(card, record);
        managed.add(card);
      }
      record.item = item;
      record.control.setAttribute("aria-label", `${item.title} を非表示にする`);
      record.control.title = "この商品を今後の検索結果でも非表示にします";
      if (!card.contains(record.control)) card.append(record.control);
      card.classList.add("yah-card");
      card.classList.toggle("yah-hidden", hidden.has(item.id));
      if (hidden.has(item.id)) count++;
    }
    const scope = document.querySelector("#searchItems, .Products");
    if (scope) {
      if (!bar) {
        bar = document.createElement("div");
        bar.className = "yah-bar";
        bar.dataset.yahUi = "true";
        const status = document.createElement("span");
        status.setAttribute("role", "status");
        const manage = button("非表示リスト・解除", async () => {
          try {
            const result = await chrome.runtime.sendMessage({ type: "yah-open-manager" });
            if (!result?.ok) throw new Error("Unable to open options");
          } catch { notice("管理画面を開けませんでした。ブラウザの拡張機能アイコンから開いてください。"); }
        });
        bar.append(status, manage);
      }
      if (scope.previousElementSibling !== bar) scope.before(bar);
      const text = `商品非表示：このページで ${count} 件を非表示（登録 ${hidden.size} 件）`;
      if (bar.firstChild.textContent !== text) bar.firstChild.textContent = text;
    } else { bar?.remove(); }
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(scan, 80);
  }
  async function refresh() {
    const version = ++readVersion;
    const items = await api.read();
    if (version !== readVersion) return;
    hidden = new Set(items.map(item => item.id));
    ready = true;
    scan();
  }
  api.watch(() => { refresh().catch(() => notice("非表示リストを読み込めません。ページを再読み込みしてください。")); });
  const observer = new MutationObserver(mutations => {
    if (mutations.some(m => m.type === "attributes" || Array.from([...m.addedNodes, ...m.removedNodes]).some(n =>
      n.nodeType === 1 && !n.matches("[data-yah-ui]") && !n.closest("[data-yah-ui]")
    ))) schedule();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
  refresh().catch(() => notice("非表示リストを読み込めません。ページを再読み込みしてください。"));
})();
