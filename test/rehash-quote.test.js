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
