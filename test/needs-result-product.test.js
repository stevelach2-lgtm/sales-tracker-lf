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
window.scrollTo = () => {};

const REASONS = [
  { id: 'reason-price', label: 'Price', sort_order: 1 },
  { id: 'reason-noshow', label: 'No show', sort_order: 2 }
];

function makeSb() {
  const updates = [];
  function from(table) {
    const state = { table, action: 'select', payload: null, filters: [] };
    function finish() {
      if (state.action === 'update' || state.action === 'insert') {
        updates.push({ table, action: state.action, payload: state.payload, filters: state.filters.slice() });
        return Promise.resolve({ data: [{ id: 'saved' }], error: null });
      }
      if (table === 'not_sold_reasons') return Promise.resolve({ data: REASONS, error: null });
      const pending = state.filters.some(f => f[1] === 'status' && f[2] === 'pending');
      if (pending && liveAppt) return Promise.resolve({ data: [liveAppt], error: null });
      return Promise.resolve({ data: [], error: null });
    }
    const chain = new Proxy({}, {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop === 'then') return (resolve, reject) => finish().then(resolve, reject);
        if (prop === 'update') return (payload) => { state.action = 'update'; state.payload = payload; return chain; };
        if (prop === 'insert') return (payload) => { state.action = 'insert'; state.payload = payload; return chain; };
        if (prop === 'eq') return (col, val) => { state.filters.push(['eq', col, val]); return chain; };
        return () => chain;
      }
    });
    return chain;
  }
  return { from, updates, auth: { getSession: async () => ({ data: { session: null }, error: null }) } };
}

let liveAppt = null;

function appt(overrides) {
  return Object.assign({
    id: 'appt-needs',
    status: 'pending',
    product: 'roofline',
    customer_name: 'Pat Miles',
    customer_phone: '8565550144',
    customer_address: '88 Main St, Medford, NJ',
    appointment_at: '2026-11-01T20:00:00.000Z',
    notes: 'Gate code 4'
  }, overrides);
}

async function showNeedsResult(row) {
  liveAppt = row;
  const sb = makeSb();
  window.sb = sb;
  window.scheduleMileageRecalc = () => {};
  window.saveLocationForLead = () => {};
  await window.loadReasons();
  await window.loadAppointments();
  return sb;
}

function card() {
  return document.getElementById('dashNeedsResult');
}

function visibleQuestion(panelId) {
  const panel = document.getElementById(panelId);
  assert.notEqual(panel.style.display, 'none');
  const question = panel.querySelector('.result-product-q');
  assert.match(question.textContent, /Which product was this\?/);
  return panel;
}

test('Needs result Sold opens the sale form on the appointment product and saves a switch to LeafFilter', async () => {
  const sb = await showNeedsResult(appt());
  const htmlCard = card().innerHTML;
  assert.match(htmlCard, /Needs result \(1\)/);
  assert.match(htmlCard, /resultAppointment\('appt-needs','sold'\)/);

  window.resultAppointment('appt-needs', 'sold');

  const panel = visibleQuestion('ccSoldPanel');
  assert.equal(panel.querySelector('.result-flow-ltg').classList.contains('active'), true);
  assert.equal(panel.querySelector('.result-flow-lf').classList.contains('active'), false);
  assert.equal(document.getElementById('qcProdBtnRoofline').classList.contains('active'), true);

  window.setResultProduct('leaffilter');
  document.getElementById('qc_0').value = '100';
  document.getElementById('qcSoldAt').value = '4000';
  document.getElementById('jobNum').value = '441';
  window.calcQuote();
  await window.submitLeadFromCalc('sold');

  assert.equal(sb.updates.length, 1);
  const saved = sb.updates[0].payload;
  assert.equal(saved.status, 'sold');
  assert.equal(saved.product, 'leaffilter');
  assert.equal(saved.sale_amount, 4000);
  assert.equal(saved.job_number, '441');
  assert.equal(saved.customer_name, 'Pat Miles');
});

test('Needs result No sale opens the not-sold form with the product choice and saves Lighting', async () => {
  const sb = await showNeedsResult(appt({ id: 'appt-ns', product: 'leaffilter', customer_name: 'Sam Blank' }));
  assert.match(card().innerHTML, /resultAppointment\('appt-ns','not_sold'\)/);

  window.resultAppointment('appt-ns', 'not_sold');

  const panel = visibleQuestion('ccNotPanel');
  assert.equal(document.getElementById('ccSoldPanel').style.display, 'none');
  assert.equal(panel.querySelector('.result-flow-lf').classList.contains('active'), true);
  assert.equal(panel.querySelector('.result-flow-ltg').classList.contains('active'), false);

  window.setResultProduct('roofline');
  assert.equal(panel.querySelector('.result-flow-ltg').classList.contains('active'), true);
  window.selCcR('reason-price');
  document.getElementById('ccNotLeftAt').value = '2800';
  document.getElementById('ccNotFuName').value = 'Sam Blank';
  document.getElementById('ccNotFuPhone').value = '8565550144';
  document.getElementById('ccNotNotes').value = 'wants lighting later';
  await window.submitLeadFromCalc('not_sold');

  assert.equal(sb.updates.length, 1);
  const saved = sb.updates[0].payload;
  assert.equal(saved.status, 'not_sold');
  assert.equal(saved.product, 'roofline');
  assert.equal(saved.sale_amount, 2800);
  assert.equal(saved.reason_id, 'reason-price');
  assert.match(saved.notes, /wants lighting later/);
  assert.equal(saved.customer_name, 'Sam Blank');
});

test('Needs result No show opens the drive prompt on the appointment product and saves the choice', async () => {
  const sb = await showNeedsResult(appt({ id: 'appt-show', product: 'roofline' }));
  assert.match(card().innerHTML, /resultAppointment\('appt-show','noshow'\)/);

  window.resultAppointment('appt-show', 'noshow');

  const overlay = document.getElementById('driveQuestionOverlay');
  assert.equal(overlay.style.display, 'flex');
  assert.match(document.getElementById('driveResultProductQ').textContent, /Which product was this\?/);
  assert.equal(document.getElementById('driveProdLtg').classList.contains('active'), true);
  assert.equal(document.getElementById('driveProdLf').classList.contains('active'), false);
  assert.equal(document.getElementById('driveQuestionName').textContent, 'Pat Miles');

  window.setDriveProduct('leaffilter');
  document.getElementById('driveQuestionPhone').value = '8565550144';
  await window.confirmDriveQuestion(true);

  assert.equal(sb.updates.length, 1);
  const saved = sb.updates[0].payload;
  assert.equal(saved.status, 'not_sold');
  assert.equal(saved.product, 'leaffilter');
  assert.equal(saved.drove_there, true);
  assert.match(saved.notes, /No show/);
  assert.match(saved.notes, /Gate code 4/);
  assert.equal(saved.customer_phone, '8565550144');
});
