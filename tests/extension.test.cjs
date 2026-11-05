const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, name), 'utf8');
const pause = () => new Promise(resolve => setTimeout(resolve, 160));

function backend() {
  const data = {};
  const listeners = new Set();
  return {
    data, fail: false,
    client() {
      const self = this;
      return {
        runtime: { getURL: file => `chrome-extension://test/${file}`, openOptionsPage: async () => {}, sendMessage: async () => ({ok:true}) },
        storage: {
          local: {
            async get() { return structuredClone(data); },
            async set(values) {
              if (self.fail) throw new Error('Storage unavailable');
              const changes = {};
              for (const [key, value] of Object.entries(values)) {
                changes[key] = { oldValue: data[key], newValue: structuredClone(value) };
                data[key] = structuredClone(value);
              }
              for (const listener of listeners) listener(changes, 'local');
            },
            async remove(key) {
              if (self.fail) throw new Error('Storage unavailable');
              const oldValue = data[key];
              delete data[key];
              for (const listener of listeners) listener({ [key]: { oldValue } }, 'local');
            }
          },
          onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) }
        }
      };
    }
  };
}
function card(id, title = 'テスト商品', host = 'auctions.yahoo.co.jp') {
  return `<li><div><div><a href="https://${host}/jp/auction/${id}"><img alt="${title}"></a></div><div><a href="https://${host}/jp/auction/${id}">${title}</a><ul><li>カテゴリ</li></ul><button class="watch">ウォッチ</button></div></div></li>`;
}
async function page(store, layout = 'grid', ids = ['a123', 'b456']) {
  const dom = new JSDOM(`<!doctype html><style>${source('content.css')} #searchItems > ul {display:${layout === 'grid' ? 'grid' : 'block'};grid-template-columns:repeat(3,1fr)}</style><div id="searchItems"><ul>${ids.map(id => card(id)).join('')}</ul></div><div id="recommendations"><ul>${card('a123')}</ul></div>`, {
    url: 'https://auctions.yahoo.co.jp/search/search?p=test', runScripts: 'outside-only'
  });
  dom.window.chrome = store.client();
  dom.window.eval(source('common.js'));
  dom.window.eval(source('content.js'));
  await pause();
  return dom;
}

for (const layout of ['grid', 'list']) test(`${layout}: hide full card without gap, undo, and preserve watch button`, async t => {
  const store = backend();
  const dom = await page(store, layout);
  t.after(() => dom.window.close());
  const { document: doc } = dom.window;
  const cards = doc.querySelectorAll('#searchItems > ul > li');
  assert.equal(doc.querySelectorAll('.yah-hide-button').length, 2);
  assert.equal(doc.querySelectorAll('#recommendations .yah-hide-button').length, 0);
  cards[0].querySelector('.yah-hide-button').click();
  await pause();
  assert.equal(dom.window.getComputedStyle(cards[0]).display, 'none');
  assert.notEqual(dom.window.getComputedStyle(cards[1]).display, 'none');
  assert.equal(cards[0].querySelectorAll('.watch').length, 1);
  assert.equal(Object.keys(store.data).length, 1);
  assert.match(doc.querySelector('.yah-bar').textContent, /このページで 1 件/);
  [...doc.querySelectorAll('.yah-toast button')].find(el => el.textContent === '元に戻す').click();
  await pause();
  assert.notEqual(dom.window.getComputedStyle(cards[0]).display, 'none');
  assert.equal(Object.keys(store.data).length, 0);
});

test('persists across search/layout/restart and restores across open tabs', async t => {
  const store = backend();
  const first = await page(store);
  t.after(() => first.window.close());
  first.window.document.querySelector('.yah-hide-button').click();
  await pause();
  const second = await page(store, 'list');
  t.after(() => second.window.close());
  assert.equal(second.window.document.querySelectorAll('.yah-hidden').length, 1);
  await second.window.YAHide.restore('a123');
  await pause();
  assert.equal(first.window.document.querySelectorAll('.yah-hidden').length, 0);
  assert.equal(second.window.document.querySelectorAll('.yah-hidden').length, 0);
});

test('dynamic replacement, duplicate links, featured auctions, and recycled cards', async t => {
  const store = backend();
  const dom = await page(store);
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  await dom.window.YAHide.hide({id:'a123', title:'商品', url:'https://auctions.yahoo.co.jp/jp/auction/a123'});
  doc.querySelector('#searchItems').innerHTML = `<section><ul>${card('a123', '新しいタイトル', 'page.auctions.yahoo.co.jp')}${card('c789')}</ul></section>`;
  const featured = doc.createElement('div');
  featured.id = 'featuredItems';
  featured.innerHTML = `<ul>${card('a123')}</ul>`;
  doc.body.append(featured);
  await pause();
  assert.equal(doc.querySelectorAll('.yah-hidden').length, 2);
  assert.equal(doc.querySelectorAll('.yah-hide-button').length, 3);
  const reused = doc.querySelector('#searchItems li');
  reused.querySelectorAll('a').forEach(a => a.href = 'https://auctions.yahoo.co.jp/jp/auction/d111');
  await pause();
  assert.equal(reused.classList.contains('yah-hidden'), false);
  reused.querySelector('.yah-hide-button').click();
  await pause();
  assert.ok(store.data['yahHidden:d111']);
  assert.equal(doc.querySelectorAll('.yah-bar').length, 1);
});

test('concurrent writes do not overwrite other auctions; storage failure keeps card visible', async t => {
  const store = backend();
  const dom = await page(store);
  t.after(() => dom.window.close());
  const buttons = dom.window.document.querySelectorAll('.yah-hide-button');
  buttons[0].click(); buttons[1].click();
  await pause();
  assert.equal(Object.keys(store.data).length, 2);
  await dom.window.YAHide.restore('a123');
  store.fail = true;
  buttons[0].click();
  await pause();
  assert.equal(dom.window.document.querySelector('#searchItems > ul > li').classList.contains('yah-hidden'), false);
  assert.match(dom.window.document.querySelector('.yah-toast').textContent, /保存できません/);
});

test('only valid Yahoo auction IDs are accepted and malformed storage is ignored', async t => {
  const dom = await page(backend());
  t.after(() => dom.window.close());
  const api = dom.window.YAHide;
  for (const url of ['https://evil.example/jp/auction/a1', 'https://auctions.yahoo.co.jp.evil.example/jp/auction/a1', 'javascript:alert(1)', 'https://auctions.yahoo.co.jp/jp/auction/a1/extra']) assert.equal(api.auctionId(url), null);
  assert.equal(api.auctionId('https://page.auctions.yahoo.co.jp/jp/auction/a1?x=1'), 'a1');
  assert.equal(api.entries({'yahHidden:a1': {id:'a1',url:'javascript:alert(1)'}}).length, 0);
});

test('manager filters safely and restores a saved item with undo', async t => {
  const store = backend();
  const search = await page(store);
  t.after(() => search.window.close());
  await search.window.YAHide.hide({id:'a123', title:'<img src=x onerror=alert(1)> タイヤ', url:'https://auctions.yahoo.co.jp/jp/auction/a123'});
  const dom = new JSDOM(source('options.html'), {url:'https://example.test',runScripts:'outside-only'});
  t.after(() => dom.window.close());
  dom.window.chrome = store.client();
  dom.window.eval(source('common.js')); dom.window.eval(source('manager.js'));
  await pause();
  const doc = dom.window.document;
  assert.equal(doc.querySelectorAll('article').length, 1);
  assert.equal(doc.querySelectorAll('article img').length, 0);
  const input = doc.getElementById('filter');
  input.value = 'not found'; input.dispatchEvent(new dom.window.Event('input'));
  assert.equal(doc.querySelectorAll('article').length, 0);
  input.value = 'タイヤ'; input.dispatchEvent(new dom.window.Event('input'));
  doc.querySelector('article button').click(); await pause();
  assert.equal(doc.querySelectorAll('article').length, 0);
  assert.equal(search.window.document.querySelectorAll('.yah-hidden').length, 0);
  doc.querySelector('#message button').click(); await pause();
  assert.equal(doc.querySelectorAll('article').length, 1);
  assert.equal(search.window.document.querySelectorAll('.yah-hidden').length, 1);
});

test('manifest restricts access and all declared files exist', () => {
  const manifest = JSON.parse(source('manifest.json'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage']);
  for (const file of [...manifest.content_scripts[0].js, ...manifest.content_scripts[0].css, manifest.options_page, manifest.action.default_popup, manifest.background.service_worker]) assert.ok(fs.existsSync(path.join(root,file)), file);
});
