// Helpers shared by the shop adapters (loaded before each adapter).
/* exported RW */

const RW = (() => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Pause between shop requests: sequential and unhurried, never parallel.
  const pause = () => sleep(1500 + Math.random() * 1000);

  // Compare part numbers and names without spaces, dashes, dots or case.
  const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');

  let myTabId = null;
  async function tabId() {
    if (myTabId == null) myTabId = (await chrome.runtime.sendMessage({ type: 'whoami' })).tabId;
    return myTabId;
  }

  // The running job for this shop, but only in the tab the job was started in.
  async function job(shopId) {
    const { job } = await chrome.storage.local.get('job');
    if (!job || job.status !== 'running' || job.shop !== shopId) return null;
    if (job.tabId !== await tabId()) return null;
    return job;
  }

  async function save(j) { await chrome.storage.local.set({ job: j }); }

  // Shops prerender pages (Speculation Rules) and Chrome runs content scripts there too, in the same
  // tab. Never work from a page the user does not see yet.
  async function visible() {
    if (document.prerendering) await new Promise(r => document.addEventListener('prerenderingchange', r, { once: true }));
  }

  // Only one page instance may work on a job: it holds a lease that it renews while working.
  const ME = crypto.randomUUID();
  const LEASE_MS = 20000;
  const held = j => j.runner && j.runner.id !== ME && Date.now() - j.runner.beat < LEASE_MS;
  async function claim(shopId) {
    await visible();
    for (let wait = 0; wait <= LEASE_MS + 5000; wait += 1000) {
      const j = await job(shopId);
      if (!j) return null;
      if (!held(j)) {
        j.runner = { id: ME, beat: Date.now() };
        await save(j);
        await sleep(400);
        const again = await job(shopId);
        if (again && again.runner && again.runner.id === ME) return again;
        return null; // another instance won the race
      }
      await sleep(1000);
    }
    return null;
  }

  // Before leaving the page: give the lease back so the next page can take over at once.
  async function release() {
    const { job: cur } = await chrome.storage.local.get('job');
    if (cur && cur.runner && cur.runner.id === ME) { cur.runner = null; await save(cur); }
  }

  // Re-read the job and tell whether it is still running and still ours (the user may have pressed stop).
  async function running(shopId) {
    const j = await job(shopId);
    if (!j || !j.runner || j.runner.id !== ME) return false;
    j.runner.beat = Date.now();
    await save(j);
    return true;
  }

  async function result(j, i, status, detail, url) {
    // Merge into the current stored job so a stop pressed meanwhile is kept.
    const { job: cur } = await chrome.storage.local.get('job');
    const target = cur && cur.startedAt === j.startedAt ? cur : j;
    target.results[i] = Object.assign({}, target.results[i], { status, detail: detail || '', url: url || '' });
    if (target.runner && target.runner.id === ME) target.runner.beat = Date.now();
    j.results[i] = target.results[i];
    await save(target);
  }

  async function next(j, i) {
    const { job: cur } = await chrome.storage.local.get('job');
    if (!cur || cur.startedAt !== j.startedAt) return null;
    cur.i = i;
    await save(cur);
    return cur;
  }

  async function finish(j, status, message, cartUrl) {
    const { job: cur } = await chrome.storage.local.get('job');
    const target = cur && cur.startedAt === j.startedAt ? cur : j;
    if (target.status === 'running') target.status = status;
    target.message = message || target.message || '';
    target.finishedAt = new Date().toISOString();
    target.runner = null;
    await save(target);
    if (cartUrl && location.href !== cartUrl) location.href = cartUrl;
  }

  async function fetchDoc(url, init) {
    const r = await fetch(url, Object.assign({ credentials: 'include' }, init));
    const html = await r.text();
    return { res: r, url: r.url, doc: new DOMParser().parseFromString(html, 'text/html') };
  }

  // Small status banner on the shop page so the user sees what is happening.
  function banner(text) {
    let el = document.getElementById('rw-cart-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'rw-cart-banner';
      el.style.cssText = 'position:fixed;z-index:2147483647;left:12px;bottom:12px;max-width:420px;padding:10px 14px;' +
        'background:#1f2328;color:#fff;font:13px/1.4 system-ui,sans-serif;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.3)';
      document.documentElement.appendChild(el);
    }
    el.textContent = 'Rack Manufaktur: ' + text;
  }

  return { sleep, pause, norm, job, claim, release, save, running, result, next, finish, fetchDoc, banner };
})();

// Page-by-page runner for shops that need real navigation (bot checks, client-side rendering).
// The adapter's step(ctx) is called on every page load of the job's tab and returns nothing;
// it uses ctx.go(url) to move on, ctx.done(status, detail, url) to record the current item.
RW.runPages = async function (shopId, cartUrl, step) {
  let job = await RW.claim(shopId);
  if (!job) return;
  const nav = job.nav || {};
  if (job.i >= job.items.length) {
    const added = job.results.filter(r => r.status === 'added').length;
    RW.banner(`${added} von ${job.items.length} Artikeln in den Warenkorb gelegt.`);
    return RW.finish(job, 'done', `${added} von ${job.items.length} hinzugefügt.`, cartUrl);
  }
  const i = job.i, item = job.items[i];
  RW.banner(`${i + 1}/${job.items.length}: ${item.qty}× ${item.search}`);
  const ctx = {
    job, i, item, nav,
    async go(url, phase) {
      const same = nav.i === i && nav.phase === phase;
      job.nav = { i, phase, tries: same ? (nav.tries || 0) + 1 : 1 };
      if (job.nav.tries > 3) return ctx.done('failed', 'Seite ließ sich nicht öffnen: ' + url);
      job.runner = null;
      await RW.save(job);
      await RW.pause();
      location.href = url;
    },
    async done(status, detail, url) {
      await RW.result(job, i, status, detail, url);
      const cur = await RW.next(job, i + 1);
      if (!cur || cur.status !== 'running') return;
      cur.nav = {};
      cur.runner = null;
      await RW.save(cur);
      await RW.pause();
      location.reload(); // next page load handles the next item
    },
    async stopAll(status, message) {
      for (let k = i; k < job.items.length; k++) await RW.result(job, k, status, message);
      await RW.finish(job, 'done', message, null);
      RW.banner(message);
    }
  };
  if (nav.i === i && nav.phase === 'adding') {
    // The page was left while this item was being added: do not add it twice.
    return ctx.done('unknown', 'Unterbrochen – bitte im Warenkorb prüfen');
  }
  try { await step(ctx); } catch (e) { await ctx.done('failed', String(e && e.message || e)); }
};

// Wait until fn() returns something truthy (client-rendered pages).
RW.waitFor = async function (fn, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await RW.sleep(300); }
  return null;
};

// Last part of a product URL after the final dash, e.g. ".../rack-u-pan-01-d12-tie-bar-872215" → "872215".
RW.slugTail = href => {
  const seg = new URL(href, location.href).pathname.replace(/\/+$/, '').split('/').pop() || '';
  return RW.norm(seg.split('-').pop());
};
