// ProCase adapter (www.procaseshop.de, Magento 2 with Hyvä theme).
// Relies on (checked 2026-11-18, as guest):
//   search   GET /catalogsearch/result/?q=<partNo>  – protected by a bot check ("Bot Verification",
//            reCAPTCHA). The adapter opens it as a normal page and waits; it never solves the check.
//   results  .product-item cards (outside the .glider-slide carousels) with "Art.-Nr.: <no.>" and a link
//   product  page shows "Art.-Nr.: <no.>"
//   cart     form.product_addtocart_form (action /checkout/cart/add/…/product/<id>/, form_key, product);
//            guests only see "Anmelden für Preise" and no quantity field. With a dealer login the adapter
//            posts the same form with qty – this path could not be tested without a login.
//   cart     /checkout/cart/
(() => {
  const SHOP = 'procase';
  const CART = location.origin + '/checkout/cart/';
  const { norm } = RW;

  const isBotCheck = () => /bot verification/i.test(document.title) || /not a robot/i.test(document.body.innerText.slice(0, 300));
  const artNo = () => { const m = document.body.innerText.match(/Art\.-Nr\.:\s*([^\n]+)/); return m ? m[1].trim() : null; };
  const needsLogin = () => /Anmelden für Preise/i.test(document.body.innerText);

  async function product(ctx) {
    const no = artNo();
    if (!no || norm(no) !== norm(ctx.item.partNo)) return ctx.done('failed', 'Produktseite zeigt Art.-Nr. ' + (no || '–'), location.href);
    const form = [...document.querySelectorAll('form.product_addtocart_form, #product_addtocart_form')]
      .find(f => !f.closest('.glider-slide, .glider-track') && f.querySelector('[name=product]'));
    const qty = form && (form.querySelector('[name=qty]') || document.querySelector(`[name=qty][form="${form.id}"]`));
    if (!form || !qty || needsLogin()) {
      return ctx.stopAll('login_required', 'ProCase zeigt Preise und Warenkorb nur nach Händler-Login. Bitte selbst anmelden und erneut starten.');
    }
    ctx.job.nav = { i: ctx.i, phase: 'adding' };
    await RW.save(ctx.job);
    const body = new FormData(form);
    body.set('qty', String(ctx.item.qty));
    await RW.pause();
    // Hyvä fills %uenc% (Magento's base64 return URL) on submit; do the same.
    const uenc = btoa(location.href).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ',');
    const r = await fetch(form.action.replace('%25uenc%25', uenc), { method: 'POST', body, credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    if (!r.ok) return ctx.done('failed', 'Warenkorb antwortete ' + r.status, location.href);
    return ctx.done('added', 'Art.-Nr. ' + no, location.href);
  }

  RW.runPages(SHOP, CART, async ctx => {
    if (isBotCheck()) { RW.banner('Bitte die Bot-Prüfung des Shops abschließen – danach geht es weiter.'); return; }
    const phase = ctx.nav.i === ctx.i ? ctx.nav.phase : null;
    const searchUrl = location.origin + '/catalogsearch/result/?q=' + encodeURIComponent(ctx.item.partNo);
    if (!ctx.item.partNo) return ctx.done('not_found', 'Keine Teilenummer');
    if (!phase) return ctx.go(searchUrl, 'search');
    const onSearch = location.pathname.startsWith('/catalogsearch/');
    if (!onSearch) return product(ctx); // product page (also when the search jumps straight to it)
    // Search result cards show "Art.-Nr.: <no.>"; take the card whose number is exactly the part number.
    const want = norm(ctx.item.partNo);
    const main = document.querySelector('#maincontent') || document.body;
    const hits = [...new Set([...main.querySelectorAll('.product-item')]
      .filter(c => !c.closest('.glider-slide') && !c.classList.contains('glider-slide'))
      .filter(c => { const m = c.innerText.match(/Art\.-Nr\.:\s*(\S+)/); return m && norm(m[1]) === want; })
      .map(c => (c.querySelector('a[href]') || {}).href)
      .filter(Boolean)
      .map(h => h.split('?')[0]))];
    if (hits.length === 1) return ctx.go(hits[0], 'product');
    if (hits.length > 1) return ctx.done('ambiguous', hits.join(' '));
    return ctx.done('not_found', '', location.href);
  });
})();
