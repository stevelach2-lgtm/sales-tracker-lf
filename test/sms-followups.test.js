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
  'fuLeadHasPhone',
  'fuReferralLinkValue',
  'fuReferralSteps',
  'fuReferralBackfillMap',
  'fuReferralPlan',
  'fillFuMsg',
  'fuNoTextReason',
  'fuGroupKey',
  'fuAddDays',
  'fuSeasonalDate',
  'fuSchedule',
  'fuPlan',
  'fuDontTextPatch',
  'fuResumeTextPatch',
  'fuEnrollPatch',
  'defaultFuTemplates'
];
const api = new Function(
  'const FU_OPT_OUT = "If you\'d rather I not follow up, just let me know.";\n' +
  names.map(name => extractFunction(html, name)).join('\n') +
  '\nreturn { smsFirstName, fuProductLabel, fuReferralLinkValue, fuReferralSteps, fuReferralBackfillMap, fillFuMsg, fuNoTextReason, fuGroupKey, fuPlan, fuDontTextPatch, fuResumeTextPatch, fuEnrollPatch, defaultFuTemplates };'
)();

const { smsFirstName, fuProductLabel, fuReferralLinkValue, fuReferralSteps, fuReferralBackfillMap, fillFuMsg, fuNoTextReason, fuGroupKey, fuPlan, fuDontTextPatch, fuResumeTextPatch, fuEnrollPatch, defaultFuTemplates } = api;

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
  const defaults = defaultFuTemplates();
  ['price', 'decision', 'other', 'noshow'].forEach(group => {
    assert.equal(JSON.stringify(defaults[group]).includes('LeafFilter'), false);
  });
  assert.equal(JSON.stringify(defaults).includes('[Product]'), true);
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

test("Don't text stops an active no-sale and resume turns it back on", () => {
  const stop = fuDontTextPatch();
  assert.equal(stop.followup_status, 'stopped');
  assert.equal(stop.followup_stopped_reason, 'Do not text');
  assert.equal(stop.followup_done, true);
  const resume = fuResumeTextPatch();
  assert.equal(resume.followup_status, 'active');
  assert.equal(resume.followup_stopped_reason, null);
  assert.equal(resume.followup_done, false);

  const optedOut = fuEnrollPatch('Spouse not home', '', '2026-10-01', 'leaffilter', '5555550100', 'Linda Coleman', { dontText: true });
  assert.equal(optedOut.followup_status, 'stopped');
  assert.equal(optedOut.followup_stopped_reason, 'Do not text');
  assert.equal(optedOut.followup_done, true);
  assert.equal(optedOut.followup_date, null);

  const alreadyStopped = fuEnrollPatch('No demo', '', '2026-10-01', 'leaffilter', '5555550100', 'Linda Coleman', { dontText: true });
  assert.equal(alreadyStopped.followup_stopped_reason, 'no_demo');
  assert.equal(alreadyStopped.followup_status, 'stopped');

  const hidden = fuPlan({
    status: 'not_sold',
    sales_date: '2026-10-01',
    product: 'leaffilter',
    notes: '',
    reasonLabel: 'Spouse not home',
    followup_done: true,
    followup_status: 'stopped',
    followup_stopped_reason: 'Do not text',
    is_cancelled: false
  }, [], '2026-10-02');
  assert.equal(hidden && hidden.bucket, 'done');
  assert.equal(hidden.stoppedReason, 'Do not text');

  const back = fuPlan({
    status: 'not_sold',
    sales_date: '2026-10-01',
    product: 'leaffilter',
    notes: '',
    reasonLabel: 'Spouse not home',
    followup_done: resume.followup_done,
    followup_status: resume.followup_status,
    followup_stopped_reason: resume.followup_stopped_reason,
    is_cancelled: false
  }, [], '2026-10-02');
  assert.equal(back && back.bucket, 'today');

  assert.equal(html.includes('id="ccNotDontText"'), true);
  assert.equal(html.includes('id="fuDontTextBtn"'), true);
  assert.equal(html.includes('id="fuResumeTextBtn"'), true);
  assert.equal(html.includes("Don't text "), true);
  assert.equal(html.includes('function dontTextLead'), true);
  assert.equal(html.includes('function resumeTexting'), true);
  assert.equal(html.includes('window.confirm'), true);
});

const referralInstall = "Hi [First name], it's Steve from LeafFilter. How did the install go? I hope your new [Product] looks great! Quick favor: if you know anyone who could use it, grab the referral app here [Referral link] and share your link. You get $250 for every friend whose project over $1,000 gets installed, no limit.";
const referralReminder = "Hi [First name], Steve from LeafFilter. Hope you're loving your new [Product]! Quick reminder: your referral link pays you $250 for every friend whose project over $1,000 gets installed, no limit. Get the app here: [Referral link]. Fall is when neighbors notice their gutters, so it's a great time to share it.";

test('sold referral texts follow the install date and saved templates', () => {
  const templates = defaultFuTemplates();
  assert.equal(templates.referral.leaffilter.referral_install, referralInstall);
  assert.equal(templates.referral.leaffilter.referral_reminder, referralReminder);
  assert.equal(templates.referral.roofline.referral_install, referralInstall);
  assert.equal(templates.referral.roofline.referral_reminder, referralReminder);
  assert.equal(templates.referral.leaffilter.referral_install.includes('\n– [RepName]'), false);

  const future = fuPlan({
    status: 'sold',
    sales_date: '2026-10-01',
    install_date: '2026-11-01',
    product: 'roofline',
    followup_done: true,
    followup_status: 'stopped',
    followup_stopped_reason: 'sold',
    is_cancelled: false
  }, [], '2026-10-22');
  assert.equal(future.group, 'referral');
  assert.equal(future.bucket, 'upcoming');
  assert.equal(future.step.key, 'referral_install');
  assert.equal(future.date, '2026-11-02');
  assert.equal(fuReferralSteps({ install_date: '2026-11-01', sales_date: '2026-10-01' })[1].date, '2026-11-22');

  const noInstall = fuPlan({
    status: 'sold',
    sales_date: '2026-10-22',
    install_date: '',
    followup_stopped_reason: 'sold',
    followup_done: true,
    is_cancelled: false
  }, [], '2026-10-22');
  assert.equal(noInstall, null);

  const onAnchor = fuPlan({
    status: 'sold',
    sales_date: '2026-09-01',
    install_date: '2026-10-22',
    is_cancelled: false
  }, [], '2026-10-22');
  assert.equal(onAnchor.step.key, 'referral_install');
  assert.equal(onAnchor.date, '2026-10-23');
  assert.equal(fuReferralSteps({ install_date: '2026-10-22', sales_date: '2026-09-01' })[1].date, '2026-11-12');

  const cancelled = fuPlan({
    status: 'sold',
    sales_date: '2026-10-01',
    install_date: '2026-11-01',
    is_cancelled: true
  }, [], '2026-10-22');
  assert.equal(cancelled, null);

  const backfilled = fuPlan({
    status: 'sold',
    sales_date: '2026-07-01',
    install_date: '2026-07-15',
    referral_backfill_on: '2026-10-25',
    followup_done: true,
    followup_status: 'stopped',
    followup_stopped_reason: 'sold',
    customer_phone: '5555550100',
    is_cancelled: false
  }, [], '2026-10-22');
  assert.equal(backfilled.step.key, 'referral_reminder');
  assert.equal(backfilled.step.total, 1);
  assert.equal(backfilled.date, '2026-10-25');
  assert.equal(backfilled.bucket, 'upcoming');

  const pastWithoutDate = fuPlan({
    status: 'sold',
    sales_date: '2026-07-01',
    install_date: '2026-07-15',
    is_cancelled: false,
    customer_phone: '5555550100'
  }, [], '2026-10-22');
  assert.equal(pastWithoutDate, null);

  const ancient = fuPlan({
    status: 'sold',
    sales_date: '2026-06-01',
    install_date: '2026-06-15',
    is_cancelled: false,
    customer_phone: '5555550100'
  }, [], '2026-10-22');
  assert.equal(ancient, null);

  const stopped = fuPlan({
    status: 'sold',
    sales_date: '2026-10-01',
    install_date: '2026-11-01',
    followup_status: 'stopped',
    followup_stopped_reason: 'Do not text',
    followup_done: true,
    is_cancelled: false
  }, [], '2026-10-22');
  assert.equal(stopped.bucket, 'done');
  assert.equal(stopped.stoppedReason, 'Do not text');

  const resume = fuResumeTextPatch();
  const resumed = fuPlan({
    status: 'sold',
    sales_date: '2026-10-01',
    install_date: '2026-11-01',
    followup_status: resume.followup_status,
    followup_stopped_reason: resume.followup_stopped_reason,
    followup_done: resume.followup_done,
    is_cancelled: false
  }, [], '2026-10-22');
  assert.equal(resumed.bucket, 'upcoming');
  assert.equal(resumed.step.key, 'referral_install');

  const lighting = fillFuMsg(referralInstall, 'Linda Coleman', 'Steve', 'roofline');
  assert.equal(lighting.includes('Linda'), true);
  assert.equal(lighting.includes('[First name]'), false);
  assert.equal(lighting.includes('permanent lighting'), true);
  assert.equal(lighting.includes('[Product]'), false);
  assert.equal(lighting.includes('https://gtrfl.us/TNCz3q'), true);
  assert.equal(lighting.includes('[Referral link]'), false);
  assert.equal(lighting.includes('for every friend whose project over $1,000 gets installed, no limit.'), true);
  const gutters = fillFuMsg(referralInstall, 'Linda Coleman', 'Steve', 'leaffilter');
  assert.equal(gutters.includes('LeafFilter'), true);
  assert.equal(gutters.includes('your new LeafFilter'), true);
  assert.equal(fillFuMsg('Link [Referral link].', 'Linda', 'Steve', 'leaffilter', 'https://example.com/mine'), 'Link https://example.com/mine.');
  assert.equal(fuReferralLinkValue(''), 'https://gtrfl.us/TNCz3q');
  assert.equal(fillFuMsg('Hi [First name].', '   ', 'Steve'), 'Hi.');

  assert.equal(html.includes('Referral: after install'), true);
  assert.equal(html.includes('Referral: reminder'), true);
  assert.equal(html.includes('id="fuReferralLink"'), true);
  assert.equal(html.includes('function saveReferralLinkSetting'), true);
  assert.equal(html.includes(".in('status', ['not_sold', 'sold'])"), true);

  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '2026-10-22_referral_backfill.sql'), 'utf8');
  assert.equal(sql.includes('add column if not exists referral_backfill_on'), true);
  assert.equal(sql.includes('2026-07-01'), true);
  assert.equal(sql.includes('2026-10-22'), true);
  assert.equal(sql.includes('install_date is not null'), true);
  assert.equal(sql.includes('install_date < date'), true);
  assert.equal(/drop table/i.test(sql), false);
  assert.equal(sql.includes('DO NOT APPLY'), true);
});

test('past sold installs are staggered about five reminders a day', () => {
  const phone = '5555550100';
  const leads = [0, 1, 2, 3, 4, 5].map(i => ({
    id: 's' + i,
    status: 'sold',
    sales_date: '2026-07-' + String(i + 1).padStart(2, '0'),
    install_date: '2026-07-20',
    customer_phone: phone,
    is_cancelled: false
  }));
  leads.push({ id: 'nophone', status: 'sold', sales_date: '2026-07-01', install_date: '2026-07-20', customer_phone: '', is_cancelled: false });
  leads.push({ id: 'noinstall', status: 'sold', sales_date: '2026-07-02', install_date: '', customer_phone: phone, is_cancelled: false });
  leads.push({ id: 'early', status: 'sold', sales_date: '2026-06-15', install_date: '2026-06-20', customer_phone: phone, is_cancelled: false });
  leads.push({ id: 'cancelled', status: 'sold', sales_date: '2026-07-03', install_date: '2026-07-20', customer_phone: phone, is_cancelled: true });
  leads.push({ id: 'future', status: 'sold', sales_date: '2026-07-04', install_date: '2026-11-01', customer_phone: phone, is_cancelled: false });
  const map = fuReferralBackfillMap(leads);
  assert.deepEqual(Object.keys(map).sort(), ['s0', 's1', 's2', 's3', 's4', 's5']);
  assert.equal(map.s0, '2026-10-22');
  assert.equal(map.s4, '2026-10-22');
  assert.equal(map.s5, '2026-10-23');
  assert.equal(map.nophone, undefined);
  assert.equal(map.future, undefined);
});
