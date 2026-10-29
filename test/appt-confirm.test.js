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
  'fuReferralLinkValue',
  'fuNoTextReason',
  'fuGroupKey',
  'fuAddDays',
  'fuSeasonalDate',
  'fuSchedule',
  'fuReferralSteps',
  'fuReferralPlan',
  'fuPlan',
  'fillFuMsg',
  'defaultFuTemplates',
  'fuStreetAddress',
  'fuEtParts',
  'fuApptDayWord',
  'fuConfirmProductLabel',
  'fillConfirmProduct',
  'fuConfirmPhone',
  'fuConfirmPlan',
  'fillApptConfirm',
  'fuTouchLeadPatch',
  'mergeFuTemplates'
];

const api = new Function(
  'const FU_OPT_OUT = "If you\'d rather I not follow up, just let me know.";\n' +
  names.map(name => extractFunction(html, name)).join('\n') +
  '\nreturn { fuProductLabel, fuPlan, fillFuMsg, defaultFuTemplates, fuStreetAddress, fuEtParts, fuConfirmProductLabel, fillConfirmProduct, fuConfirmPlan, fillApptConfirm, fuTouchLeadPatch, mergeFuTemplates };'
)();

const {
  fuProductLabel,
  fuPlan,
  fillFuMsg,
  defaultFuTemplates,
  fuStreetAddress,
  fuEtParts,
  fuConfirmProductLabel,
  fillConfirmProduct,
  fuConfirmPlan,
  fillApptConfirm,
  fuTouchLeadPatch,
  mergeFuTemplates
} = api;

const CONFIRM = "Hi [First name], this is Steve with LeafFilter, confirming your [Product] appointment [today/tomorrow] at [time] at [address]. If possible, please have all homeowners present. Looking forward to meeting you!";

function lead(extra) {
  return Object.assign({
    status: 'pending',
    customer_name: 'Linda Coleman',
    customer_phone: '5555550100',
    customer_address: '123 Oak Street, Columbus, OH 43215',
    appointment_at: '2026-10-30T15:00:00.000Z',
    is_cancelled: false,
    followup_status: null,
    followup_stopped_reason: null
  }, extra);
}

test('confirmation template names the product and drops it when blank', () => {
  const tpl = defaultFuTemplates().confirm.appt_confirm;
  assert.equal(tpl, CONFIRM);
  assert.equal(fuConfirmProductLabel('roofline'), 'roofline lighting');
  assert.equal(fuConfirmProductLabel('leaffilter'), 'LeafFilter gutter guard');
  assert.equal(fuConfirmProductLabel(''), '');
  assert.equal(fuConfirmProductLabel(null), '');
  assert.equal(fuConfirmProductLabel(undefined), '');
  assert.equal(fillConfirmProduct('your [Product] appointment', 'roofline'), 'your roofline lighting appointment');
  assert.equal(fillConfirmProduct('your [Product] appointment', 'leaffilter'), 'your LeafFilter gutter guard appointment');
  assert.equal(fillConfirmProduct('your [Product] appointment', ''), 'your appointment');
  assert.equal(fillConfirmProduct('your [Product] appointment', null), 'your appointment');
  assert.equal(fillConfirmProduct('your  [Product]  appointment', '  '), 'your appointment');

  const lighting = fillApptConfirm(tpl, lead({ product: 'roofline' }), '2026-10-29', 'Steve');
  assert.equal(
    lighting,
    "Hi Linda, this is Steve with LeafFilter, confirming your roofline lighting appointment tomorrow at 11:00 AM at 123 Oak Street. If possible, please have all homeowners present. Looking forward to meeting you!"
  );
  const gutters = fillApptConfirm(tpl, lead({
    product: 'leaffilter',
    appointment_at: '2026-10-29T19:00:00.000Z'
  }), '2026-10-29', 'Steve');
  assert.equal(
    gutters,
    "Hi Linda, this is Steve with LeafFilter, confirming your LeafFilter gutter guard appointment today at 3:00 PM at 123 Oak Street. If possible, please have all homeowners present. Looking forward to meeting you!"
  );
  const generic = fillApptConfirm(tpl, lead({ product: '' }), '2026-10-29', 'Steve');
  assert.equal(
    generic,
    "Hi Linda, this is Steve with LeafFilter, confirming your appointment tomorrow at 11:00 AM at 123 Oak Street. If possible, please have all homeowners present. Looking forward to meeting you!"
  );
  assert.equal(generic.includes('[Product]'), false);
  assert.equal(generic.includes('gutter'), false);
  assert.equal(generic.includes('roofline'), false);
  assert.equal(generic.includes('  '), false);
  assert.equal(fuStreetAddress('123 Oak Street, Columbus, OH 43215'), '123 Oak Street');
  assert.equal(fuEtParts('2026-10-30T15:00:00.000Z').time, '11:00 AM');
});

test('follow-up [Product] wording is unchanged', () => {
  assert.equal(fuProductLabel('roofline'), 'permanent lighting');
  assert.equal(fuProductLabel('leaffilter'), 'LeafFilter');
  assert.equal(fuProductLabel(undefined), 'LeafFilter');
  assert.equal(fillFuMsg('Hi [Name], checking on [Product].', 'Linda Coleman', 'Steve', 'roofline'), 'Hi Linda, checking on permanent lighting.');
  assert.equal(fillFuMsg('Hi [Name], checking on [Product].', 'Linda Coleman', 'Steve', 'leaffilter'), 'Hi Linda, checking on LeafFilter.');
  const saved = defaultFuTemplates();
  assert.equal(saved.price.leaffilter.day2.includes('[Product]'), true);
  assert.equal(saved.referral.roofline.referral_install.includes('[Product]'), true);
});

test('pending appointments today or tomorrow are due once, and only with a phone', () => {
  const tomorrow = fuConfirmPlan(lead({ product: 'roofline' }), [], '2026-10-29');
  assert.equal(tomorrow.bucket, 'today');
  assert.equal(tomorrow.group, 'confirm');
  assert.equal(tomorrow.step.key, 'appt_confirm');
  assert.equal(tomorrow.dayWord, 'tomorrow');
  assert.equal(tomorrow.timeLabel, '11:00 AM');
  assert.equal(tomorrow.date, '2026-10-30');

  const today = fuConfirmPlan(lead({ appointment_at: '2026-10-29T19:00:00.000Z' }), [], '2026-10-29');
  assert.equal(today.dayWord, 'today');
  assert.equal(today.timeLabel, '3:00 PM');

  assert.equal(fuConfirmPlan(lead({ appointment_at: '2026-10-31T15:00:00.000Z' }), [], '2026-10-29'), null);
  assert.equal(fuConfirmPlan(lead({ appointment_at: '2026-10-28T15:00:00.000Z' }), [], '2026-10-29'), null);
  assert.equal(fuConfirmPlan(lead({ customer_phone: '' }), [], '2026-10-29'), null);
  assert.equal(fuConfirmPlan(lead({ customer_phone: '555' }), [], '2026-10-29'), null);
  assert.equal(fuConfirmPlan(lead({ customer_phone: '', followup_phone: '5555550100' }), [], '2026-10-29'), null);
  assert.equal(fuConfirmPlan(lead({ appointment_at: '' }), [], '2026-10-29'), null);
  assert.equal(fuConfirmPlan(lead({ is_cancelled: true }), [], '2026-10-29'), null);
  assert.equal(fuConfirmPlan(lead({ status: 'sold' }), [], '2026-10-29'), null);
  assert.equal(fuConfirmPlan(lead({ status: 'not_sold' }), [], '2026-10-29'), null);
  assert.equal(fuConfirmPlan(lead(), [{ step_key: 'appt_confirm', sent_on: '2026-10-29' }], '2026-10-29'), null);

  const stopped = fuConfirmPlan(lead({
    followup_status: 'stopped',
    followup_stopped_reason: 'Do not text'
  }), [], '2026-10-29');
  assert.equal(stopped.bucket, 'done');
  assert.equal(stopped.stoppedReason, 'Do not text');
  assert.equal(stopped.group, 'confirm');

  const viaPlan = fuPlan(lead({ product: '' }), [], '2026-10-29');
  assert.equal(viaPlan.group, 'confirm');
  assert.equal(viaPlan.step.key, 'appt_confirm');

  const referralSameDay = fuPlan({
    status: 'sold',
    sales_date: '2026-10-01',
    install_date: '2026-10-28',
    is_cancelled: false
  }, [{ step_key: 'appt_confirm', sent_on: '2026-10-29' }], '2026-10-29');
  assert.equal(referralSameDay.group, 'referral');
  assert.equal(referralSameDay.bucket, 'today');
  assert.equal(referralSameDay.hold, false);
  assert.equal(referralSameDay.step.key, 'referral_install');

  const nosale = fuPlan({
    status: 'not_sold',
    sales_date: '2026-10-01',
    product: 'leaffilter',
    notes: '',
    reasonLabel: 'Too much',
    followup_done: false,
    followup_status: 'active',
    is_cancelled: false
  }, [], '2026-10-02');
  assert.equal(nosale.group, 'price');
  assert.equal(nosale.step.key, 'day2');
  assert.equal(nosale.bucket, 'today');
});

test('sending a confirmation does not finish the later follow-up sequence', () => {
  assert.equal(fuTouchLeadPatch({
    plan: { group: 'confirm', step: { key: 'appt_confirm', num: 1, total: 1 } },
    salesDate: '',
    product: ''
  }), null);
  assert.deepEqual(fuTouchLeadPatch({
    plan: { group: 'price', step: { key: 'day2', num: 1, total: 4 } },
    salesDate: '2026-10-01',
    product: 'leaffilter'
  }), {
    followup_date: '2026-10-08',
    followup_status: 'active',
    followup_done: false,
    followup_stopped_reason: null
  });
  const merged = mergeFuTemplates(defaultFuTemplates(), {
    confirm: { appt_confirm: 'Custom [Product] [today/tomorrow]' }
  });
  assert.equal(merged.confirm.appt_confirm, 'Custom [Product] [today/tomorrow]');
  assert.equal(merged.price.leaffilter.day2, defaultFuTemplates().price.leaffilter.day2);
  assert.equal(html.includes(".in('status', ['not_sold', 'sold', 'pending'])"), true);
  assert.equal(html.includes('Appointment confirmation'), true);
  assert.equal(html.includes('function logFuTouch'), true);
  assert.equal(html.includes('fuTouchLeadPatch(row)'), true);
});
