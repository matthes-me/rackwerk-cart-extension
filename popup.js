/* global SHOPS, shopItems */
const $ = s => document.querySelector(s);
const eur = n => n == null ? '–' : n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const STATUS = {
  pending: 'offen', working: 'läuft', added: 'im Warenkorb', not_found: 'nicht gefunden', ambiguous: 'nicht eindeutig',
  failed: 'Fehler', login_required: 'Login nötig', unknown: 'unklar'
};

async function render() {
  const { orders, ordersAt, job } = await chrome.storage.local.get(['orders', 'ordersAt', 'job']);
  if (orders) {
    $('#src').textContent = `Projekt „${orders.project && orders.project.name || '–'}“ · gelesen ${new Date(ordersAt).toLocaleString('de-DE')}`;
  }
  const busy = job && job.status === 'running';
  $('#shops').innerHTML = '';
  for (const [id, shop] of Object.entries(SHOPS)) {
    const items = orders ? shopItems(id, orders) : [];
    const known = items.filter(i => i.price != null);
    const total = known.reduce((s, i) => s + i.price * i.qty, 0);
    const sec = document.createElement('section');
    sec.innerHTML = `
      <div class="row"><span class="shop">${esc(shop.name)}</span>
        <span>${items.length} Artikel · ${known.length ? eur(total) : '–'}${known.length && known.length < items.length ? ' (ohne ' + (items.length - known.length) + ')' : ''}</span></div>
      ${shop.note ? `<div class="mute">${esc(shop.note)}</div>` : ''}
      <button ${!items.length || busy ? 'disabled' : ''}>In den Warenkorb legen</button>`;
    sec.querySelector('button').onclick = async () => {
      const r = await chrome.runtime.sendMessage({ type: 'start', shop: id });
      if (!r.ok) alert(r.error);
      render();
    };
    $('#shops').appendChild(sec);
  }

  // Suppliers no adapter covers (information only).
  const covered = new Set(['thomann', 'procase']);
  const rest = (orders && orders.suppliers || []).filter(s => !covered.has(s.supplierId));
  $('#others').hidden = !rest.length;
  $('#others').innerHTML = '<div class="mute">Ohne Adapter (bitte selbst bestellen):</div><ul>' +
    rest.map(s => `<li>${esc(s.supplier)} · ${s.items.length} Artikel · ${eur(s.total)}</li>`).join('') + '</ul>';

  $('#job').hidden = !job;
  if (job) {
    const head = `${esc(SHOPS[job.shop].name)}: ${busy ? 'läuft …' : esc(job.message || job.status)}`;
    $('#job').innerHTML = `<div class="row"><b>${head}</b>${busy ? '<button class="ghost" id="stop">Stopp</button>' : ''}</div>
      <ul>${job.results.map(r => `<li><span class="st ${r.status}">${STATUS[r.status] || r.status}</span> ${r.qty}× ${esc(r.name)}
        ${r.detail ? `<div class="mute">${esc(r.detail)}</div>` : ''}${r.url ? `<div class="mute"><a href="${esc(r.url)}" target="_blank">Produktseite</a></div>` : ''}</li>`).join('')}</ul>`;
    const stop = $('#stop');
    if (stop) stop.onclick = () => chrome.runtime.sendMessage({ type: 'stop' }).then(render);
  }
}

$('#reload').onclick = async () => {
  const tabs = await chrome.tabs.query({});
  let ok = false;
  for (const t of tabs) {
    try { const r = await chrome.tabs.sendMessage(t.id, { type: 'rackwerk-read' }); if (r && r.ok) ok = true; } catch (e) { /* no content script there */ }
  }
  if (!ok) $('#src').textContent = 'Kein Rack-Manufaktur-Tab gefunden. Seite öffnen und erneut versuchen.';
  render();
};

chrome.storage.onChanged.addListener(render);
render();
