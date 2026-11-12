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

function cents(n) {
  return Math.round(n * 100) / 100;
}

test('commission math outputs are unchanged', () => {
  const above = window.saleCommission({ retail: 3900, sold: 4000, financeRatePct: 0, overagePct: 40 });
  assert.equal(above.isUnderPar, false);
  assert.equal(cents(above.par), 2535);
  assert.equal(cents(above.parComm), 202.8);
  assert.equal(cents(above.total), 588.8);

  const financed = window.saleCommission({ retail: 3900, sold: 4000, financeRatePct: 10, overagePct: 40 });
  assert.equal(financed.isUnderPar, false);
  assert.equal(cents(financed.finCharge), 400);
  assert.equal(cents(financed.effectiveNet), 3100);
  assert.equal(cents(financed.total), 428.8);

  const tier60 = window.saleCommission({ retail: 3900, sold: 2900, financeRatePct: 0, overagePct: 80 });
  assert.equal(tier60.isUnderPar, true);
  assert.equal(cents(tier60.total), 120);
  assert.match(tier60.tierDesc, /60/);

  const tier55 = window.saleCommission({ retail: 3900, sold: 2800, financeRatePct: 0, overagePct: 80 });
  assert.equal(cents(tier55.total), 46);
  assert.match(tier55.tierDesc, /55/);

  const tierLow = window.saleCommission({ retail: 3900, sold: 2500, financeRatePct: 0, overagePct: 40 });
  assert.equal(cents(tierLow.total), 20);
  assert.match(tierLow.tierDesc, /Below 55/);

  assert.equal(window.smsAllowedAtHour(7), false);
  assert.equal(window.smsAllowedAtHour(8), true);
  assert.equal(window.smsAllowedAtHour(20), true);
  assert.equal(window.smsAllowedAtHour(21), false);
});
