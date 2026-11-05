(() => {
  "use strict";
  const api = globalThis.YAHide;
  const filter = document.getElementById("filter");
  const list = document.getElementById("items");
  const message = document.getElementById("message");
  let items = [];
  let version = 0;
  function render() {
    const query = filter.value.trim().toLocaleLowerCase();
    const shown = items.filter(item => `${item.title} ${item.id}`.toLocaleLowerCase().includes(query));
    document.getElementById("count").textContent = `${items.length} 件を登録 ／ ${shown.length} 件を表示`;
    list.replaceChildren();
    if (!shown.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = items.length ? "一致する商品はありません。" : "非表示にした商品はありません。";
      list.append(empty);
    }
    for (const item of shown) {
      const row = document.createElement("article");
      const details = document.createElement("div");
      const link = document.createElement("a");
      link.textContent = item.title;
      link.href = `https://auctions.yahoo.co.jp/jp/auction/${item.id}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const meta = document.createElement("small");
      const date = new Date(item.hiddenAt);
      meta.textContent = `${item.id}${Number.isFinite(date.getTime()) ? " ・ " + date.toLocaleDateString("ja-JP") : ""}`;
      details.append(link, meta);
      const restore = document.createElement("button");
      restore.type = "button";
      restore.textContent = "解除";
      restore.setAttribute("aria-label", `${item.title} の非表示を解除`);
      restore.addEventListener("click", async () => {
        restore.disabled = true;
        try {
          await api.restore(item.id);
          await refresh();
          message.textContent = "非表示を解除しました。";
          const again = document.createElement("button");
          again.textContent = "取り消す";
          again.type = "button";
          again.addEventListener("click", async () => {
            again.disabled = true;
            try { await api.hide(item); await refresh(); message.textContent = "再び非表示にしました。"; }
            catch { again.disabled = false; message.textContent = "保存できませんでした。もう一度お試しください。"; }
          });
          message.append(" ", again);
        } catch {
          restore.disabled = false;
          message.textContent = "解除できませんでした。もう一度お試しください。";
        }
      });
      row.append(details, restore);
      list.append(row);
    }
  }
  async function refresh() {
    const current = ++version;
    const result = await api.read();
    if (current !== version) return;
    items = result.sort((a, b) => b.hiddenAt - a.hiddenAt);
    render();
  }
  function failed() { message.textContent = "読み込みに失敗しました。画面を開き直してください。"; }
  api.watch(() => { refresh().catch(failed); });
  filter.addEventListener("input", render);
  document.getElementById("open-options")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
  refresh().catch(failed);
})();
