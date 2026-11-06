const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const htmlPath = path.join(__dirname, '..', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
html = html.replace(/<script src="[^"]+"><\/script>\n/g, '');
html = html.replace(/boot\(\);\s*<\/script>/, '</script>');

const dom = new JSDOM(html, {
  url: 'https://sales-tracker-lf.vercel.app/',
  runScripts: 'dangerously',
  pretendToBeVisual: true
});
const window = dom.window;
const document = window.document;

function makeSb({ lead, onUpdate, onSelect }) {
  const updates = [];
  const inserts = [];
  const ors = [];
  function from(table) {
    const state = { table, action: 'select', payload: null, filters: [], or: '', single: false, cols: '' };
    function finish() {
      if (state.action === 'update') {
        updates.push({ table, payload: state.payload, filters: state.filters.slice() });
        const res = onUpdate ? onUpdate(state.payload, updates.length) : { data: { id: lead.id }, error: null };
        return Promise.resolve(res);
      }
      if (state.action === 'insert') {
        inserts.push({ table, payload: state.payload });
        return Promise.resolve({ data: { id: 'new-row' }, error: null });
      }
      if (state.single) return Promise.resolve({ data: lead, error: null });
      if (onSelect) return Promise.resolve(onSelect(state));
      return Promise.resolve({ data: [], error: null });
    }
    const chain = new Proxy({}, {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop === 'then') return (resolve, reject) => finish().then(resolve, reject);
        if (prop === 'single' || prop === 'maybeSingle') return () => { state.single = true; return finish(); };
        if (prop === 'update') return (payload) => { state.action = 'update'; state.payload = payload; return chain; };
        if (prop === 'insert') return (payload) => { state.action = 'insert'; state.payload = payload; return chain; };
        if (prop === 'delete') return () => { state.action = 'delete'; return chain; };
        if (prop === 'select') return (cols) => {
          state.cols = cols || '';
          if (state.action !== 'update' && state.action !== 'insert') state.action = 'select';
          return chain;
        };
        if (prop === 'eq') return (col, val) => { state.filters.push(['eq', col, val]); return chain; };
        if (prop === 'or') return (expr) => { state.or = expr; ors.push(expr); return chain; };
        return () => chain;
      }
    });
    return chain;
  }
  return { from, updates, inserts, ors, auth: { getSession: async () => ({ data: { session: null }, error: null }) } };
}

const lead = {
  id: 'lead-1',
  status: 'not_sold',
  product: 'leaffilter',
  customer_name: 'Linda Coleman',
  customer_phone: '555-123-4567',
  customer_address: '10 Main St, Medford, NJ',
  followup_name: '',
  followup_phone: '',
  sale_amount: 4500,
  retail_price: 8000,
  footage: 120,
  quote_items: [{ s: 'LeafFilter Installation', l: '1st Floor – 5"', u: 'ft', qty: 120, p: 39 }],
  notes: '📊 Retail: $8,000.00 | Par: $5,200.00 | Left at: $4,500.00 | Footage: 120 ft\nCall back in spring',
  reason_id: 'reason-1',
  sales_date: '2026-10-01',
  lead_type: 'company',
  not_sold_reasons: { label: 'Price' }
};

function installSb(handlers) {
  const sb = makeSb(Object.assign({ lead }, handlers || {}));
  window.sb = sb;
  window.saveLocationForLead = () => {};
  window.scheduleMileageRecalc = () => {};
  return sb;
}

test('install footage sums LeafFilter and Lighting install feet only', () => {
  const feet = window.installFootageFromItems([
    { s: 'LeafFilter Installation', l: '1st Floor – 5"', u: 'ft', qty: 100, p: 39 },
    { s: 'Roof Line Lighting Installation', l: 'Installed Lighting (All Stories)', u: 'ft', qty: 40, p: 44 },
    { s: 'LeafFilter Extras', l: 'Remove gutter protection', u: 'ft', qty: 15, p: 3 },
    { s: 'Roof Line Lighting Add-Ons', l: 'Remove Permanent Lighting', u: 'ft', qty: 10, p: 3 }
  ]);
  assert.equal(feet, 140);
});

test('quote items keep section, label, unit, qty, and price', () => {
  const items = JSON.parse(JSON.stringify(window.quoteItemsFromPriceList([
    { s: 'LeafFilter Installation', l: '1st Floor \u2013 5"', u: 'ft', p: 39 },
    { s: 'LeafFilter Extras', l: 'Inside/Outside Mitres', u: 'ea', p: 30 }
  ], (_item, i) => (i === 0 ? '80' : '0'))));
  assert.deepEqual(items, [
    { s: 'LeafFilter Installation', l: '1st Floor \u2013 5"', u: 'ft', qty: 80, p: 39 }
  ]);
});

test('quote note line includes Footage: X ft', () => {
  const line = window.buildQuoteRefLine({ retail: 8000, leftAt: 4500, footage: 120 });
  assert.equal(line, '📊 Retail: $8,000.00 | Par: $5,200.00 | Left at: $4,500.00 | Footage: 120 ft');
});

test('rehash search matches a customer name when lead id is empty', () => {
  const clause = window.rehashSearchClause('Linda');
  assert.match(clause, /customer_name\.ilike\.%Linda%/);
  assert.match(clause, /lead_id\.eq\.Linda/);
  assert.equal(window.rehashSearchClause('555-123-4567').includes('customer_phone.ilike.%1234567%'), true);
});

test('converting a not-sold lead shows the quote and saves that same row', async () => {
  document.getElementById('n-dash')?.classList.remove('active');
  document.getElementById('n-hist')?.classList.remove('active');
  document.getElementById('n-comm')?.classList.remove('active');
  const toasts = [];
  const origToast = window.toast;
  window.toast = (msg, type = 'ok') => { toasts.push({ msg, type }); origToast(msg, type); };
  try {
    const sb = installSb();
    await window.openLeadEdit(lead.id);
    window.convertRehash();

    assert.equal(document.getElementById('esSoldCustName').value, 'Linda Coleman');
    assert.equal(document.getElementById('esSoldCustPhone').value, '555-123-4567');
    assert.equal(document.getElementById('esSaleAmt').value, '4500');
    assert.match(document.getElementById('esSoldAddrRead').textContent, /10 Main St, Medford, NJ/);
    assert.match(document.getElementById('esSoldProductRead').textContent, /LeafFilter/);
    assert.match(document.getElementById('esSoldFootageRead').textContent, /Footage: 120 ft/);
    assert.match(document.getElementById('esSoldRetailRead').textContent, /\$8,000\.00/);
    assert.match(document.getElementById('esNotes').value, /📊/);
    assert.match(document.getElementById('esNotes').value, /Footage: 120 ft/);
    assert.equal(document.getElementById('esFieldsSold').style.display, 'block');
    assert.equal(document.getElementById('esChkRehash').classList.contains('active'), true);

    const contact = window.validateSoldContact({
      nameEl: document.getElementById('esSoldCustName'),
      phoneEl: document.getElementById('esSoldCustPhone')
    });
    assert.equal(contact.name, 'Linda Coleman');
    assert.equal(contact.phone, '5551234567');

    toasts.length = 0;
    await window.saveLeadEdit();

    assert.equal(sb.inserts.length, 0);
    assert.equal(sb.updates.length, 1);
    const saved = sb.updates[0];
    assert.deepEqual(JSON.parse(JSON.stringify(saved.filters)), [['eq', 'id', 'lead-1']]);
    assert.equal(saved.payload.status, 'sold');
    assert.equal(saved.payload.lead_type, 'rehash');
    assert.equal(saved.payload.reason_id, null);
    assert.equal(saved.payload.customer_name, 'Linda Coleman');
    assert.equal(saved.payload.customer_phone, '5551234567');
    assert.equal(saved.payload.sale_amount, 4500);
    assert.equal(saved.payload.footage, 120);
    assert.equal(saved.payload.retail_price, 8000);
    assert.equal(saved.payload.quote_items[0].qty, 120);
    assert.match(saved.payload.notes, /Footage: 120 ft/);
    assert.equal(toasts.some(t => t.type === 'err'), false);

    const fallback = installSb();
    await window.openLeadEdit(lead.id);
    document.getElementById('esNsFuName').value = '';
    document.getElementById('esNsFuPhone').value = '';
    window.convertRehash();
    assert.equal(document.getElementById('esSoldCustName').value, 'Linda Coleman');
    assert.equal(document.getElementById('esSoldCustPhone').value, '555-123-4567');
    const fallbackContact = window.validateSoldContact({
      nameEl: document.getElementById('esSoldCustName'),
      phoneEl: document.getElementById('esSoldCustPhone')
    });
    assert.equal(fallbackContact.name, 'Linda Coleman');
    assert.equal(fallbackContact.phone, '5551234567');
    assert.equal(fallback.inserts.length, 0);

    const degraded = installSb({
      onUpdate(_payload, n) {
        if (n === 1) return { data: null, error: { message: "Could not find the 'footage' column of 'leads' in the schema cache" } };
        if (n === 2) return { data: null, error: { message: "Could not find the 'quote_items' column of 'leads' in the schema cache" } };
        return { data: { id: lead.id }, error: null };
      }
    });
    toasts.length = 0;
    await window.openLeadEdit(lead.id);
    window.convertRehash();
    await window.saveLeadEdit();
    assert.equal(degraded.updates.length, 3);
    const slim = degraded.updates[2].payload;
    assert.equal(slim.status, 'sold');
    assert.equal(slim.lead_type, 'rehash');
    assert.equal(slim.reason_id, null);
    assert.equal(slim.customer_name, 'Linda Coleman');
    assert.equal(Object.prototype.hasOwnProperty.call(slim, 'footage'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(slim, 'quote_items'), false);
    assert.equal(toasts.some(t => t.type === 'err'), false);

    const picked = installSb({
      onSelect(state) {
        if (state.or && state.or.includes('customer_name.ilike.%Linda%')) return { data: [lead], error: null };
        return { data: [], error: null };
      }
    });
    window.rehashSearch('Linda');
    await new Promise(resolve => setTimeout(resolve, 450));
    assert.match(picked.ors.join('\n'), /customer_name\.ilike\.%Linda%/);
    document.querySelector('#rehashResults [onclick]').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(picked.inserts.length, 0);
    assert.equal(document.getElementById('editOverlay').classList.contains('open'), true);
    assert.equal(document.getElementById('esSoldCustName').value, 'Linda Coleman');
    assert.equal(document.getElementById('esSaleAmt').value, '4500');
    assert.match(document.getElementById('esSoldFootageRead').textContent, /120 ft/);
    assert.equal(document.getElementById('esFieldsSold').style.display, 'block');

    const quoted = installSb();
    await window.openLeadEdit(lead.id);
    window.renderQCItems();
    document.getElementById('qc_0').value = '100';
    document.getElementById('qc_1').value = '20';
    window.calcQuote();
    await window.saveQuoteToLead();
    assert.equal(quoted.updates.length, 1);
    const payload = quoted.updates[0].payload;
    assert.equal(payload.footage, 120);
    assert.equal(payload.retail_price, 100 * 39 + 20 * 40);
    const labels = JSON.parse(JSON.stringify(payload.quote_items.map(item => item.l)));
    assert.deepEqual(labels, ['1st Floor \u2013 5"', '1st Floor \u2013 6"']);
    JSON.parse(JSON.stringify(payload.quote_items)).forEach(item => {
      assert.deepEqual(Object.keys(item).sort(), ['l', 'p', 'qty', 's', 'u']);
    });
  } finally {
    window.toast = origToast;
  }
});

test('leafFilterFloorFootage sums each story and skips extras and lighting', () => {
  const summary = window.leafFilterFloorFootage([
    { s: 'LeafFilter Installation', l: '1st Floor – 5"', u: 'ft', qty: 50, p: 39 },
    { s: 'LeafFilter Installation', l: '1st Floor – 6"', u: 'ft', qty: 35, p: 40 },
    { s: 'LeafFilter Installation', l: '1st Floor – Versa Max', u: 'ft', qty: 0, p: 50 },
    { s: 'LeafFilter Installation', l: '2nd Floor – 5"', u: 'ft', qty: 60, p: 41 },
    { s: 'LeafFilter Installation', l: '3rd Floor – 6"', u: 'ft', qty: '', p: 44 },
    { s: 'LeafFilter Extras', l: 'Remove gutter protection', u: 'ft', qty: 15, p: 3 },
    { s: 'Roof Line Lighting Installation', l: 'Installed Lighting (All Stories)', u: 'ft', qty: 40, p: 44 }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(summary)), {
    floors: [
      { name: '1st floor', feet: 85 },
      { name: '2nd floor', feet: 60 }
    ],
    total: 145
  });
  assert.equal(window.floorNameFromLabel('4th Floor – 5"'), '4th floor');
  assert.equal(window.floorNameFromLabel('Inside/Outside Mitres'), null);
});

test('quote calculator shows live per-floor totals under LeafFilter Installation', () => {
  window.setQcProduct('leaffilter');
  window.renderQCItems();
  const items = document.getElementById('qcItems');
  const box = document.getElementById('qcFloorTotals');
  assert.ok(box);
  assert.equal(box.style.display, 'none');

  const children = Array.from(items.children);
  const lastInstall = document.getElementById('qc_6').parentElement;
  const extrasHeader = children.find(el => /LeafFilter Extras/i.test(el.textContent) && !el.querySelector('input'));
  assert.ok(extrasHeader);
  assert.equal(lastInstall.nextElementSibling, box);
  assert.equal(box.nextElementSibling, extrasHeader);

  const retailBefore = document.getElementById('qcRetailHidden').value;
  document.getElementById('qc_0').value = '50';
  document.getElementById('qc_1').value = '35';
  document.getElementById('qc_3').value = '60';
  document.getElementById('qc_7').value = '15';
  window.calcQuote();

  function floorText(name) {
    const row = box.querySelector('[data-floor="' + name + '"]');
    return row ? row.getAttribute('aria-label') : '';
  }
  assert.equal(box.style.display, '');
  assert.equal(floorText('1st floor'), '1st floor: 85 ft');
  assert.equal(floorText('2nd floor'), '2nd floor: 60 ft');
  assert.equal(floorText('3rd floor'), '');
  assert.equal(floorText('total'), 'Total: 145 ft');
  assert.equal(document.getElementById('qcRetailHidden').value, (50 * 39 + 35 * 40 + 60 * 41 + 15 * 3).toFixed(2));
  assert.notEqual(document.getElementById('qcRetailHidden').value, retailBefore);

  document.getElementById('qc_3').value = '';
  document.getElementById('qc_5').value = '10.5';
  window.calcQuote();
  assert.equal(floorText('2nd floor'), '');
  assert.equal(floorText('3rd floor'), '3rd floor: 10.5 ft');
  assert.equal(floorText('total'), 'Total: 95.5 ft');

  document.getElementById('qc_0').value = '';
  document.getElementById('qc_1').value = '';
  document.getElementById('qc_5').value = '';
  window.calcQuote();
  assert.equal(box.style.display, 'none');
  assert.equal(box.querySelector('.qc-floor-row'), null);

  window.setQcProduct('roofline');
  assert.equal(document.getElementById('qcFloorTotals'), null);
  assert.match(document.getElementById('qcItems').textContent, /Installed Lighting/);
  window.setQcProduct('leaffilter');
  window.renderQCItems();
});

const ROOFLINE_PRICE_KEY = 'cc_price_list_roofline';
const ROOFLINE_MIGRATION_KEY = 'cc_roofline_price_migrated_48_850';
const LIGHTING_LABEL = 'Installed Lighting (All Stories)';
const CONTROL_BOX_LABEL = "Control Box (1 required per job, powers up to 225')";

function qcRows() {
  return Array.from(document.querySelectorAll('#qcItems input[id^="qc_"]')).map(input => {
    const row = input.parentElement;
    const label = row.children[0].children[0].textContent;
    const unitPrice = row.children[0].children[1].textContent;
    const ext = document.getElementById('qc_ext_' + input.id.slice(3));
    return { label, unitPrice, qty: input.value, ext: ext ? ext.textContent : '' };
  });
}

function rowByLabel(label) {
  return qcRows().find(row => row.label === label);
}

function showRooflineQuote() {
  window.setQcProduct('leaffilter');
  window.setQcProduct('roofline');
  window.calcQuote();
}

function savedRooflineList(overrides) {
  const list = [
    { s: 'Roof Line Lighting Installation', l: LIGHTING_LABEL, u: 'ft', p: 44 },
    { s: 'Roof Line Lighting Add-Ons', l: CONTROL_BOX_LABEL, u: 'ea', p: 800 },
    { s: 'Roof Line Lighting Add-Ons', l: 'Booster Box (1 per additional 225\')', u: 'ea', p: 600 },
    { s: 'Roof Line Lighting Add-Ons', l: 'Wifi Extender', u: 'ea', p: 150 },
    { s: 'Custom', l: 'My labor', u: 'hr', p: 90, note: 'keep-me' }
  ];
  (overrides || []).forEach(change => {
    const item = list.find(row => row.l === change.l);
    if (!item) list.push(change);
    else Object.assign(item, change);
  });
  return list;
}

function resetRooflineStorage(list) {
  window.localStorage.removeItem(ROOFLINE_MIGRATION_KEY);
  if (list) window.localStorage.setItem(ROOFLINE_PRICE_KEY, JSON.stringify(list));
  else window.localStorage.removeItem(ROOFLINE_PRICE_KEY);
}

test('fresh device shows roofline defaults of $48/ft and $850 control box', () => {
  resetRooflineStorage(null);
  showRooflineQuote();
  const lighting = rowByLabel(LIGHTING_LABEL);
  const control = rowByLabel(CONTROL_BOX_LABEL);
  assert.ok(lighting);
  assert.ok(control);
  assert.equal(lighting.unitPrice, '$48/ft');
  assert.equal(control.label, CONTROL_BOX_LABEL);
  assert.equal(control.unitPrice, '$850/ea');
  assert.equal(control.qty, '1');
  assert.equal(control.ext, '$850.00');
  assert.equal(window.localStorage.getItem(ROOFLINE_PRICE_KEY), null);
  assert.equal(window.localStorage.getItem(ROOFLINE_MIGRATION_KEY), '1');
  window.setQcProduct('leaffilter');
});

test('saved roofline defaults of $44/ft and $800 bump once and custom rows stay', () => {
  const saved = savedRooflineList([
    { l: 'Wifi Extender', p: 175 },
    { l: 'Shorter Control Box', s: 'Custom', u: 'ea', p: 800 },
    { l: 'Installed Lighting', s: 'Custom', u: 'ft', p: 44 }
  ]);
  resetRooflineStorage(saved);
  showRooflineQuote();

  assert.equal(rowByLabel(LIGHTING_LABEL).unitPrice, '$48/ft');
  assert.equal(rowByLabel(CONTROL_BOX_LABEL).unitPrice, '$850/ea');
  assert.equal(rowByLabel(CONTROL_BOX_LABEL).qty, '1');
  assert.equal(rowByLabel(CONTROL_BOX_LABEL).ext, '$850.00');
  assert.equal(rowByLabel('Wifi Extender').unitPrice, '$175/ea');
  assert.equal(rowByLabel('Booster Box (1 per additional 225\')').unitPrice, '$600/ea');
  assert.equal(rowByLabel('My labor').unitPrice, '$90/hr');
  assert.equal(rowByLabel('Shorter Control Box').unitPrice, '$800/ea');
  assert.equal(rowByLabel('Installed Lighting').unitPrice, '$44/ft');

  const stored = JSON.parse(window.localStorage.getItem(ROOFLINE_PRICE_KEY));
  assert.equal(stored.find(item => item.l === LIGHTING_LABEL).p, 48);
  assert.equal(stored.find(item => item.l === CONTROL_BOX_LABEL).p, 850);
  assert.equal(stored.find(item => item.l === 'Wifi Extender').p, 175);
  assert.equal(stored.find(item => item.l === 'My labor').note, 'keep-me');
  assert.equal(stored.find(item => item.l === 'My labor').p, 90);
  assert.equal(stored.find(item => item.l === 'Shorter Control Box').p, 800);
  assert.equal(stored.find(item => item.l === 'Installed Lighting').p, 44);
  assert.equal(stored.length, saved.length);
  assert.deepEqual(stored.map(item => item.l), saved.map(item => item.l));
  assert.equal(window.localStorage.getItem(ROOFLINE_MIGRATION_KEY), '1');

  stored.find(item => item.l === LIGHTING_LABEL).p = 44;
  stored.find(item => item.l === CONTROL_BOX_LABEL).p = 800;
  window.localStorage.setItem(ROOFLINE_PRICE_KEY, JSON.stringify(stored));
  showRooflineQuote();
  assert.equal(rowByLabel(LIGHTING_LABEL).unitPrice, '$44/ft');
  assert.equal(rowByLabel(CONTROL_BOX_LABEL).unitPrice, '$800/ea');
  assert.equal(rowByLabel('Wifi Extender').unitPrice, '$175/ea');

  window.localStorage.removeItem(ROOFLINE_PRICE_KEY);
  window.setQcProduct('leaffilter');
});

test('a roofline row already off the old default price is left alone', () => {
  const saved = savedRooflineList([
    { l: LIGHTING_LABEL, p: '44' },
    { l: CONTROL_BOX_LABEL, p: 775 },
    { l: 'Booster Box (1 per additional 225\')', p: 625 }
  ]);
  resetRooflineStorage(saved);
  showRooflineQuote();
  assert.equal(rowByLabel(LIGHTING_LABEL).unitPrice, '$48/ft');
  assert.equal(rowByLabel(CONTROL_BOX_LABEL).unitPrice, '$775/ea');
  assert.equal(rowByLabel('Booster Box (1 per additional 225\')').unitPrice, '$625/ea');
  const stored = JSON.parse(window.localStorage.getItem(ROOFLINE_PRICE_KEY));
  assert.equal(stored.find(item => item.l === LIGHTING_LABEL).p, 48);
  assert.equal(stored.find(item => item.l === CONTROL_BOX_LABEL).p, 775);
  assert.equal(stored.find(item => item.l === 'Booster Box (1 per additional 225\')').p, 625);
  window.localStorage.removeItem(ROOFLINE_PRICE_KEY);
  window.setQcProduct('leaffilter');
});
