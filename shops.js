// Shop definitions shared by the popup and the background worker.
// pick(orders) returns the items this shop should get, flattened over all suppliers.
/* exported SHOPS, shopItems */

const SHOPS = {
  thomann: {
    name: 'Thomann',
    start: 'https://www.thomann.de/de/index.html',
    cart: 'https://www.thomann.de/de/basket.html',
    pick: orders => supplierItems(orders, 'thomann'),
    note: ''
  },
  procase: {
    name: 'ProCase',
    start: 'https://www.procaseshop.de/',
    cart: 'https://www.procaseshop.de/checkout/cart/',
    pick: orders => supplierItems(orders, 'procase'),
    note: 'Nur mit Händler-Login: bitte vorher selbst anmelden.'
  },
  adamhall: {
    name: 'Adam Hall',
    start: 'https://www.adamhall.com/shop/de',
    cart: 'https://www.adamhall.com/shop/de/cart',
    // Adam Hall parts are usually bought from dealers, so `supplier` names the dealer.
    // Ordering directly at Adam Hall picks them by maker instead.
    pick: orders => allItems(orders).filter(i => i.maker === 'Adam Hall' && i.partNo),
    note: 'Nur mit Händler-Login: bitte vorher selbst anmelden. Enthält alle Adam-Hall-Teile, egal bei welchem Händler sie geplant sind.'
  }
};

function allItems(orders) {
  return (orders && orders.suppliers || []).flatMap(s => s.items || []);
}

function supplierItems(orders, id) {
  const s = (orders && orders.suppliers || []).find(x => x.supplierId === id);
  return s ? s.items : [];
}

function shopItems(shopId, orders) {
  return SHOPS[shopId].pick(orders).map(i => ({
    key: i.key, qty: i.qty, name: i.name, maker: i.maker || '', partNo: i.partNo || '',
    search: i.search || i.name, price: i.price, supplier: i.supplier
  }));
}
