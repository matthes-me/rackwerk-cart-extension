# Rack Manufaktur – cart extension (Chrome, Manifest V3)

Takes the orders per supplier from Rack Manufaktur and puts the items into the carts at
**Thomann**, **ProCase** and **Adam Hall**. It stops at the cart: it never logs in, never enters
credentials and never checks out.

## Install (unpacked)

1. `chrome://extensions` → switch on *Developer mode* → *Load unpacked* → pick this `extension/` folder.
2. Open Rack Manufaktur (`https://td-media.eu/rackwerk/` or locally:
   `python3 -m http.server -d public` → `http://localhost:8000/`). The extension reads the orders by itself
   and again after every change.
3. Click the extension icon: suppliers with item count and total; **In den Warenkorb legen** opens the shop
   in a new tab and runs its adapter. The popup shows the result per item; the shop tab shows a small
   status banner and ends on the cart page.

## How it works

| File | Role |
|---|---|
| `content/rackwerk.js` | On the Rack Manufaktur page (only if `<meta name="rackwerk-api" content="1">` is present): calls `getOrders` over `window.postMessage` (API v1, read-only), stores the result in `chrome.storage.local`, subscribes to `change` events to keep it current |
| `popup.html/js` | Lists suppliers, starts a job, shows per-item results, *Stopp* |
| `background.js` | Creates the job (`chrome.storage.local.job`) and opens the shop tab; a closed tab ends the job |
| `shops.js` | Which items each shop gets |
| `content/shop-common.js` | Shared adapter helpers: job lease, pauses, status banner, page-by-page runner |
| `content/thomann.js`, `procase.js`, `adamhall.js` | One adapter per shop |

Items per shop: Thomann = supplier `thomann`; ProCase = supplier `procase`; Adam Hall = every item with
`maker === 'Adam Hall'`, whatever dealer it is planned at (so the Adam Hall button also lists parts that
are planned at Thomann, Rockshop or envirel).

Per item the result is one of: *im Warenkorb* (added), *nicht gefunden*, *nicht eindeutig* (several
candidates – nothing is added), *Login nötig*, *Fehler*, *unklar* (the page was left while adding; check
the cart). The adapters never pick a "close" product: no exact match → nothing is added.

Behaviour towards the shops: one tab, one item at a time, 1.5–2.5 s pause between every request, normal
same-origin requests with the shop's own cookies. Shops prerender pages (Speculation Rules) and Chrome runs
content scripts in those too, so adapters wait until the page is actually shown and hold a lease in the
job so that only one page instance works on it (without this, Thomann ran two adapters at once).

## What each adapter relies on (checked 2026-11-18)

### Thomann – works without login (tested)

- Search: `GET /de/search_dir.html?sw=<maker> <partNo>` (or `search` when there is no part number),
  server-rendered. Cards: `.product` › `a.product__content[href]`, `.title__manufacturer`, `.title__name`.
- Match: maker equal and title equal to the part number, ignoring spaces, dashes and case
  (`NC3MD-L-1` = `NC3 MD-L1`). A longer title is accepted only if it is the single card that starts with
  the part number and the rest is descriptive text with lower-case letters
  (`872215 U-shaped Rack Panel 1U` yes; `NC3 MD-L1 BAG`, `NE8FDP-TOP`, `SAC3FPX20 - 67` no).
- Product page: `form.buy-form` → `POST /de/basket_add.html` with `ar` (Thomann article number) and
  `menge` (quantity).
- Confirmation: Thomann redirects to `basket.html?addedStatus=success&gtmArticleNumber=<ar>`; anything
  else is reported as an error.
- Cart: `/de/basket.html`.

### ProCase – needs a dealer login (search and matching tested, adding not)

- Search: `/catalogsearch/result/?q=<partNo>` (Magento 2, Hyvä). It sits behind a bot check
  ("Bot Verification", reCAPTCHA). The adapter opens it as a normal page; in a normal Chrome the check
  passed by itself. If it shows a challenge, the adapter waits for the user and never solves it.
- Match: result card (`.product-item`, outside the `.glider-slide` carousels) whose `Art.-Nr.:` is exactly
  the part number (`135508`, not `135508D`).
- Product page shows `Art.-Nr.: <no.>`. Guests see "Anmelden für Preise" and no quantity field or cart
  button → the job stops with *Login nötig* for all items.
- With a login (untested): posts `form.product_addtocart_form` (`/checkout/cart/add/…/product/<id>/`,
  `form_key`, `product`) with `qty`. Cart: `/checkout/cart/`.

### Adam Hall – needs a dealer login (search and matching tested, adding not)

- Search: `/shop/de/search?query=<partNo>` (Nuxt, rendered in the browser; the adapter waits up to 10 s).
- Match: product URL ends with `-<part number without spaces>`
  (`872205 LBL` → `/shop/de/rack-u-pan-1-2-label-872205lbl`); product page shows `Artikel Nr.: <no.>`.
  Dry run: all six Adam Hall parts of the example project were found exactly.
- Guests see "ANMELDEN FÜR PREISE" / "Anmelden zum Kaufen" → *Login nötig*.
- With a login (untested): sets the "Menge" field and clicks the "In den Warenkorb" button. Cart:
  `/shop/de/cart` (assumed).

## Test result (example project "Beispiel · Anschlussrack", fresh Chrome profile)

Thomann, 14 items → 11 in the cart with the right quantities (checked on `basket.html`), 3 not found:

| Item | Result |
|---|---|
| Adam Hall 872205 LBL, 872215 (via title), Neutrik NC3FD-L-1, NC3MD-L-1, NE8FDP, NAHDMI-W-B, NAUSB-W-B, Millenium Blanking Plate D Format, Seetronic SAC3MPX TR1, SAC3FPX20, Thon Rack Screw M3 x 12 BK | added |
| Neutrik NC5FD-L-1 | not found (Thomann search returns nothing for it) |
| Adam Hall 872205 VR | not found (only 872005 VR / 87221VR at Thomann) |
| Adam Hall 87401 E | not found (only other drawers) |

ProCase, 2 items → *Login nötig* (135508 found exactly, stopped on the product page).
Adam Hall, 6 items → *Login nötig* (872205 LBL found exactly, stopped on the product page).

## Proposal: `shopRef` in `data/` (not implemented)

Searching works for most parts, but not for all (three Thomann misses above, and Thomann titles differ
from part numbers). A shop's own number per item would make the adapters exact and skip the search:

```json
"shopRef": { "thomann": "141374", "procase": "135508", "adamhall": "872215" }
```

- Where: next to `art` on every orderable item in `data/` (devices, connector parts, panels, shelves,
  accessories), only for the shops where the item is actually sold. Values come from the shop's product
  page (Thomann "Artikelnummer", e.g. 141374 for Adam Hall 872215); like every other number, with the
  source URL in the PR.
- API: pass it through unchanged as `item.shopRef` in `getBom` / `getOrders`.
- Adapters: Thomann posts `basket_add.html` with `ar = shopRef.thomann` directly (and still reports the
  confirmation); ProCase and Adam Hall open the product page for the number and skip the search.
- Without `shopRef`, the adapters keep searching as they do now.

The Thomann numbers found in the test above (added items, from their product pages) would be a start:
510952 (872205 LBL), 141374 (872215), 105164 (NC3FD-L-1), 105167 (NC3MD-L-1), 185255 (NE8FDP),
232497 (NAHDMI-W-B), 185260 (NAUSB-W-B), 239787 (Millenium Blanking Plate D Format),
524708 (SAC3MPX TR1), 523370 (SAC3FPX20), 259265 (Thon Rack Screw M3 x 12 BK).

## Limits

- German shops only (`/de/`, German texts used for detection).
- Shop markup changes break adapters; the selectors above are the places to look.
- Prices shown in the popup are Rack Manufaktur's known prices, not the shop's.
