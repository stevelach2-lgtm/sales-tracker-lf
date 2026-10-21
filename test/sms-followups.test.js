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
  'smsFirstName',
  'fuProductLabel',
  'fillFuMsg',
  'fuNoTextReason',
  'fuGroupKey',
  'fuAddDays',
  'fuSeasonalDate',
  'fuSchedule',
  'fuPlan',
  'fuEnrollPatch',
  'defaultFuTemplates'
];
const api = new Function(
  'const FU_OPT_OUT = "If you\'d rather I not follow up, just let me know.";\n' +
  names.map(name => extractFunction(html, name)).join('\n') +
  '\nreturn { smsFirstName, fuProductLabel, fillFuMsg, fuNoTextReason, fuGroupKey, fuPlan, fuEnrollPatch, defaultFuTemplates };'
)();

const { smsFirstName, fuProductLabel, fillFuMsg, fuNoTextReason, fuGroupKey, fuPlan, fuEnrollPatch, defaultFuTemplates } = api;

const day2 = defaultFuTemplates().price.leaffilter.day2;

test('saved template wording stays exactly as written', () => {
  assert.equal(
    day2,
    "Hi [Name], it's [RepName] from [Product]. Thanks for letting me show you the gutter guards. I know the price was more than you wanted to spend. I'm happy to answer questions or walk through the quote again if that helps. If you'd rather I not follow up, just let me know.\n– [RepName]"
  );
});

test('Linda Coleman is filled as Linda and the rest of the template is unchanged', () => {
  const msg = fillFuMsg(day2, 'Linda Coleman', 'Steve');
  assert.equal(
    msg,
    day2.replaceAll('[Name]', 'Linda').replaceAll('[Product]', 'LeafFilter').replaceAll('[RepName]', 'Steve')
  );
  assert.equal(msg.includes('Linda Coleman'), false);
  assert.equal(msg.includes('there'), false);
  assert.equal(msg.includes('[Product]'), false);
});

test('trims whitespace and skips leading titles', () => {
  assert.equal(smsFirstName('  Linda   Coleman  '), 'Linda');
  assert.equal(smsFirstName('Mr. Linda Coleman'), 'Linda');
  assert.equal(smsFirstName('Mrs Linda Coleman'), 'Linda');
  assert.equal(smsFirstName('Ms. Linda Coleman'), 'Linda');
  assert.equal(smsFirstName('Dr Linda Coleman'), 'Linda');
  assert.equal(smsFirstName('Mr. and Mrs. Linda Coleman'), 'Linda');
  assert.equal(fillFuMsg('Hi [Name], it is [RepName].', 'Dr. Linda Coleman', 'Steve'), 'Hi Linda, it is Steve.');
});

test('an initial or a blank name becomes a greeting with no name', () => {
  assert.equal(smsFirstName(''), '');
  assert.equal(smsFirstName('   '), '');
  assert.equal(smsFirstName('J Coleman'), '');
  assert.equal(smsFirstName('J. Coleman'), '');
  assert.equal(smsFirstName('Dr. J. Smith'), '');
  assert.equal(smsFirstName('Mr.'), '');
  const blank = fillFuMsg(day2, '   ', 'Steve');
  const initial = fillFuMsg(day2, 'J. Coleman', 'Steve');
  const expected = day2.replace('[Name]', '').replace(/[ \t]+,/g, ',').replaceAll('[RepName]', 'Steve').replace(/^ /, '');
  assert.equal(blank, "Hi, it's Steve from LeafFilter. Thanks for letting me show you the gutter guards. I know the price was more than you wanted to spend. I'm happy to answer questions or walk through the quote again if that helps. If you'd rather I not follow up, just let me know.\n– Steve");
  assert.equal(initial, blank);
  assert.equal(blank.includes('there'), false);
  assert.equal(blank.includes('J.'), false);
  assert.equal(expected.startsWith('Hi,'), true);
});

test('No demo, No one home, and No show are out of the cadence and stopped', () => {
  for (const label of ['No demo', 'No one home', 'No show']) {
    assert.equal(fuGroupKey(label, ''), null);
    const plan = fuPlan({
      status: 'not_sold',
      sales_date: '2026-10-01',
      product: 'leaffilter',
      notes: '',
      reasonLabel: label,
      followup_done: false,
      followup_status: 'active',
      followup_stopped_reason: null,
      is_cancelled: false
    }, [], '2026-10-20');
    assert.equal(plan, null, label);
    const patch = fuEnrollPatch(label, '', '2026-10-01', 'leaffilter', '5555550100', 'Linda Coleman');
    assert.equal(patch.followup_status, 'stopped', label);
    assert.equal(patch.followup_done, true, label);
    assert.equal(patch.followup_date, null, label);
    assert.ok(patch.followup_stopped_reason, label);
    assert.equal(patch.followup_name, 'Linda Coleman');
  }
  assert.equal(fuNoTextReason('No demo'), 'no_demo');
  assert.equal(fuNoTextReason('No one home'), 'no_one_home');
  assert.equal(fuNoTextReason('No show'), 'no_show');
});

test('Spouse not home still gets a follow-up text cadence', () => {
  assert.equal(fuNoTextReason('Spouse not home'), '');
  assert.equal(fuGroupKey('Spouse not home', ''), 'decision');
  const patch = fuEnrollPatch('Spouse not home', '', '2026-10-01', 'leaffilter', '5555550100', 'Linda Coleman');
  assert.equal(patch.followup_status, 'active');
  assert.equal(patch.followup_stopped_reason, null);
  assert.equal(patch.followup_done, false);
  assert.equal(patch.followup_date, '2026-10-02');
  const plan = fuPlan({
    status: 'not_sold',
    sales_date: '2026-10-01',
    product: 'leaffilter',
    notes: '',
    reasonLabel: 'Spouse not home',
    followup_done: false,
    followup_status: 'active',
    followup_date: '2026-10-03',
    is_cancelled: false
  }, [], '2026-10-02');
  assert.equal(plan && plan.bucket, 'today');
  assert.equal(plan.date, '2026-10-02');
  assert.equal(plan.step && plan.step.key, 'day2');
  assert.equal(plan.group, 'decision');
});

test('an unsent first text is due the day after the appointment', () => {
  const lead = {
    status: 'not_sold',
    sales_date: '2026-10-01',
    product: 'leaffilter',
    notes: '',
    reasonLabel: 'Too much',
    followup_done: false,
    followup_status: 'active',
    followup_date: '2026-10-03',
    is_cancelled: false
  };
  const sameDay = fuPlan(lead, [], '2026-10-01');
  assert.equal(sameDay.bucket, 'upcoming');
  assert.equal(sameDay.date, '2026-10-02');
  assert.equal(sameDay.step.key, 'day2');
  const nextDay = fuPlan(lead, [], '2026-10-02');
  assert.equal(nextDay.bucket, 'today');
  const sentFirst = fuPlan(lead, [{ step_key: 'day2', sent_on: '2026-10-02' }], '2026-10-08');
  assert.equal(sentFirst.bucket, 'today');
  assert.equal(sentFirst.step.key, 'day7');
  assert.equal(sentFirst.date, '2026-10-08');
  const day30 = fuPlan(lead, [
    { step_key: 'day2', sent_on: '2026-10-02' },
    { step_key: 'day7', sent_on: '2026-10-08' }
  ], '2026-10-31');
  assert.equal(day30.bucket, 'today');
  assert.equal(day30.step.key, 'day30');
  assert.equal(day30.date, '2026-10-31');
  const seasonal = fuPlan(lead, [
    { step_key: 'day2', sent_on: '2026-10-02' },
    { step_key: 'day7', sent_on: '2026-10-08' },
    { step_key: 'day30', sent_on: '2026-10-31' }
  ], '2026-11-01');
  assert.equal(seasonal.step.key, 'seasonal');
  assert.equal(seasonal.date, '2027-09-15');
  const lighting = fuPlan(Object.assign({}, lead, { product: 'roofline' }), [
    { step_key: 'day2', sent_on: '2026-10-02' },
    { step_key: 'day7', sent_on: '2026-10-08' },
    { step_key: 'day30', sent_on: '2026-10-31' }
  ], '2026-11-01');
  assert.equal(lighting.step.key, 'seasonal');
  assert.equal(lighting.date, '2027-10-03');
});

test('[Product] is filled from the lead product and literal LeafFilter is left alone', () => {
  assert.equal(fuProductLabel('leaffilter'), 'LeafFilter');
  assert.equal(fuProductLabel('roofline'), 'permanent lighting');
  assert.equal(fuProductLabel(undefined), 'LeafFilter');
  const defaults = JSON.stringify(defaultFuTemplates());
  assert.equal(defaults.includes('LeafFilter'), false);
  assert.equal(defaults.includes('[Product]'), true);
  const lighting = fillFuMsg(day2, 'Linda Coleman', 'Steve', 'roofline');
  assert.equal(lighting.includes('permanent lighting'), true);
  assert.equal(lighting.includes('LeafFilter'), false);
  assert.equal(lighting.includes('[Product]'), false);
  const saved = fillFuMsg("Hi [Name], checking on [Product].", 'Linda Coleman', 'Steve', 'roofline');
  assert.equal(saved, 'Hi Linda, checking on permanent lighting.');
  const literal = fillFuMsg("Hi [Name], it's [RepName] from LeafFilter.", 'Linda Coleman', 'Steve', 'roofline');
  assert.equal(literal, "Hi Linda, it's Steve from LeafFilter.");
});

test('the first no-sale step is labeled day 1', () => {
  assert.equal(html.includes("day2: 'Day 2'"), false);
  assert.equal(html.includes('Day 2'), false);
  assert.equal(html.includes("day2: 'Day 1'"), true);
  assert.equal(html.includes('fuAddDays(closeDate, 2)'), false);
  assert.equal(html.includes("date: fuAddDays(closeDate, 1)"), true);
});
