const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractFunction(source, name) {
  const start = source.search(new RegExp('function ' + name + '\\s*\\('));
  if (start < 0) throw new Error('missing function ' + name);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('unclosed function ' + name);
}

const names = [
  'roundMoney',
  'isLightingCombo',
  'lightingComboParts',
  'leadInProductFilter',
  'tagJobNum',
  'comboSaveFields',
  'crProductKey',
  'crReasonLabel',
  'crIsCancelled',
  'crIsNoShow',
  'crInWindow',
  'crEmptyBucket',
  'closeRateStats',
  'leadProductKey',
  'calcM',
  'fuAddDays',
  'fuReferralSteps',
  'fuProductLabel'
];

const api = new Function(
  'const CLOSE_RATE_START = "2026-10-19";\n' +
  names.map(name => extractFunction(html, name)).join('\n') +
  '\nreturn { roundMoney, isLightingCombo, lightingComboParts, leadInProductFilter, tagJobNum, comboSaveFields, closeRateStats, calcM, fuReferralSteps, fuProductLabel };'
)();

const {
  isLightingCombo,
  lightingComboParts,
  leadInProductFilter,
  tagJobNum,
  comboSaveFields,
  closeRateStats,
  calcM,
  fuReferralSteps,
  fuProductLabel
} = api;

const win = { start: '2026-10-19', end: null };

function lightingComboLead(extra) {
  return Object.assign({
    status: 'sold',
    product: 'leaffilter',
    sale_type: 'combo',
    sale_amount: 10799,
    lighting_amount: 6742,
    commission_amount: 750,
    commission_paid: false,
    sales_date: '2026-10-20',
    install_date: '2026-10-22',
    is_cancelled: false,
    is_btd: false,
    job_number: 'F050-307199 LTG'
  }, extra || {});
}

test('a lighting combo is one sale, combined revenue, and one commission', () => {
  const m = calcM([lightingComboLead({ commission_paid: true })]);
  assert.equal(m.sales, 1);
  assert.equal(m.leads, 1);
  assert.equal(m.rev, 10799);
  assert.equal(m.combo, 1);
  assert.equal(m.commission, 750);
});

test('two linked rows are still two sales until they are converted', () => {
  const shared = { status: 'sold', sale_type: 'single', sales_date: '2026-10-20', is_cancelled: false, job_number: 'F050-307199 LTG' };
  const m = calcM([
    Object.assign({ product: 'roofline', sale_amount: 6742, commission_amount: 750 }, shared),
    Object.assign({ product: 'leaffilter', sale_amount: 4057, commission_amount: 0 }, shared)
  ]);
  assert.equal(m.sales, 2);
  assert.equal(m.rev, 10799);
});

test('product close rate credits both products with their own dollars', () => {
  const stats = closeRateStats([lightingComboLead()], win);
  assert.equal(stats.leaffilter.sold, 1);
  assert.equal(stats.leaffilter.appts, 1);
  assert.equal(stats.leaffilter.saleSum, 4057);
  assert.equal(stats.leaffilter.saleCount, 1);
  assert.equal(stats.roofline.sold, 1);
  assert.equal(stats.roofline.appts, 1);
  assert.equal(stats.roofline.saleSum, 6742);
  assert.equal(stats.roofline.saleCount, 1);
  assert.equal(stats.leaffilter.saleSum + stats.roofline.saleSum, 10799);
});

test('an older gutter combo stays one LeafFilter amount', () => {
  const legacy = {
    status: 'sold', product: 'leaffilter', sale_type: 'combo',
    sale_amount: 8893, lighting_amount: null, sales_date: '2026-10-20', is_cancelled: false
  };
  assert.equal(isLightingCombo(legacy), false);
  const stats = closeRateStats([legacy], win);
  assert.equal(stats.leaffilter.sold, 1);
  assert.equal(stats.leaffilter.saleSum, 8893);
  assert.equal(stats.roofline.sold, 0);
  assert.equal(stats.roofline.saleSum, 0);
});

test('a single lighting sale does not also count as LeafFilter', () => {
  const stats = closeRateStats([{
    status: 'sold', product: 'roofline', sale_type: 'single',
    sale_amount: 6742, sales_date: '2026-10-20', is_cancelled: false
  }], win);
  assert.equal(stats.roofline.sold, 1);
  assert.equal(stats.roofline.saleSum, 6742);
  assert.equal(stats.leaffilter.sold, 0);
});

test('cancelled lighting combos stay out of the product close rate', () => {
  const stats = closeRateStats([lightingComboLead({ is_cancelled: true })], win);
  assert.equal(stats.leaffilter.sold, 0);
  assert.equal(stats.roofline.sold, 0);
  assert.equal(stats.leaffilter.appts, 0);
});

test('save fields store one combined total, one lighting portion, and an LTG job number', () => {
  const fields = comboSaveFields({
    active: true,
    legacy: false,
    leaffilter: 4057,
    lighting: 6742,
    total: 10799
  }, 'F050-307199', 'roofline', 0);
  assert.equal(fields.sale_type, 'combo');
  assert.equal(fields.product, 'leaffilter');
  assert.equal(fields.sale_amount, 10799);
  assert.equal(fields.lighting_amount, 6742);
  assert.equal(fields.job_number, 'F050-307199 LTG');
  assert.deepEqual(lightingComboParts(fields), { total: 10799, leaffilter: 4057, lighting: 6742 });
});

test('an unchecked combo saves a single product and clears the lighting amount', () => {
  const fields = comboSaveFields({ active: false }, 'F050-10', 'leaffilter', 2200);
  assert.equal(fields.sale_type, 'single');
  assert.equal(fields.product, 'leaffilter');
  assert.equal(fields.sale_amount, 2200);
  assert.equal(fields.lighting_amount, null);
  assert.equal(fields.job_number, 'F050-10');
  assert.equal(tagJobNum('F050-10', 'roofline'), 'F050-10 LTG');
});

test('a legacy combo save does not invent a lighting split or an LTG tag', () => {
  const fields = comboSaveFields({
    active: true, legacy: true, leaffilter: 8893, lighting: null, total: 8893
  }, 'F203-239202', 'leaffilter', 8893);
  assert.equal(fields.sale_type, 'combo');
  assert.equal(fields.lighting_amount, null);
  assert.equal(fields.sale_amount, 8893);
  assert.equal(fields.job_number, 'F203-239202');
});

test('history filters show a lighting combo under both products', () => {
  const lead = lightingComboLead();
  assert.equal(leadInProductFilter(lead, 'leaffilter'), true);
  assert.equal(leadInProductFilter(lead, 'roofline'), true);
  assert.equal(leadInProductFilter(lead, 'all'), true);
  const lightingOnly = { product: 'roofline', sale_type: 'single', sale_amount: 100 };
  assert.equal(leadInProductFilter(lightingOnly, 'leaffilter'), false);
  assert.equal(leadInProductFilter({ product: 'leaffilter', sale_type: 'combo', sale_amount: 8893 }, 'roofline'), false);
});

test('a combo job gets one referral sequence and one product phrase', () => {
  const steps = fuReferralSteps(lightingComboLead());
  assert.equal(steps.length, 2);
  assert.deepEqual(steps.map(step => step.key), ['referral_install', 'referral_reminder']);
  const phrase = fuProductLabel('combo');
  assert.equal(phrase, 'LeafFilter and permanent lighting');
  assert.equal(phrase.split('LeafFilter').length - 1, 1);
});
