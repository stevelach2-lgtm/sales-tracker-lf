const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { before, describe, test } = require('node:test');
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
window.V2 = require('../lib/v2-logic.js');
window._v2Preview = true;

const ON_MY_WAY = "Hi [First name], this is Steve with LeafFilter. I'm on my way and should be there in about [minutes] minutes. See you soon!";
const RUNNING_LATE = "Hi [First name], this is Steve with LeafFilter. I'm running a little behind and will be there in about [minutes] minutes. Sorry for the wait, see you soon!";

function makeSb(handlers) {
  const sentTouches = handlers.sentTouches;
  const inserts = handlers.inserts;
  const updates = handlers.updates;
  function from(table) {
    const state = { table, action: 'select', payload: null, filters: [] };
    function finish() {
      if (state.action === 'insert') {
        inserts.push({ table, payload: state.payload });
        if (table === 'followup_touches' && state.payload) sentTouches.push(state.payload);
        return Promise.resolve({ data: null, error: null });
      }
      if (state.action === 'update') {
        updates.push({ table, payload: state.payload, filters: state.filters.slice() });
        return Promise.resolve({ data: null, error: null });
      }
      if (table === 'followup_touches') return Promise.resolve({ data: sentTouches.slice(), error: null });
      if (table === 'leads') return Promise.resolve({ data: handlers.appointments.slice(), error: null });
      return Promise.resolve({ data: [], error: null });
    }
    const chain = new Proxy({}, {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop === 'then') return (resolve, reject) => finish().then(resolve, reject);
        if (prop === 'insert') return (payload) => { state.action = 'insert'; state.payload = payload; return chain; };
        if (prop === 'update') return (payload) => { state.action = 'update'; state.payload = payload; return chain; };
        if (prop === 'select') return () => chain;
        if (prop === 'eq') return (col, val) => { state.filters.push([col, val]); return chain; };
        return () => chain;
      }
    });
    return chain;
  }
  return {
    from,
    auth: { getSession: async () => ({ data: { session: null }, error: null }) }
  };
}

function lead(id, hm, extra) {
  const today = window.todayEtKey();
  return Object.assign({
    id: id,
    status: 'pending',
    customer_name: 'Joan Connor',
    customer_phone: '(215) 362-4042',
    customer_address: '12 Oak Street, Doylestown, PA',
    appointment_at: window.etLocalInputToIso(today + 'T' + hm),
    product: null,
    is_cancelled: false,
    followup_stopped_reason: null,
    mockup_status: null
  }, extra);
}

async function loadDay(appointments, sentTouches, handlers) {
  const inserts = [];
  const updates = [];
  const touches = sentTouches || [];
  window.sb = makeSb({ appointments, sentTouches: touches, inserts, updates });
  window.smsWindowOpen = () => true;
  const opened = [];
  const copied = [];
  window.openSmsComposer = (phone, msg) => { opened.push({ phone, msg }); };
  const nav = window.navigator;
  if (!nav.clipboard) {
    Object.defineProperty(nav, 'clipboard', { configurable: true, value: {} });
  }
  nav.clipboard.writeText = (msg) => { copied.push(msg); return Promise.resolve(); };
  await window.loadAppointments();
  return { inserts, updates, opened, copied, touches };
}

function restRow(id) {
  return document.querySelector('#dashRestToday [data-rest-id="' + id + '"]');
}

function freezeAt10amEt() {
  const today = window.todayEtKey();
  const iso = window.etLocalInputToIso(today + 'T10:00');
  const fixed = new Date(iso).getTime();
  const RealDate = window.Date;
  function FrozenDate(...args) {
    if (args.length === 0) return new RealDate(fixed);
    return new RealDate(...args);
  }
  FrozenDate.now = () => fixed;
  FrozenDate.UTC = RealDate.UTC;
  FrozenDate.parse = RealDate.parse;
  FrozenDate.prototype = RealDate.prototype;
  window.Date = FrozenDate;
}

describe('text any of today\'s pending appointments', { concurrency: false }, () => {
  before(() => {
    freezeAt10amEt();
  });

  test('travel templates use the first name and minutes and stay in the template store', () => {
    const defaults = window.defaultFuTemplates();
    assert.equal(defaults.confirm.on_my_way, ON_MY_WAY);
    assert.equal(defaults.confirm.running_late, RUNNING_LATE);
    assert.equal(typeof window.fillApptTravel, 'function');

    const joan = { customer_name: 'Joan Connor', product: null };
    assert.equal(
      window.fillApptTravel(ON_MY_WAY, joan, 15),
      "Hi Joan, this is Steve with LeafFilter. I'm on my way and should be there in about 15 minutes. See you soon!"
    );
    assert.equal(
      window.fillApptTravel(RUNNING_LATE, { customer_name: 'Mr. and Mrs. Pat Smith', product: 'roofline' }, 30),
      "Hi Pat, this is Steve with LeafFilter. I'm running a little behind and will be there in about 30 minutes. Sorry for the wait, see you soon!"
    );
    const blank = window.fillApptTravel(ON_MY_WAY, { customer_name: '', product: null }, 10);
    assert.equal(blank.includes('[First name]'), false);
    assert.equal(blank.includes('[minutes]'), false);
    assert.equal(blank.includes('gutter'), false);
    assert.equal(blank.includes('roofline'), false);

    const merged = window.mergeFuTemplates(defaults, {
      confirm: {
        appt_confirm: 'Custom confirm',
        on_my_way: 'Way [First name] [minutes]',
        running_late: 'Late [First name] [minutes]'
      }
    });
    assert.equal(merged.confirm.appt_confirm, 'Custom confirm');
    assert.equal(merged.confirm.on_my_way, 'Way [First name] [minutes]');
    assert.equal(merged.confirm.running_late, 'Late [First name] [minutes]');
    assert.equal(merged.price.leaffilter.day2, defaults.price.leaffilter.day2);

    const partial = window.mergeFuTemplates(defaults, { confirm: { appt_confirm: 'Only confirm' } });
    assert.equal(partial.confirm.appt_confirm, 'Only confirm');
    assert.equal(partial.confirm.on_my_way, ON_MY_WAY);
    assert.equal(partial.confirm.running_late, RUNNING_LATE);

    const legacy = window.mergeFuTemplates(defaults, { confirm: 'Legacy confirm text' });
    assert.equal(legacy.confirm.appt_confirm, 'Legacy confirm text');
    assert.equal(legacy.confirm.on_my_way, ON_MY_WAY);
    assert.equal(legacy.confirm.running_late, RUNNING_LATE);
  });

  test('rest of today shows the first name, mockup badge, and a Text button while an earlier lead is still unresulted', async () => {
    const appointments = [
      lead('earlier', '08:00', { customer_name: 'Earlier Unresulted', customer_phone: '5555550101', product: 'leaffilter' }),
      lead('nextone', '11:00', { customer_name: 'Next Person', customer_phone: '5555550111', product: null }),
      lead('joan', '15:00', { customer_name: 'Joan Connor', mockup_status: 'ready', product: null }),
      lead('pat', '16:00', { customer_name: 'Mr. Pat Smith', product: 'roofline', mockup_status: 'in_progress' }),
      lead('initial', '17:00', { customer_name: 'A', customer_phone: '5555550144' }),
      lead('nophone', '18:00', { customer_name: 'Nophone Jones', customer_phone: '' }),
      lead('short', '18:30', { customer_name: 'Short Phone', customer_phone: '555123' }),
      lead('dnt', '19:00', { customer_name: 'Donot Text', customer_phone: '5555550199', followup_stopped_reason: 'Do not text' }),
      lead('cancelled', '19:30', { customer_name: 'Carol Cancelled', customer_phone: '5555550188', is_cancelled: true })
    ];
    await loadDay(appointments, []);

    const next = document.getElementById('dashNextUp');
    assert.match(next.textContent, /Next Person/);
    const nextText = next.querySelector('[data-appt-text="open"]');
    assert.equal(nextText.textContent.trim(), 'Text');
    assert.match(nextText.getAttribute('onclick') || '', /openApptTextChooser\('nextone'\)/);
    assert.equal(next.querySelector('[onclick*="textAppointmentConfirm"]'), null);
    assert.equal(nextText.classList.contains('appt-action'), true);
    const earlier = restRow('earlier');
    assert.ok(earlier);
    assert.match(earlier.textContent, /Earlier/);
    assert.ok(earlier.querySelector('[data-appt-text="open"]'));

    const joan = restRow('joan');
    assert.ok(joan);
    assert.match(joan.textContent, /Joan/);
    assert.equal(joan.textContent.includes('Connor'), false);
    assert.match(joan.textContent, /3:00 PM|15/);
    const badge = joan.querySelector('button.v2-badge');
    assert.ok(badge);
    assert.match(badge.getAttribute('onclick') || '', /openMockupFromLead\('joan'\)/);
    assert.match(badge.textContent, /Mockup ready/);
    const joanText = joan.querySelector('[data-appt-text="open"]');
    assert.equal(joanText.textContent.trim(), 'Text');
    assert.match(joanText.getAttribute('onclick') || '', /openApptTextChooser\('joan'\)/);
    assert.equal(joanText.classList.contains('appt-action'), true);

    const pat = restRow('pat');
    assert.match(pat.textContent, /Pat/);
    assert.ok(pat.querySelector('[data-appt-text="open"]'));
    assert.match(pat.textContent, /Working on it|in progress|Mockup/i);

    const initial = restRow('initial');
    assert.equal(initial.querySelector('.rest-today-name').textContent, 'A');
    assert.ok(initial.querySelector('[data-appt-text="open"]'));

    assert.equal(restRow('nophone').querySelector('[data-appt-text="open"]'), null);
    assert.match(restRow('nophone').textContent, /Nophone/);
    assert.equal(restRow('short').querySelector('[data-appt-text="open"]'), null);
    assert.match(restRow('short').textContent, /Short/);
    assert.equal(restRow('dnt').querySelector('[data-appt-text="open"]'), null);
    assert.match(restRow('dnt').textContent, /Donot/);
    assert.equal(restRow('cancelled').querySelector('[data-appt-text="open"]'), null);
    assert.match(restRow('cancelled').textContent, /Carol/);

    const raw = fs.readFileSync(htmlPath, 'utf8');
    assert.match(raw, /#dashApptCard \{[^}]*clip-path:\s*inset\(50%\)/);
    assert.equal(raw.includes("if (row.plan.group === 'confirm') return false;"), true);
    assert.equal(document.getElementById('dashTextToday').textContent.includes('On my way'), false);
    assert.equal(document.getElementById('apptList').querySelector('[data-appt-text="open"]'), null);
  });

  test('On my way and Running late ask for minutes and open Messages without logging a confirmation', async () => {
    const appointments = [
      lead('earlier', '08:00', { customer_name: 'Earlier Unresulted', customer_phone: '5555550101', product: 'leaffilter' }),
      lead('nextone', '11:00', { customer_name: 'Next Person', customer_phone: '5555550111', product: null }),
      lead('joan', '15:00', { customer_name: 'Joan Connor', product: null })
    ];
    const ctx = await loadDay(appointments, []);
    const joan = restRow('joan');
    joan.querySelector('[data-appt-text="open"]').click();
    const sheet = document.getElementById('apptTextSheet');
    assert.ok(sheet);
    assert.equal(sheet.querySelector('[data-appt-text="on-my-way"]').textContent.trim(), 'On my way');
    assert.equal(sheet.querySelector('[data-appt-text="running-late"]').textContent.trim(), 'Running late');
    assert.equal(sheet.querySelector('[data-appt-text="confirm"]').textContent.trim(), 'Confirm');
    ['on-my-way', 'running-late', 'confirm'].forEach(key => {
      assert.equal(sheet.querySelector('[data-appt-text="' + key + '"]').classList.contains('appt-action'), true);
    });

    sheet.querySelector('[data-appt-text="on-my-way"]').click();
    assert.equal(document.querySelector('[data-appt-minutes="15"]').getAttribute('data-selected'), 'true');
    [10, 15, 20, 30].forEach(n => {
      assert.ok(document.querySelector('[data-appt-minutes="' + n + '"]'));
      assert.equal(document.querySelector('[data-appt-minutes="' + n + '"]').classList.contains('appt-action'), true);
    });
    document.querySelector('[data-appt-text="send"]').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(ctx.opened.length, 1);
    assert.equal(ctx.opened[0].phone.replace(/\D/g, '').endsWith('2153624042'), true);
    assert.equal(
      ctx.opened[0].msg,
      "Hi Joan, this is Steve with LeafFilter. I'm on my way and should be there in about 15 minutes. See you soon!"
    );
    assert.equal(ctx.inserts.length, 0);
    assert.equal(ctx.updates.length, 0);
    assert.equal(ctx.opened[0].msg.includes('[Product]'), false);

    restRow('joan').querySelector('[data-appt-text="open"]').click();
    document.getElementById('apptTextSheet').querySelector('[data-appt-text="running-late"]').click();
    document.querySelector('[data-appt-minutes="20"]').click();
    assert.equal(document.querySelector('[data-appt-minutes="20"]').getAttribute('data-selected'), 'true');
    document.querySelector('[data-appt-text="send"]').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(ctx.opened.length, 2);
    assert.equal(
      ctx.opened[1].msg,
      "Hi Joan, this is Steve with LeafFilter. I'm running a little behind and will be there in about 20 minutes. Sorry for the wait, see you soon!"
    );
    assert.equal(ctx.inserts.length, 0);
    assert.equal(ctx.updates.length, 0);
  });

  test('Confirm still logs appt_confirm, and a sent confirmation stays disabled while the other texts work', async () => {
    const appointments = [
      lead('earlier', '08:00', { customer_name: 'Earlier Unresulted', customer_phone: '5555550101' }),
      lead('nextone', '11:00', { customer_name: 'Next Person', customer_phone: '5555550111' }),
      lead('joan', '15:00', { customer_name: 'Joan Connor', product: null }),
      lead('sent', '16:00', { customer_name: 'Sam Sent', customer_phone: '5555550177', product: 'roofline' })
    ];
    const ctx = await loadDay(appointments, [{ lead_id: 'sent', step_key: 'appt_confirm', step_num: 1 }]);

    restRow('joan').querySelector('[data-appt-text="open"]').click();
    document.querySelector('[data-appt-text="confirm"]').click();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(ctx.inserts.length, 1);
    assert.equal(ctx.inserts[0].table, 'followup_touches');
    assert.equal(ctx.inserts[0].payload.lead_id, 'joan');
    assert.equal(ctx.inserts[0].payload.step_key, 'appt_confirm');
    assert.equal(ctx.updates.filter(u => u.table === 'leads').length, 0);
    assert.equal(ctx.opened.length, 1);
    assert.match(ctx.opened[0].msg, /confirming your appointment/);
    assert.equal(ctx.opened[0].msg.includes('[Product]'), false);
    assert.equal(ctx.opened[0].msg.includes('gutter'), false);

    const sent = restRow('sent');
    sent.querySelector('[data-appt-text="open"]').click();
    const sentBtn = document.querySelector('[data-appt-text="confirm-sent"]');
    assert.equal(sentBtn.textContent.trim(), 'Confirm sent ✓');
    assert.equal(sentBtn.disabled, true);
    assert.equal(document.querySelector('[data-appt-text="confirm"]'), null);
    sentBtn.click();
    document.querySelector('[data-appt-text="on-my-way"]').click();
    document.querySelector('[data-appt-text="send"]').click();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(ctx.inserts.length, 1);
    assert.equal(ctx.opened.length, 2);
    assert.match(ctx.opened[1].msg, /on my way/);
    assert.match(ctx.opened[1].msg, /Sam/);
  });

  test('outside 8 AM to 9 PM the message is copied and the lead is left alone', async () => {
    const appointments = [
      lead('earlier', '08:00', { customer_name: 'Earlier Unresulted', customer_phone: '5555550101' }),
      lead('nextone', '11:00', { customer_name: 'Next Person', customer_phone: '5555550111' }),
      lead('joan-hold', '15:00', { customer_name: 'Joan Connor', product: 'leaffilter' })
    ];
    const ctx = await loadDay(appointments, []);
    window.smsWindowOpen = () => false;

    restRow('joan-hold').querySelector('[data-appt-text="open"]').click();
    document.querySelector('[data-appt-text="running-late"]').click();
    document.querySelector('[data-appt-minutes="10"]').click();
    document.querySelector('[data-appt-text="send"]').click();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(ctx.opened.length, 0);
    assert.equal(ctx.copied.length, 1);
    assert.match(ctx.copied[0], /about 10 minutes/);
    assert.equal(ctx.inserts.length, 0);
    assert.equal(ctx.updates.length, 0);

    restRow('joan-hold').querySelector('[data-appt-text="open"]').click();
    document.querySelector('[data-appt-text="confirm"]').click();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(ctx.opened.length, 0);
    assert.equal(ctx.inserts.length, 0);
    assert.ok(ctx.copied.some(msg => /confirming your/.test(msg)));
  });

  test('On my way and Running late are editable next to the confirmation template', async () => {
    window.renderFuTemplateEditor();
    const way = document.getElementById('fuOnMyWayTemplate');
    const late = document.getElementById('fuRunningLateTemplate');
    const confirm = document.getElementById('fuConfirmTemplate');
    assert.ok(way);
    assert.ok(late);
    assert.equal(way.value, ON_MY_WAY);
    assert.equal(late.value, RUNNING_LATE);
    assert.ok(confirm);
    way.value = 'Way [First name] [minutes]';
    way.dispatchEvent(new window.Event('input'));
    late.value = 'Late [First name] [minutes]';
    late.dispatchEvent(new window.Event('input'));
    await window.saveFuTemplates();
    window.renderFuTemplateEditor();
    assert.equal(document.getElementById('fuOnMyWayTemplate').value, 'Way [First name] [minutes]');
    assert.equal(document.getElementById('fuRunningLateTemplate').value, 'Late [First name] [minutes]');

    const appointments = [
      lead('earlier', '08:00', { customer_name: 'Earlier Unresulted', customer_phone: '5555550101' }),
      lead('nextone', '11:00', { customer_name: 'Next Person', customer_phone: '5555550111' }),
      lead('joan', '15:00', { customer_name: 'Joan Connor', product: null })
    ];
    const ctx = await loadDay(appointments, []);
    window.smsWindowOpen = () => true;
    restRow('joan').querySelector('[data-appt-text="open"]').click();
    document.querySelector('[data-appt-text="on-my-way"]').click();
    document.querySelector('[data-appt-minutes="10"]').click();
    document.querySelector('[data-appt-text="send"]').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(ctx.opened[0].msg, 'Way Joan 10');
  });
});
