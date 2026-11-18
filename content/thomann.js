// Thomann adapter (www.thomann.de, German shop /de/).
// Relies on (checked 2026-11-18):
//   search   GET  /de/search_dir.html?sw=<text>   server-rendered result list
//            cards: .product > a.product__content[href], .title__manufacturer, .title__name
//   product  form.buy-form  action /de/basket_add.html, hidden inputs ar (article no.) and menge (quantity)
//   cart     /de/basket.html
// No login is needed; the cart is kept in the shop's session cookie.
(async () => {
  const SHOP = 'thomann';
  const BASE = location.origin + '/de/';
  let job = await RW.claim(SHOP);
  if (!job) return;

  const { norm } = RW;

  // Original text after the first n letters/digits of s.
  function restAfter(s, n) {
    let seen = 0;
    for (let k = 0; k < s.length; k++) {
      if (/[\p{L}\p{N}]/u.test(s[k])) seen++;
      if (seen === n) return s.slice(k + 1).trim();
    }
    return '';
  }

  function cards(doc) {
    const seen = new Set();
    return [...doc.querySelectorAll('.product')].map(p => {
      const a = p.querySelector('a.product__content[href]');
      const maker = (p.querySelector('.title__manufacturer') || {}).textContent || '';
      const name = (p.querySelector('.title__name') || {}).textContent || '';
      if (!a || !name) return null;
      const href = new URL(a.getAttribute('href'), BASE);
      href.search = '';
      return { href: href.href, maker: maker.trim(), name: name.trim() };
    }).filter(c => c && !seen.has(c.href) && seen.add(c.href));
  }

  // Exact match on maker + part number (ignoring spaces/dashes). A longer title is only accepted
  // when exactly one card starts with the part number and the rest is descriptive text
  // (has lower-case letters), e.g. "872215 U-shaped Rack Panel 1U" – but not "NC3 MD-L1 BAG".
  function match(item, list) {
    const maker = norm(item.maker), part = norm(item.partNo);
    if (!maker || !part) {
      const want = norm(item.search);
      const exact = list.filter(c => norm(c.maker + c.name) === want);
      return exact.length === 1 ? { card: exact[0], how: 'exact' } : { error: exact.length ? 'ambiguous' : 'not_found' };
    }
    const same = list.filter(c => norm(c.maker) === maker);
    const exact = same.filter(c => norm(c.name) === part);
    if (exact.length === 1) return { card: exact[0], how: 'exact' };
    if (exact.length > 1) return { error: 'ambiguous', detail: exact.map(c => c.maker + ' ' + c.name).join(' / ') };
    const prefix = same.filter(c => norm(c.name).startsWith(part));
    const descriptive = prefix.filter(c => /\p{Ll}/u.test(restAfter(c.name, part.length)));
    if (prefix.length === 1 && descriptive.length === 1) return { card: descriptive[0], how: 'title' };
    if (prefix.length) return { error: 'ambiguous', detail: 'Nur ähnliche Artikel: ' + prefix.slice(0, 4).map(c => c.maker + ' ' + c.name).join(' / ') };
    return { error: 'not_found' };
  }

  async function addItem(item) {
    const q = item.maker && item.partNo ? item.maker + ' ' + item.partNo : item.search;
    const s = await RW.fetchDoc(BASE + 'search_dir.html?sw=' + encodeURIComponent(q));
    let productUrl, productDoc, how, title = '';
    const buyOnPage = s.doc.querySelector('form.buy-form');
    if (buyOnPage && !/search_dir/.test(s.url)) {
      // Thomann jumped straight to a product page: check its title.
      const h1 = norm((s.doc.querySelector('h1') || {}).textContent);
      if (!h1.startsWith(norm(q))) return { status: 'not_found', detail: 'Weiterleitung auf anderen Artikel' };
      productUrl = s.url; productDoc = s.doc; how = 'exact';
    } else {
      const m = match(item, cards(s.doc));
      if (m.error) return { status: m.error, detail: m.detail || '' };
      await RW.pause();
      const p = await RW.fetchDoc(m.card.href);
      productUrl = m.card.href; productDoc = p.doc; how = m.how;
      title = m.card.maker + ' ' + m.card.name;
    }
    const form = productDoc.querySelector('form.buy-form');
    const ar = form && form.querySelector('input[name="ar"]');
    if (!ar) return { status: 'failed', detail: 'Kein Warenkorb-Button auf der Produktseite', url: productUrl };
    const body = new URLSearchParams();
    for (const el of form.querySelectorAll('input[name]')) body.set(el.name, el.value);
    body.set('menge', String(item.qty));
    await RW.pause();
    const r = await fetch(new URL(form.getAttribute('action'), BASE).href, {
      method: 'POST', credentials: 'include', body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    if (!r.ok) return { status: 'failed', detail: 'Warenkorb antwortete ' + r.status, url: productUrl };
    // Thomann answers with a redirect to basket.html?addedStatus=success&gtmArticleNumber=<ar>.
    const back = new URL(r.url).searchParams;
    if (back.get('addedStatus') !== 'success' || back.get('gtmArticleNumber') !== ar.value) {
      return { status: 'failed', detail: 'Thomann hat das Hinzufügen nicht bestätigt' + (back.get('addedMessage') ? ': ' + back.get('addedMessage') : ''), url: productUrl };
    }
    return {
      status: 'added', url: productUrl, ar: ar.value,
      detail: (how === 'title' ? 'Treffer über Titel: ' : '') + (title || '') + ' · Art.-Nr. ' + ar.value
    };
  }

  for (let i = job.i; i < job.items.length; i++) {
    if (!(await RW.running(SHOP))) { RW.banner('abgebrochen.'); return; }
    const item = job.items[i];
    RW.banner(`${i + 1}/${job.items.length}: ${item.qty}× ${item.search}`);
    if (job.results[i].status === 'working') {
      // The page was left while this item was being added: do not add it twice.
      await RW.result(job, i, 'unknown', 'Unterbrochen – bitte im Warenkorb prüfen');
      job = (await RW.next(job, i + 1)) || job;
      continue;
    }
    await RW.result(job, i, 'working');
    let r;
    try { r = await addItem(item); } catch (e) { r = { status: 'failed', detail: String(e && e.message || e) }; }
    await RW.result(job, i, r.status, r.detail, r.url);
    job = (await RW.next(job, i + 1)) || job;
    await RW.pause();
  }
  const added = job.results.filter(r => r.status === 'added').length;
  RW.banner(`${added} von ${job.items.length} Artikeln in den Warenkorb gelegt.`);
  await RW.finish(job, 'done', `${added} von ${job.items.length} hinzugefügt.`, BASE + 'basket.html');
})();
