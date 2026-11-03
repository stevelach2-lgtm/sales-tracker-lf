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

function makeSb(handlers) {
  const sentTouches = handlers.sentTouches;
  const inserts = handlers.inserts;
  function from(table) {
    const state = { table, action: 'select', payload: null, filters: [] };
    function finish() {
      if (state.action === 'insert') {
        inserts.push({ table, payload: state.payload });
        if (table === 'followup_touches' && state.payload) sentTouches.push(state.payload);
        return Promise.resolve({ data: null, error: null });
      }
      if (state.action === 'update') return Promise.resolve({ data: null, error: null });
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

test('dashboard Upcoming puts a confirmation Text button under Quote', async () => {
  const today = window.todayEtKey();
  const at = (day, hm) => window.etLocalInputToIso(day + 'T' + hm);
  const appointments = [
    {
      id: 'joan',
      status: 'pending',
      customer_name: 'Joan Connor',
      customer_phone: '(215) 362-4042',
      customer_address: '12 Oak Street, Doylestown, PA',
      appointment_at: at(today, '11:00'),
      product: 'leaffilter',
      is_cancelled: false,
      followup_stopped_reason: null
    },
    {
      id: 'nophone',
      status: 'pending',
      customer_name: 'No Phone',
      customer_phone: '',
      customer_address: '1 Blank St',
      appointment_at: at(today, '12:00'),
      product: null,
      is_cancelled: false
    },
    {
      id: 'dnt',
      status: 'pending',
      customer_name: 'Do Not Text',
      customer_phone: '5555550199',
      customer_address: '2 Stop St',
      appointment_at: at(today, '13:00'),
      product: 'leaffilter',
      is_cancelled: false,
      followup_stopped_reason: 'Do not text'
    },
    {
      id: 'tomorrow',
      status: 'pending',
      customer_name: 'Catharina Schimert',
      customer_phone: '6098823229',
      customer_address: '9 Pine Road, Trenton, NJ',
      appointment_at: at(window.fuAddDays(today, 1), '09:00'),
      product: 'roofline',
      is_cancelled: false
    },
    {
      id: 'later',
      status: 'pending',
      customer_name: 'Next Week',
      customer_phone: '5555550188',
      customer_address: '3 Later St',
      appointment_at: at(window.fuAddDays(today, 3), '09:00'),
      product: null,
      is_cancelled: false
    },
    {
      id: 'sent',
      status: 'pending',
      customer_name: 'Already Sent',
      customer_phone: '5555550177',
      customer_address: '4 Sent St',
      appointment_at: at(today, '15:00'),
      product: 'leaffilter',
      is_cancelled: false
    }
  ];
  const sentTouches = [{ lead_id: 'sent', step_key: 'appt_confirm', step_num: 1 }];
  const inserts = [];
  window.sb = makeSb({ appointments, sentTouches, inserts });
  window.smsWindowOpen = () => true;
  const opened = [];
  window.openSmsComposer = (phone, msg) => { opened.push({ phone, msg }); };

  await window.loadAppointments();

  const card = document.getElementById('dashApptCard');
  assert.equal(card.style.display, 'block');
  const row = (id) => card.querySelector('button[onclick*="' + id + '"]')
    ? card.querySelector('button[onclick*="startAppointment(\'' + id + '\')"]').parentElement.parentElement
    : null;
  const joan = row('joan');
  const quote = joan.querySelector('button[onclick*="startAppointment"]');
  const text = joan.querySelector('[data-confirm-action="text"]');
  assert.equal(quote.textContent, 'Quote');
  assert.equal(text.textContent, 'Text');
  assert.equal(quote.parentElement, text.parentElement);
  assert.equal(quote.nextElementSibling, text);
  assert.equal(row('nophone').querySelector('[data-confirm-action]'), null);
  assert.equal(row('dnt').querySelector('[data-confirm-action]'), null);
  assert.equal(row('later').querySelector('[data-confirm-action]'), null);
  assert.equal(row('tomorrow').querySelector('[data-confirm-action="text"]').textContent, 'Text');
  assert.equal(row('sent').querySelector('[data-confirm-action="sent"]').textContent, 'Sent ✓');
  assert.equal(row('sent').querySelector('[data-confirm-action="text"]'), null);
  assert.equal(document.getElementById('apptList').querySelector('[data-confirm-action]'), null);

  await window.textAppointmentConfirm('joan');
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].table, 'followup_touches');
  assert.equal(inserts[0].payload.lead_id, 'joan');
  assert.equal(inserts[0].payload.step_key, 'appt_confirm');
  assert.equal(inserts[0].payload.step_num, 1);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].phone.replace(/\D/g, '').endsWith('2153624042'), true);
  assert.match(opened[0].msg, /LeafFilter gutter guard/);
  assert.match(opened[0].msg, /today at 11:00 AM/);
  assert.match(opened[0].msg, /12 Oak Street/);
  assert.equal(opened[0].msg.includes('[Product]'), false);
  assert.equal(row('joan').querySelector('[data-confirm-action="sent"]').textContent, 'Sent ✓');
  assert.equal(row('joan').querySelector('[data-confirm-action="text"]'), null);
  assert.equal(row('tomorrow').querySelector('[data-confirm-action="text"]').textContent, 'Text');
});
