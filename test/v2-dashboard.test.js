const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const v2 = require('../lib/v2-logic.js');

test('IRS mileage rate follows the dated table and leaves unknown years blank', () => {
  assert.equal(v2.irsRateForDate('2026-01-01').rate, 0.725);
  assert.equal(v2.irsRateForDate('2026-06-30').cents, 72.5);
  assert.equal(v2.irsRateForDate('2026-07-01').rate, 0.76);
  assert.equal(v2.irsRateForDate('2026-11-11').label, '76¢');
  assert.equal(v2.irsRateForDate('2026-12-31').rate, 0.76);
  assert.equal(v2.irsRateForDate('2025-12-31'), null);
  assert.equal(v2.irsRateForDate('2027-01-01'), null);

  const nov = v2.deductionForDays([{ date: '2026-11-01', miles: 1097.5 }]);
  assert.equal(nov.dollars, 834.1);
  assert.deepEqual(nov.rateLabels, ['76¢']);

  const mixed = v2.deductionForDays([
    { date: '2026-06-15', miles: 100 },
    { date: '2026-08-01', miles: 100 }
  ]);
  assert.equal(mixed.dollars, 148.5);
  assert.equal(mixed.miles, 200);
});

test('Leave by matches the weather pad table for a 34 minute drive', () => {
  const at = '2026-11-12T16:00:00.000Z';
  const expectLeave = (severity, minutesBefore) => {
    const plan = v2.leaveBy({ appointmentAt: at, driveMinutes: 34, severity: severity });
    assert.equal(plan.padMinutes, minutesBefore - 34);
    assert.equal(plan.totalMinutes, minutesBefore);
    assert.equal(new Date(plan.leaveAt).getTime(), new Date(at).getTime() - minutesBefore * 60000);
  };
  expectLeave('clear', 34);
  expectLeave('rain', 44);
  expectLeave('snow', 49);
  expectLeave('ice', 54);
  assert.equal(v2.leaveBy({ appointmentAt: at, driveMinutes: 34, severity: 'rain' }).padReason, '+10 min rain');
  assert.equal(v2.leaveBy({ appointmentAt: at, driveMinutes: null, severity: 'rain' }), null);
  assert.equal(v2.leaveBy({ appointmentAt: at, driveMinutes: 34, severity: 'clear' }).tight, false);

  const earliest = new Date(new Date(at).getTime() - 60 * 60000).toISOString();
  const fits = v2.leaveBy({ appointmentAt: at, driveMinutes: 34, severity: 'rain', earliestLeaveAt: earliest });
  assert.equal(fits.tight, false);
  assert.equal(fits.warning, '');
  assert.equal(new Date(fits.leaveAt).getTime(), new Date(at).getTime() - 44 * 60000);

  const tight = v2.leaveBy({ appointmentAt: at, driveMinutes: 90, severity: 'rain', earliestLeaveAt: earliest });
  assert.equal(tight.leaveAt, earliest);
  assert.equal(tight.tight, true);
  assert.equal(tight.lateMinutes, 40);
  assert.equal(tight.warning, "Tight: you'll be about 40 min late");

  const home = v2.homeBy({ lastAppointmentAt: at, driveHomeMinutes: 40 });
  assert.equal(new Date(home).getTime(), new Date(at).getTime() + (60 + 40) * 60000);
});

test('weather warnings keep rain, snow, ice, and temperature and drop wind', () => {
  const alerts = [
    { event: 'Wind Advisory' },
    { event: 'High Wind Warning' },
    { event: 'Winter Storm Warning' },
    { event: 'Flood Warning' },
    { event: 'Excessive Heat Warning' },
    { event: 'Extreme Cold Warning' },
    { event: 'Tornado Warning' }
  ];
  const kept = v2.filterNwsAlerts(alerts).map(a => a.event);
  assert.deepEqual(kept, [
    'Winter Storm Warning',
    'Flood Warning',
    'Excessive Heat Warning',
    'Extreme Cold Warning'
  ]);
  assert.equal(kept.some(name => /wind/i.test(name)), false);

  const rainy = v2.warningsForPoint({ tempF: 41, rainChance: 70, shortForecast: 'Rain' });
  assert.equal(rainy.some(w => w.kind === 'rain'), true);
  assert.equal(v2.severityForPoint({ tempF: 41, rainChance: 70, shortForecast: 'Rain' }), 'rain');
  assert.equal(v2.severityForPoint({ tempF: 41, rainChance: 40, shortForecast: 'Slight Chance Rain' }), 'clear');

  const snow = v2.severityForPoint({ tempF: 30, snowChance: 80, snowAmount: 1, shortForecast: 'Snow' });
  assert.equal(snow, 'snow');
  const freezingRain = v2.severityForPoint({ tempF: 31, rainChance: 80, shortForecast: 'Rain' });
  assert.equal(freezingRain, 'snow');
  const iceStorm = v2.severityForPoint({
    tempF: 30,
    shortForecast: 'Rain',
    alerts: [{ event: 'Winter Storm Warning' }]
  });
  assert.equal(iceStorm, 'ice');
  assert.equal(v2.worstSeverity(['clear', 'rain', 'snow']), 'snow');

  const cold = v2.warningsForPoint({ tempF: 20, rainChance: 0, shortForecast: 'Sunny' });
  assert.equal(cold.some(w => w.kind === 'cold'), true);
  const heat = v2.warningsForPoint({ tempF: 92, heatIndexF: 97, rainChance: 0, shortForecast: 'Hot' });
  assert.equal(heat.some(w => w.kind === 'heat'), true);
  const windy = v2.warningsForPoint({ tempF: 55, rainChance: 0, shortForecast: 'Windy', alerts: [{ event: 'Wind Advisory' }] });
  assert.equal(windy.some(w => /wind/i.test(w.label)), false);
  assert.equal(v2.stripWindWords('Breezy and windy'), 'and');
});

test('mockup status flow requests, fails with a reason, and retries', () => {
  const off = v2.mockupRequestDecision({ webhookConfigured: false, hasPhoto: true, webhookOk: true });
  assert.equal(off.notConfigured, true);
  assert.equal(off.buttonLabel, 'Not set up yet');
  assert.equal(off.status, null);
  assert.equal(off.callWebhook, false);

  const noPhoto = v2.mockupRequestDecision({ webhookConfigured: true, hasPhoto: false, webhookOk: true });
  assert.equal(noPhoto.status, 'failed');
  assert.equal(noPhoto.error, 'Add a photo of the house first');
  assert.equal(noPhoto.callWebhook, false);

  const down = v2.mockupRequestDecision({ webhookConfigured: true, hasPhoto: true, webhookOk: false });
  assert.equal(down.status, 'failed');
  assert.match(down.error, /mockup service/);

  const ok = v2.mockupRequestDecision({ webhookConfigured: true, hasPhoto: true, webhookOk: true });
  assert.equal(ok.status, 'requested');
  assert.equal(ok.ok, true);

  assert.equal(v2.applyMockupUpload({ secretOk: false, leadId: 'x', status: 'ready', hasImage: true }).http, 401);
  assert.equal(v2.applyMockupUpload({ secretOk: true, leadId: '', status: 'ready', hasImage: true }).http, 400);
  assert.deepEqual(
    v2.applyMockupUpload({ secretOk: true, leadId: 'abc', status: 'in_progress' }),
    { http: 200, status: 'in_progress', error: null }
  );
  assert.equal(v2.applyMockupUpload({ secretOk: true, leadId: 'abc', status: 'failed', error: '' }).http, 400);
  const failed = v2.applyMockupUpload({ secretOk: true, leadId: 'abc', status: 'failed', error: 'Photo is too dark' });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'Photo is too dark');
  assert.equal(v2.applyMockupUpload({ secretOk: true, leadId: 'abc', status: 'ready', hasImage: false }).http, 400);
  assert.equal(v2.applyMockupUpload({ secretOk: true, leadId: 'abc', status: 'ready', hasImage: true }).status, 'ready');
  assert.equal(v2.retryMockup('failed').status, 'requested');
  assert.equal(v2.retryMockup('in_progress').ok, false);
  assert.equal(v2.mockupStatusLabel('ready'), 'Mockup ready');
  assert.equal(v2.mockupStatusLabel('failed'), "Couldn't make");
  assert.equal(v2.MOCKUP_STYLE, 'warm-white individual pinpoint lights, evenly spaced about every 12 inches along the eaves and roofline, never a continuous strip');
  const unknown = v2.applyMockupUpload({ secretOk: true, leadId: 'abc', status: 'done', hasImage: true });
  assert.equal(unknown.http, 400);
  assert.notEqual(unknown.status, 'ready');
  assert.equal(v2.applyMockupUpload({ secretOk: true, leadId: 'abc', hasImage: true }).status, 'ready');
  assert.equal(v2.mockupImageBytes('YQ=='), 1);
  const over = 'A'.repeat(Math.ceil((v2.MOCKUP_IMAGE_MAX_BYTES + 1) / 3) * 4);
  assert.equal(v2.mockupImageTooLarge(over), true);
});

test('mockup Do not text uses the same phone and name checks as a confirmation', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const start = html.indexOf('function leadTextsOff');
  const slice = html.slice(start, start + 320);
  assert.match(slice, /leadSmsSuppressed\(lead, _fuDoNotTextPhones \|\| \{\}\)/);
  assert.match(slice, /fuNameSuppressed\(lead, _fuDoNotTextNames\)/);
  assert.equal(slice.includes("followup_stopped_reason === 'Do not text'"), false);
});

test('unpaid commission is grouped for display without recomputing the amount', () => {
  const jobs = [
    { status: 'sold', commission_amount: 100, commission_paid: false, is_funded: true, install_date: '2026-11-07', pay_push_weeks: 0 },
    { status: 'sold', commission_amount: 50, commission_paid: false, is_funded: false, install_date: '2026-11-10', pay_push_weeks: 0 },
    { status: 'sold', commission_amount: 25, commission_paid: false, is_funded: false, install_date: null },
    { status: 'sold', commission_amount: 999, commission_paid: true, is_funded: true, install_date: '2026-11-07' }
  ];
  const grouped = v2.classifyUnpaid(jobs, '2026-11-12');
  assert.equal(grouped.paysFridayDate, '2026-11-13');
  assert.equal(grouped.paysFriday, 100);
  assert.equal(grouped.waiting, 50);
  assert.equal(grouped.notInstalled, 25);
  const progress = v2.goalProgress(574, 3500);
  assert.equal(progress.goal, 3500);
  assert.equal(progress.pct, 16);
  assert.equal(v2.earnedCommission([
    { status: 'sold', commission_amount: 10.5, is_cancelled: false },
    { status: 'sold', commission_amount: 4, is_cancelled: true },
    { status: 'not_sold', commission_amount: 80 }
  ]), 10.5);
});

test('Text to customer opens Messages and copies the mockup image', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /function textMockup\(/);
  assert.match(html, /new ClipboardItem\(\{ 'image\/png': pngPromise \}\)/);
  assert.match(html, /Image copied, paste it in Messages/);
  assert.match(html, /openSmsComposer\(lead\.customer_phone, text\)/);
  assert.match(html, /onclick="shareMockup\(\)"[^>]*>Share…/);
  assert.match(html, /Did you send the mockup\?/);
  assert.match(html, /sms:' \+ recipient \+ \(body \? sep \+ 'body=' \+ body : ''\)/);
  const off = html.indexOf("if (share.off || share.hold) return;");
  const sms = html.indexOf('openSmsComposer(lead.customer_phone, text)');
  assert.equal(off > 0 && off < sms, true);
});

test('the phone bundle does not contain the Mapbox token or mockup secrets', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.equal(html.includes('MAPBOX_TOKEN'), false);
  assert.equal(html.includes('pk.ey'), false);
  assert.equal(html.includes('MOCKUP_WEBHOOK_URL'), false);
  assert.equal(html.includes('MOCKUP_UPLOAD_SECRET'), false);
  assert.equal(html.includes('MOCKUP_WEBHOOK_KEY'), false);
  assert.equal(html.includes('SUPABASE_SERVICE_ROLE'), false);
});
