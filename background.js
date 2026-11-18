// Background worker: starts a cart job for one shop and opens the shop in a new tab.
// The shop's content script (adapter) picks the job up from chrome.storage.local.
importScripts('shops.js');

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg) return;
  if (msg.type === 'whoami') { reply({ tabId: sender.tab && sender.tab.id }); return; }
  if (msg.type === 'start') { start(msg.shop).then(reply); return true; }
  if (msg.type === 'stop') { stop().then(reply); return true; }
});

async function start(shopId) {
  const shop = SHOPS[shopId];
  if (!shop) return { ok: false, error: 'unknown shop' };
  const { orders, job: old } = await chrome.storage.local.get(['orders', 'job']);
  if (old && old.status === 'running') return { ok: false, error: 'Es läuft schon ein Auftrag (' + SHOPS[old.shop].name + ').' };
  const items = shopItems(shopId, orders);
  if (!items.length) return { ok: false, error: 'Keine Artikel für ' + shop.name + '.' };
  const tab = await chrome.tabs.create({ url: shop.start, active: true });
  const job = {
    shop: shopId, tabId: tab.id, status: 'running', i: 0, items,
    results: items.map(it => ({ key: it.key, name: it.name, qty: it.qty, status: 'pending' })),
    project: orders.project && orders.project.name, startedAt: new Date().toISOString(), message: ''
  };
  await chrome.storage.local.set({ job });
  return { ok: true };
}

async function stop() {
  const { job } = await chrome.storage.local.get('job');
  if (job && job.status === 'running') {
    job.status = 'stopped';
    job.message = 'Abgebrochen.';
    await chrome.storage.local.set({ job });
  }
  return { ok: true };
}

// A closed shop tab ends its job.
chrome.tabs.onRemoved.addListener(async tabId => {
  const { job } = await chrome.storage.local.get('job');
  if (job && job.status === 'running' && job.tabId === tabId) {
    job.status = 'stopped';
    job.message = 'Shop-Tab wurde geschlossen.';
    await chrome.storage.local.set({ job });
  }
});
