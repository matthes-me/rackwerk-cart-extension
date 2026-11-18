# Rack Manufaktur – cart extension

A Chrome extension for [Rack Manufaktur](https://td-media.eu/rackwerk/), the 19″ rack configurator.
Once a rack is planned, Rack Manufaktur knows what to buy from which supplier. This extension takes that
order list and puts the items into the shopping carts at **Thomann**, **ProCase** and **Adam Hall**,
with the right quantities, so you don't have to search every connector, panel and screw by hand.

It stops at the cart. It never logs in, never enters passwords or payment details and never orders
anything – you check the cart and check out yourself.

| Repository | What is in it |
|---|---|
| [matthes-me/rackwerk-api](https://github.com/matthes-me/rackwerk-api) | Rack Manufaktur itself (single-file app, product data) and its embedding/extension API ([docs/api.md](https://github.com/matthes-me/rackwerk-api/blob/ux-stagecraft-api/docs/api.md)). The extension also lives there in `extension/`. |
| [matthes-me/rackwerk-cart-extension](https://github.com/matthes-me/rackwerk-cart-extension) | This extension on its own, ready to load into Chrome. |

## What it does

- Reads the orders per supplier from an open Rack Manufaktur tab (read-only; it cannot change your
  project) and keeps them current while you edit.
- The toolbar popup lists each shop with item count and known total, plus the suppliers it cannot handle.
- **In den Warenkorb legen** opens the shop in a new tab and adds the items one after another. Afterwards
  the popup shows per item: *im Warenkorb*, *nicht gefunden*, *nicht eindeutig*, *Login nötig*,
  *Fehler* or *unklar*.
- It only adds a product when it matches the part number exactly. If nothing matches clearly, it adds
  nothing and says so – it never picks a "similar" product.

| Shop | Status |
|---|---|
| Thomann (thomann.de) | Works without an account. Tested: 11 of the 14 Thomann items of the example project went into the cart with the right quantities; the other 3 are not sold under that part number at Thomann. |
| ProCase (procaseshop.de) | Dealer shop: prices and cart only after login. The extension finds the parts, then stops with *Login nötig*. Adding to the cart after a login is built in but not tested yet. |
| Adam Hall (adamhall.com/shop) | Dealer shop, same as ProCase. Takes every Adam Hall part of the project, even if it is planned at a dealer such as Thomann. |

## Install

The extension is not in the Chrome Web Store; load it as an unpacked extension:

1. Download this repository: **Code → Download ZIP** and unzip it, or
   `git clone https://github.com/matthes-me/rackwerk-cart-extension.git`
2. In Chrome open `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and choose the downloaded folder (the one with `manifest.json`).
4. Pin the extension (puzzle icon in the toolbar) so the popup is one click away.

Updates: pull or download again, then press the reload icon on the extension card in `chrome://extensions`.

## Use

1. Open Rack Manufaktur and plan your rack (or open a saved project).
2. Click the extension icon. It shows the project name and the shops with their items; if not, press
   **Neu einlesen**.
3. Press **In den Warenkorb legen** at a shop. For ProCase and Adam Hall log in to the shop first.
   Leave the shop tab open until the banner at the bottom left says it is done; **Stopp** in the popup
   cancels.
4. Check the cart and order there as usual.

> **Note:** the extension needs Rack Manufaktur with API v1 (the page carries
> `<meta name="rackwerk-api" content="1">`). That version is in the branch
> [`ux-stagecraft-api`](https://github.com/matthes-me/rackwerk-api/tree/ux-stagecraft-api) and is not on
> td-media.eu yet. Until it is deployed, run it locally from a clone of rackwerk-api on that branch:
> `python3 -m http.server -d public`, then open `http://localhost:8000/`.

## Privacy and behaviour towards the shops

- Data stays in your browser (`chrome.storage.local`): the order list and the last job. Nothing is sent
  anywhere except the normal requests to the shop you started.
- Permissions: storage, tabs, and access to Rack Manufaktur (td-media.eu/rackwerk, localhost) and the
  three shops only.
- One tab, one item at a time, with a pause of 1.5–2.5 s between requests. Bot checks (ProCase uses one)
  are left to you; the extension waits and never solves them.

## How it works

| File | Role |
|---|---|
| `content/rackwerk.js` | On the Rack Manufaktur page: calls `getOrders` over `window.postMessage` (API v1, read-only), stores the result, subscribes to `change` events |
| `popup.html/js` | Lists shops, starts a job, shows results per item, *Stopp* |
| `background.js` | Creates the job and opens the shop tab; a closed tab ends the job |
| `shops.js` | Which items each shop gets |
| `content/shop-common.js` | Shared adapter helpers: job lease, pauses, status banner, page-by-page runner |
| `content/thomann.js`, `procase.js`, `adamhall.js` | One adapter per shop |

Items per shop: Thomann = supplier `thomann`; ProCase = supplier `procase`; Adam Hall = every item with
`maker === 'Adam Hall'`.

Shops prerender pages (Speculation Rules) and Chrome runs content scripts in those too, so adapters wait
until the page is actually shown and hold a lease in the job; only one page instance works on a job.

### What each adapter relies on (checked 2026-11-18)

**Thomann** – no login needed (tested)

- Search: `GET /de/search_dir.html?sw=<maker> <partNo>` (or the item's `search` text), server-rendered.
  Cards: `.product` › `a.product__content[href]`, `.title__manufacturer`, `.title__name`.
- Match: maker equal and title equal to the part number, ignoring spaces, dashes and case
  (`NC3MD-L-1` = `NC3 MD-L1`). A longer title is accepted only if it is the single card that starts with
  the part number and the rest is descriptive text with lower-case letters
  (`872215 U-shaped Rack Panel 1U` yes; `NC3 MD-L1 BAG`, `NE8FDP-TOP`, `SAC3FPX20 - 67` no).
- Product page: `form.buy-form` → `POST /de/basket_add.html` with `ar` (Thomann article number) and
  `menge` (quantity).
- Confirmation: Thomann redirects to `basket.html?addedStatus=success&gtmArticleNumber=<ar>`; anything
  else is reported as an error. Cart: `/de/basket.html`.

**ProCase** – dealer login needed (search and matching tested, adding not)

- Search: `/catalogsearch/result/?q=<partNo>` (Magento 2, Hyvä), behind a bot check (reCAPTCHA) that
  passed by itself in a normal Chrome.
- Match: result card (`.product-item`, outside the `.glider-slide` carousels) whose `Art.-Nr.:` is exactly
  the part number (`135508`, not `135508D`).
- Guests see "Anmelden für Preise" and no quantity field → *Login nötig* for all items.
- With a login: posts `form.product_addtocart_form` (`/checkout/cart/add/…/product/<id>/`, `form_key`,
  `product`) with `qty`. Cart: `/checkout/cart/`.

**Adam Hall** – dealer login needed (search and matching tested, adding not)

- Search: `/shop/de/search?query=<partNo>` (Nuxt, rendered in the browser; waits up to 10 s).
- Match: product URL ends with `-<part number without spaces>`
  (`872205 LBL` → `/shop/de/rack-u-pan-1-2-label-872205lbl`); product page shows `Artikel Nr.: <no.>`.
  All six Adam Hall parts of the example project were found exactly.
- Guests see "Anmelden zum Kaufen" → *Login nötig*.
- With a login: sets the "Menge" field and clicks "In den Warenkorb". Cart: `/shop/de/cart` (assumed).

### Test result (example project "Beispiel · Anschlussrack", fresh Chrome profile)

| Shop | Result |
|---|---|
| Thomann, 14 items | 11 added with the right quantities (checked on `basket.html`): Adam Hall 872205 LBL, 872215 (via title), Neutrik NC3FD-L-1, NC3MD-L-1, NE8FDP, NAHDMI-W-B, NAUSB-W-B, Millenium Blanking Plate D Format, Seetronic SAC3MPX TR1, SAC3FPX20, Thon Rack Screw M3 x 12 BK. Not found: Neutrik NC5FD-L-1, Adam Hall 872205 VR, Adam Hall 87401 E. |
| ProCase, 2 items | *Login nötig* (135508 found exactly) |
| Adam Hall, 6 items | *Login nötig* (872205 LBL found exactly) |

### Next step: `shopRef` in Rack Manufaktur's data (proposal)

A shop's own number per item would make the adapters exact and skip the search:

```json
"shopRef": { "thomann": "141374", "procase": "135508", "adamhall": "872215" }
```

Next to `art` on every orderable item in rackwerk-api's `data/`, only for shops that sell it, with the
source URL like every other number; passed through as `item.shopRef` in `getOrders`. Thomann numbers
found in the test: 510952 (872205 LBL), 141374 (872215), 105164 (NC3FD-L-1), 105167 (NC3MD-L-1),
185255 (NE8FDP), 232497 (NAHDMI-W-B), 185260 (NAUSB-W-B), 239787 (Millenium Blanking Plate D Format),
524708 (SAC3MPX TR1), 523370 (SAC3FPX20), 259265 (Thon Rack Screw M3 x 12 BK).

### Limits

- German shops only (`/de/`, German texts used for detection); the popup is in German.
- Shop markup changes break adapters; the selectors above are the places to look.
- Totals in the popup are Rack Manufaktur's known prices, not the shop's.

## License

MIT, see [LICENSE](https://github.com/matthes-me/rackwerk-cart-extension/blob/main/LICENSE).
