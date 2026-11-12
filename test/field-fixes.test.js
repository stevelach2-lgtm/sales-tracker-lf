const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const htmlPath = path.join(root, 'index.html');
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

test('pay rules stay as they are: 8% of par plus overage only at or above par, and the old tiers below', () => {
  assert.equal(window.smsAllowedAtHour(7), false);
  assert.equal(window.smsAllowedAtHour(8), true);
  assert.equal(window.smsAllowedAtHour(20), true);
  assert.equal(window.smsAllowedAtHour(21), false);

  const above = window.saleCommission({ retail: 3900, sold: 4000, financeRatePct: 0, overagePct: 40 });
  assert.equal(above.isUnderPar, false);
  assert.equal(Math.round(above.total * 10) / 10, 588.8);

  const tier60 = window.saleCommission({ retail: 3900, sold: 2900, financeRatePct: 0, overagePct: 80 });
  assert.equal(tier60.isUnderPar, true);
  assert.equal(Math.round(tier60.total * 100) / 100, 120);
  assert.match(tier60.tierDesc, /60/);

  const tier55 = window.saleCommission({ retail: 3900, sold: 2800, financeRatePct: 0, overagePct: 80 });
  assert.equal(Math.round(tier55.total * 100) / 100, 46);
  assert.match(tier55.tierDesc, /55/);

  const tierLow = window.saleCommission({ retail: 3900, sold: 2500, financeRatePct: 0, overagePct: 40 });
  assert.equal(Math.round(tierLow.total * 100) / 100, 20);
  assert.match(tierLow.tierDesc, /Below 55/);
});

test('dashboard ranges use the Eastern date, including an evening that is already the next UTC day', () => {
  const evening = new Date('2026-11-13T01:30:00Z');
  const today = window.getPeriodRanges('today', evening);
  assert.equal(today.cs.slice(0, 10), '2026-11-12');
  assert.equal(today.ce.slice(0, 10), '2026-11-12');
  assert.equal(today.ps.slice(0, 10), '2026-11-11');
  assert.equal(today.pe.slice(0, 10), '2026-11-11');

  const month = window.getPeriodRanges('month', evening);
  assert.equal(month.cs.slice(0, 10), '2026-11-01');
  assert.equal(month.ce.slice(0, 10), '2026-11-12');
  assert.equal(month.ps.slice(0, 10), '2026-10-01');
  assert.equal(month.pe.slice(0, 10), '2026-10-12');

  const week = window.getPeriodRanges('week', evening);
  assert.equal(week.cs.slice(0, 10), '2026-11-09');
  assert.equal(week.ce.slice(0, 10), '2026-11-12');
  assert.equal(week.ps.slice(0, 10), '2026-11-02');
  assert.equal(week.pe.slice(0, 10), '2026-11-05');
});

test('a sold price with no line items does not keep the previous commission, and New quote clears the screen', () => {
  window.localStorage.removeItem('cc_overage_pct_leaffilter');
  window.localStorage.removeItem('cc_overage_pct_roofline');
  window.setQcProduct('leaffilter');
  window.renderQCItems();
  document.getElementById('qc_0').value = '100';
  document.getElementById('qcSoldAt').value = '4000';
  window.calcQuote();
  assert.equal(document.getElementById('commAmt').value.replace(/[$,]/g, ''), '588.80');

  document.getElementById('qc_0').value = '';
  document.getElementById('qcSoldAt').value = '2500';
  window.calcQuote();
  assert.equal(document.getElementById('commAmt').value, '');
  assert.equal(document.getElementById('retailPct').value, '');
  assert.equal(document.getElementById('commPct').value, '');
  assert.equal(document.getElementById('qcComm').textContent, '$0.00');

  document.getElementById('qc_0').value = '80';
  document.getElementById('qcSoldAt').value = '3000';
  document.getElementById('commAmt').value = '999';
  window.startNewQuote();
  assert.equal(document.getElementById('qc_0').value, '');
  assert.equal(document.getElementById('qcSoldAt').value, '');
  assert.equal(document.getElementById('commAmt').value, '');
  assert.equal(document.getElementById('qcComm').textContent, '$0.00');
});

test('a typed commission of 0 is kept, and paid is blocked when the amount is blank', async () => {
  assert.equal(window.optionalAmount('0'), 0);
  assert.equal(window.optionalAmount('$0.00'), 0);
  assert.equal(window.optionalAmount(''), null);
  assert.equal(window.optionalAmount(null), null);

  const updates = [];
  window.sb = {
    from() {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        neq() { return chain; },
        not() { return chain; },
        order() { return chain; },
        update(payload) {
          updates.push(payload);
          return chain;
        },
        then(resolve, reject) {
          return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        }
      };
      return chain;
    }
  };
  await window.toggleCommPaid('lead-1', true, null);
  assert.equal(updates.length, 0);
  await window.toggleCommPaid('lead-1', true, 0);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].commission_paid, true);

  const ids = window.commDuplicateIds([
    { id: '1', status: 'sold', job_number: '100', product: 'leaffilter' },
    { id: '2', status: 'sold', job_number: '100 LTG', product: 'roofline' },
    { id: '3', status: 'sold', job_number: '200', product: 'leaffilter' },
    { id: '4', status: 'sold', job_number: '200', product: 'leaffilter' }
  ]);
  assert.equal(ids.has('1'), false);
  assert.equal(ids.has('2'), false);
  assert.equal(ids.has('3'), true);
  assert.equal(ids.has('4'), true);
  assert.equal(window.commissionMissing({ status: 'sold', commission_amount: 0, is_cancelled: false }), false);
  assert.equal(window.commissionMissing({ status: 'sold', commission_amount: null, is_cancelled: false }), true);
});

test('mileage skips a stop with no address and retries a failed lookup that was not typed', () => {
  const routed = window.mileageRoutableStops([
    { lead_id: 'a', address: '1 Main St' },
    { lead_id: 'b', address: '   ' },
    { lead_id: 'c', address: '' },
    { lead_id: 'd', address: '2 Main St' }
  ]);
  assert.deepEqual(routed.map(s => s.lead_id), ['a', 'd']);
  assert.equal(window.mileageLegUserTyped({ miles_manual: true, lookup_failed: true, miles: 4 }), false);
  assert.equal(window.mileageLegUserTyped({ miles_manual: true, lookup_failed: false, miles: 4 }), true);
  assert.equal(window.mileageLeadTag({ status: 'pending', notes: '' }), 'Needs result');
});

test('settings sync does not write default overage or baselines when the phone has none', async () => {
  ['bl_nvpil', 'bl_slg', 'bl_ntg', 'bl_cr', 'bl_dailySales', 'bl_weeklyRev', 'commGoal', 'cc_opening_pct', 'cc_admin_default', 'cc_admin_in_opening', 'cc_overage_pct_leaffilter', 'cc_overage_pct_roofline', 'cc_price_list', 'cc_price_list_roofline', 'cc_opening_retired'].forEach(key => {
    window.localStorage.removeItem(key);
  });
  const upserts = [];
  window.sb = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'user-1' } } }, error: null }) },
    from() {
      return {
        upsert(payload) {
          upserts.push(JSON.parse(JSON.stringify(payload)));
          return Promise.resolve({ error: null });
        }
      };
    }
  };
  await window.syncSettingsToSupabase();
  assert.equal(upserts.length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(upserts[0], 'overage_pct_leaffilter'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(upserts[0], 'overage_pct_roofline'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(upserts[0], 'nvpil'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(upserts[0], 'price_list_leaffilter'), false);
  assert.equal(upserts[0].user_id, 'user-1');

  window.localStorage.setItem('cc_price_list', JSON.stringify([{ s: 'Test', l: 'Custom', u: 'ft', p: 12 }]));
  const saved = [];
  window.sb = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'user-1' } } }, error: null }) },
    from() {
      return {
        upsert(payload) {
          saved.push(JSON.parse(JSON.stringify(payload)));
          if (Object.prototype.hasOwnProperty.call(payload, 'price_list_leaffilter')) {
            return Promise.resolve({ error: { message: "Could not find the 'price_list_leaffilter' column of 'app_settings'" } });
          }
          return Promise.resolve({ error: null });
        }
      };
    }
  };
  await window.syncSettingsToSupabase();
  assert.equal(saved[0].price_list_leaffilter[0].l, 'Custom');
  assert.equal(Object.prototype.hasOwnProperty.call(saved[saved.length - 1], 'price_list_leaffilter'), false);
});

test('calendar names and history notes are escaped', () => {
  const card = document.createElement('div');
  card.id = 'todaysLeadsCard';
  const list = document.createElement('div');
  list.id = 'todaysLeadsList';
  const count = document.createElement('div');
  count.id = 'todaysLeadsCount';
  document.body.appendChild(card);
  document.body.appendChild(list);
  document.body.appendChild(count);
  window.calendarLeads = [{
    name: '<img src=x onerror=alert(1)>',
    address: '1 <b>Oak</b>',
    leadId: 'cal-1',
    logged: false,
    startTime: ''
  }];
  window.renderTodaysLeads();
  assert.equal(list.innerHTML.includes('<img'), false);
  assert.equal(list.innerHTML.includes('<b>'), false);
  assert.equal(list.textContent.includes('<img src=x onerror=alert(1)>'), true);
});

test('quote sits in the center of five tabs, miles lives in settings, and sign-up is gone', () => {
  const ids = Array.from(document.querySelectorAll('nav.nav > .ni')).map(btn => btn.id);
  assert.deepEqual(ids, ['n-dash', 'n-hist', 'n-quote', 'n-comm', 'n-set']);
  assert.equal(document.getElementById('n-miles'), null);
  assert.equal(document.body.innerHTML.includes("goTo('miles')"), true);
  assert.equal(document.getElementById('tabSignup'), null);
  assert.equal(document.getElementById('panelSignup'), null);
  assert.equal(document.querySelector('link[rel="manifest"]') != null, true);
  assert.equal(fs.existsSync(path.join(root, 'manifest.json')), true);
  assert.equal(fs.existsSync(path.join(root, 'apple-touch-icon.png')), true);
  assert.equal(fs.existsSync(path.join(root, 'app.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'styles.css')), false);
  const rawHtml = fs.readFileSync(htmlPath, 'utf8');
  assert.equal(/<script src="[^"]*chart\.js/.test(rawHtml), false);
  assert.equal(/<script src="[^"]*jspdf/.test(rawHtml), false);
  assert.equal(/<script src="[^"]*qrcode/.test(rawHtml), false);
  assert.equal(typeof window.ensurePdfLibs, 'function');
  assert.equal(typeof window.ensureQrLib, 'function');
  assert.equal(typeof window.ensureChartLib, 'function');
});

test('upcoming actions keep Quote then Text and add Call and Directions at 44px', async () => {
  window.sb = null;
  await window.ensureDoNotTextPhones();
  const htmlChunk = window.dashUpcomingActionsHtml({
    id: 'joan',
    customer_phone: '(215) 362-4042',
    customer_address: '12 Oak Street'
  }, 'text');
  const holder = document.createElement('div');
  holder.innerHTML = htmlChunk;
  const quote = holder.querySelector('button');
  const text = holder.querySelector('[data-confirm-action="text"]');
  assert.equal(quote.textContent, 'Quote');
  assert.equal(text.textContent, 'Text');
  assert.equal(quote.nextElementSibling, text);
  assert.equal(quote.classList.contains('appt-action'), true);
  assert.match(holder.querySelector('a[href^="tel:"]').textContent, /Call/);
  assert.match(holder.querySelector('a[href*="maps.apple.com"]').textContent, /Directions/);
});

test('undo removes the sent mark that was saved when the text app opened', async () => {
  const deleted = [];
  window.sb = {
    from() {
      return {
        delete() {
          return {
            eq(col, val) {
              deleted.push([col, val]);
              return this;
            }
          };
        }
      };
    }
  };
  window.showSmsUndo('joan', 'appt_confirm', true);
  assert.equal(document.getElementById('smsUndoBar').classList.contains('show'), true);
  const pending = window.undoSentText();
  await Promise.resolve();
  await pending;
  assert.deepEqual(deleted, [['lead_id', 'joan'], ['step_key', 'appt_confirm']]);
  assert.equal(document.getElementById('smsUndoBar').classList.contains('show'), false);
});
