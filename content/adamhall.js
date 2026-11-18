// Adam Hall adapter (www.adamhall.com/shop/de, Nuxt single-page shop).
// Relies on (checked 2026-11-18, as guest):
//   search   /shop/de/search?query=<partNo>, results rendered in the browser
//   product  URL ends with "-<part no. without spaces>", e.g. /shop/de/rack-u-pan-1-2-label-872205lbl;
//            page shows "Artikel Nr.: <no.>"
//   buying   guests see "ANMELDEN FÜR PREISE" / "Anmelden zum Kaufen" (dealer shop). With a login the
//            adapter looks for the "Menge" field and an "In den Warenkorb" button – not testable without a login.
(() => {
  const SHOP = 'adamhall';
  const CART = location.origin + '/shop/de/cart';
  const { norm } = RW;

  const main = () => document.querySelector('main') || document.body;
  const artNo = () => { const m = main().innerText.match(/Artikel Nr\.:\s*([^\n]+)/); return m ? m[1].trim() : null; };

  async function product(ctx) {
    const no = await RW.waitFor(artNo);
    if (!no || norm(no) !== norm(ctx.item.partNo)) return ctx.done('failed', 'Produktseite zeigt Artikel Nr. ' + (no || '–'), location.href);
    if (/Anmelden zum Kaufen|Anmelden für Preise/i.test(main().innerText)) {
      return ctx.stopAll('login_required', 'Adam Hall verkauft nur an angemeldete Händler. Bitte selbst anmelden und erneut starten.');
    }
    const button = [...main().querySelectorAll('button')].find(b => /in den warenkorb|zum warenkorb/i.test(b.textContent) && !b.disabled);
    const qty = main().querySelector('input[type=number], input[name*=qty i], input[name*=menge i], input[aria-label*=Menge i]');
    if (!button || !qty) return ctx.done('failed', 'Kein Warenkorb-Button oder Mengenfeld gefunden', location.href);
    ctx.job.nav = { i: ctx.i, phase: 'adding' };
    await RW.save(ctx.job);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(qty, String(ctx.item.qty));
    qty.dispatchEvent(new Event('input', { bubbles: true }));
    qty.dispatchEvent(new Event('change', { bubbles: true }));
    await RW.sleep(500);
    button.click();
    await RW.sleep(3000);
    return ctx.done('added', 'Artikel Nr. ' + no + ' (Menge bitte im Warenkorb prüfen)', location.href);
  }

  RW.runPages(SHOP, CART, async ctx => {
    const phase = ctx.nav.i === ctx.i ? ctx.nav.phase : null;
    if (!phase) return ctx.go(location.origin + '/shop/de/search?query=' + encodeURIComponent(ctx.item.partNo), 'search');
    if (phase === 'product') return product(ctx);
    const want = norm(ctx.item.partNo);
    const links = () => [...new Set([...main().querySelectorAll('a[href*="/shop/de/"]')].map(a => a.href.split('?')[0]))];
    const ready = await RW.waitFor(() => /Suchergebnisse|keine/i.test(main().innerText) && links().length);
    const hits = (ready ? links() : []).filter(h => RW.slugTail(h) === want);
    if (hits.length === 1) return ctx.go(hits[0], 'product');
    if (hits.length > 1) return ctx.done('ambiguous', hits.join(' '));
    return ctx.done('not_found', '', location.href);
  });
})();
