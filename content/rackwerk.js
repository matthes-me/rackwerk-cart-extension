// Content script on the Rack Manufaktur page: reads the orders (read-only API v1)
// and stores them in chrome.storage.local for the popup.
(() => {
  if (!document.querySelector('meta[name="rackwerk-api"]')) return;

  function rackwerk(method, params) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { removeEventListener('message', onMsg); reject({ code: 'timeout' }); }, 15000);
      const onMsg = ev => {
        const m = ev.data;
        if (ev.source !== window || !m || m.rackwerk == null || m.id !== id || m.method) return;
        clearTimeout(timer);
        removeEventListener('message', onMsg);
        m.error ? reject(m.error) : resolve(m.result);
      };
      addEventListener('message', onMsg);
      window.postMessage({ rackwerk: 1, id, method, params }, location.origin);
    });
  }

  async function read() {
    try {
      const orders = await rackwerk('getOrders', {});
      await chrome.storage.local.set({ orders, ordersFrom: location.href, ordersAt: new Date().toISOString() });
      return { ok: true, project: orders.project && orders.project.name };
    } catch (e) {
      return { ok: false, error: e && (e.code || e.message) || String(e) };
    }
  }

  // Read once the page is ready; it may still be starting up, so retry a few times.
  (async () => {
    for (let n = 0; n < 5; n++) {
      const r = await read();
      if (r.ok) break;
      await new Promise(res => setTimeout(res, 1000));
    }
  })();

  // Keep the stored orders current: subscribe to change events from the page itself.
  let debounce;
  addEventListener('message', ev => {
    const m = ev.data;
    if (ev.source !== window || !m || m.rackwerk == null) return;
    if (m.event === 'change' || m.event === 'project' || m.event === 'ready') {
      clearTimeout(debounce);
      debounce = setTimeout(read, 500);
    }
  });
  rackwerk('subscribe').catch(() => {});

  // The popup can ask for a fresh read.
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg && msg.type === 'rackwerk-read') { read().then(reply); return true; }
  });
})();
