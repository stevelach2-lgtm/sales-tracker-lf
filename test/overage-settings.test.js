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

function money(id) {
  return parseFloat(document.getElementById(id).textContent.replace(/[$,]/g, '')) || 0;
}

function clearOverage() {
  window.localStorage.removeItem('cc_overage_pct_leaffilter');
  window.localStorage.removeItem('cc_overage_pct_roofline');
}

function quoteLeafFilter({ feet, sold, fin }) {
  window.setQcProduct('leaffilter');
  window.renderQCItems();
  document.getElementById('qc_0').value = String(feet);
  document.getElementById('qcSoldAt').value = String(sold);
  document.getElementById('qcFinPlan').value = fin || '';
  window.calcQuote();
}

test('overage defaults to 40% for LeafFilter and Lighting', () => {
  clearOverage();
  window.loadOverageSettings();
  assert.equal(window.overagePctFor('leaffilter'), 40);
  assert.equal(window.overagePctFor('roofline'), 40);
  assert.equal(document.getElementById('overageLf').value, '40');
  assert.equal(document.getElementById('overageLtg').value, '40');
});

test('settings save each product overage and reload it', () => {
  clearOverage();
  window.saveOveragePct('leaffilter', '55');
  window.saveOveragePct('roofline', '25.5');
  document.getElementById('overageLf').value = '';
  document.getElementById('overageLtg').value = '';
  window.loadOverageSettings();
  assert.equal(document.getElementById('overageLf').value, '55');
  assert.equal(document.getElementById('overageLtg').value, '25.5');
  assert.equal(window.localStorage.getItem('cc_overage_pct_leaffilter'), '55');
  assert.equal(window.localStorage.getItem('cc_overage_pct_roofline'), '25.5');
});

test('blank or invalid overage stays on the current value, and 0 is kept', () => {
  clearOverage();
  window.saveOveragePct('leaffilter', '40');
  window.saveOveragePct('leaffilter', '');
  assert.equal(window.overagePctFor('leaffilter'), 40);
  window.saveOveragePct('leaffilter', '0');
  assert.equal(window.overagePctFor('leaffilter'), 0);
  window.saveOveragePct('leaffilter', '-5');
  assert.equal(window.overagePctFor('leaffilter'), 0);
  window.saveOveragePct('roofline', '150');
  assert.equal(window.overagePctFor('roofline'), 100);
});

test('quote commission uses the selected product overage rate', () => {
  clearOverage();
  window.saveOveragePct('leaffilter', '40');
  window.saveOveragePct('roofline', '40');

  // 100 ft of 1st Floor 5" at $39. Retail $3,900. Par $2,535. Sold $4,000 cash.
  // Net after $500 admin = $3,500. Overage = $965. Commission = 8% of par + 40% of overage.
  quoteLeafFilter({ feet: 100, sold: 4000 });
  assert.equal(money('qcComm'), 588.8);
  assert.match(document.getElementById('qcCommTier').textContent, /overage 40%/);

  window.saveOveragePct('leaffilter', '50');
  window.calcQuote();
  assert.equal(money('qcComm'), 685.3);
  assert.match(document.getElementById('qcCommTier').textContent, /overage 50%/);

  // Lighting stays at 40 while LeafFilter is 50.
  window.setQcProduct('roofline');
  document.getElementById('qc_0').value = '100';
  document.getElementById('qcSoldAt').value = '6000';
  document.getElementById('qcFinPlan').value = '';
  window.calcQuote();
  // 100 ft at $44 + control box $800 = retail $5,200. Par $3,380.
  // Net $5,500. Overage $2,120. 8% of par + 40% of overage = $1,118.40.
  assert.equal(money('qcComm'), 1118.4);
  assert.match(document.getElementById('qcCommTier').textContent, /overage 40%/);

  window.saveOveragePct('roofline', '25');
  window.calcQuote();
  assert.equal(money('qcComm'), 800.4);

  window.setQcProduct('leaffilter');
  quoteLeafFilter({ feet: 100, sold: 4000 });
  assert.equal(money('qcComm'), 685.3);
});

test('finance is removed before overage, and under-par tiers ignore the overage rate', () => {
  clearOverage();
  window.saveOveragePct('leaffilter', '40');
  quoteLeafFilter({ feet: 100, sold: 4000, fin: '1148|1.75' });
  // Finance 1.75% of $4,000 = $70. Net $3,430. Overage $895. Commission $560.80.
  assert.equal(money('qcComm'), 560.8);

  quoteLeafFilter({ feet: 100, sold: 2800 });
  const under = money('qcComm');
  assert.equal(under, 46);
  window.saveOveragePct('leaffilter', '80');
  window.calcQuote();
  assert.equal(money('qcComm'), under);
  assert.doesNotMatch(document.getElementById('qcCommTier').textContent, /overage 80%/);
});

test('commission calculator uses the lead product rate when editing', () => {
  clearOverage();
  window.saveOveragePct('leaffilter', '50');
  window.saveOveragePct('roofline', '10');
  window.setQcProduct('leaffilter');
  document.getElementById('esSaleAmt').value = '4000';
  window.esSetProduct('roofline');
  window.openCommCalc('edit');
  document.getElementById('cc_0').value = '100';
  window.calcComm();
  assert.equal(money('ccTotal'), 299.3);
  assert.match(document.getElementById('ccOverCommLabel').textContent, /10%/);

  window.openCommCalc('log');
  document.getElementById('cc_0').value = '100';
  document.getElementById('ccSoldAt').value = '4000';
  window.calcComm();
  assert.equal(money('ccTotal'), 685.3);
  assert.match(document.getElementById('ccOverCommLabel').textContent, /50%/);
});

test('settings sync falls back when overage columns are missing and does not rewrite leads', async () => {
  clearOverage();
  window.saveOveragePct('leaffilter', '33');
  window.saveOveragePct('roofline', '44');
  const upserts = [];
  const tables = [];
  window.sb = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'user-1' } } }, error: null })
    },
    from(table) {
      tables.push(table);
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle: async () => ({ data: null, error: null }),
        upsert(payload) {
          upserts.push(JSON.parse(JSON.stringify(payload)));
          const missing = ['overage_pct_leaffilter', 'overage_pct_roofline'].find(col => Object.prototype.hasOwnProperty.call(payload, col));
          if (missing) {
            return Promise.resolve({ error: { message: "Could not find the '" + missing + "' column of 'app_settings' in the schema cache" } });
          }
          return Promise.resolve({ data: null, error: null });
        }
      };
    }
  };
  await window.syncSettingsToSupabase();
  assert.equal(upserts.length, 3);
  assert.equal(upserts[0].overage_pct_leaffilter, 33);
  assert.equal(upserts[0].overage_pct_roofline, 44);
  assert.equal(Object.prototype.hasOwnProperty.call(upserts[2], 'overage_pct_leaffilter'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(upserts[2], 'overage_pct_roofline'), false);
  assert.equal(upserts[2].user_id, 'user-1');
  assert.equal(tables.includes('leads'), false);
  assert.equal(window.overagePctFor('leaffilter'), 33);
  assert.equal(window.overagePctFor('roofline'), 44);
});

test('loading settings applies saved overage and ignores a row that has no overage columns', async () => {
  clearOverage();
  function sbWith(row) {
    return {
      auth: {
        getSession: async () => ({ data: { session: { user: { id: 'user-1' } } }, error: null })
      },
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle: async () => ({ data: row, error: null })
        };
      }
    };
  }
  window.sb = sbWith({ opening_price_pct: 10 });
  await window.loadSettingsFromSupabase();
  assert.equal(window.overagePctFor('leaffilter'), 40);
  assert.equal(window.overagePctFor('roofline'), 40);

  window.sb = sbWith({ overage_pct_leaffilter: 0, overage_pct_roofline: 18 });
  await window.loadSettingsFromSupabase();
  assert.equal(window.overagePctFor('leaffilter'), 0);
  assert.equal(window.overagePctFor('roofline'), 18);
  assert.equal(document.getElementById('overageLf').value, '0');
  assert.equal(document.getElementById('overageLtg').value, '18');
});
