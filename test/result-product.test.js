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

function makeSb(onSelect) {
  const updates = [];
  function from(table) {
    const state = { table, action: 'select', payload: null, filters: [], single: false };
    function finish() {
      if (state.action === 'update' || state.action === 'insert') {
        updates.push({ table, action: state.action, payload: state.payload, filters: state.filters.slice() });
        const id = (state.filters.find(f => f[1] === 'id') || [])[2] || 'new-row';
        const row = { id };
        return Promise.resolve({ data: state.single ? row : [row], error: null });
      }
      if (onSelect) return Promise.resolve(onSelect(state));
      return Promise.resolve({ data: state.single ? null : [], error: null });
    }
    const chain = new Proxy({}, {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop === 'then') return (resolve, reject) => finish().then(resolve, reject);
        if (prop === 'single' || prop === 'maybeSingle') return () => { state.single = true; return finish(); };
        if (prop === 'update') return (payload) => { state.action = 'update'; state.payload = payload; return chain; };
        if (prop === 'insert') return (payload) => { state.action = 'insert'; state.payload = payload; return chain; };
        if (prop === 'delete') return () => { state.action = 'delete'; return chain; };
        if (prop === 'select') return () => chain;
        if (prop === 'eq') return (col, val) => { state.filters.push(['eq', col, val]); return chain; };
        return () => chain;
      }
    });
    return chain;
  }
  return {
    from,
    updates,
    auth: { getSession: async () => ({ data: { session: null }, error: null }) }
  };
}

function money(id) {
  return parseFloat(document.getElementById(id).textContent.replace(/[$,]/g, '')) || 0;
}

function resultChoice(which) {
  const on = Array.from(document.querySelectorAll('.result-flow-' + which)).filter(btn => btn.classList.contains('active'));
  const off = Array.from(document.querySelectorAll('.result-flow-' + which)).filter(btn => !btn.classList.contains('active'));
  return { on: on.length, off: off.length, total: on.length + off.length };
}

let liveAppt = null;

function installSb() {
  const sb = makeSb(state => {
    if (state.table === 'not_sold_reasons') {
      return { data: [{ id: 'reason-price', label: 'Price', sort_order: 1 }, { id: 'reason-noshow', label: 'No show', sort_order: 2 }], error: null };
    }
    const pending = state.filters.some(f => f[1] === 'status' && f[2] === 'pending');
    if (pending && liveAppt) return { data: [liveAppt], error: null };
    return { data: [], error: null };
  });
  window.sb = sb;
  window.saveLocationForLead = () => {};
  window.scheduleMileageRecalc = () => {};
  return sb;
}

async function openAppt(appt) {
  liveAppt = appt;
  window.sb = null;
  window.startAppointment(appt);
  const sb = installSb();
  await window.loadAppointments();
  await window.loadReasons();
  return sb;
}

test('sale, no sale, and no show each ask which product with two choices', () => {
  const questions = Array.from(document.querySelectorAll('.result-product-q')).map(el => el.textContent.replace(/\s+/g, ' ').trim());
  assert.equal(questions.length, 3);
  questions.forEach(text => assert.match(text, /Which product was this\?/));
  assert.equal(document.querySelectorAll('#ccSoldPanel .result-flow-lf').length, 1);
  assert.equal(document.querySelectorAll('#ccSoldPanel .result-flow-ltg').length, 1);
  assert.equal(document.querySelectorAll('#ccNotPanel .result-flow-lf').length, 1);
  assert.equal(document.querySelectorAll('#ccNotPanel .result-flow-ltg').length, 1);
  assert.equal(document.getElementById('driveProdLf').textContent, 'LeafFilter');
  assert.equal(document.getElementById('driveProdLtg').textContent, 'Lighting');
  document.querySelectorAll('.result-product [role="radiogroup"]').forEach(group => {
    assert.equal(group.querySelectorAll('[role="radio"]').length, 2);
  });
});

test('a lighting appointment opens preselected to Lighting, and a blank one to LeafFilter', async () => {
  await openAppt({
    id: 'appt-ltg',
    status: 'pending',
    product: 'roofline',
    customer_name: 'Jo Miles',
    customer_phone: '5552223333',
    customer_address: '9 Oak St',
    appointment_at: '2026-11-12T16:00:00.000Z'
  });
  assert.equal(resultChoice('ltg').on, 2);
  assert.equal(resultChoice('lf').on, 0);
  assert.equal(document.getElementById('qcProdBtnRoofline').classList.contains('active'), true);
  assert.match(document.getElementById('qcItems').textContent, /Installed Lighting/);
  assert.equal(document.getElementById('jobNumLtgHint').style.display, 'inline');

  await openAppt({
    id: 'appt-blank',
    status: 'pending',
    product: null,
    customer_name: 'Sam Blank',
    customer_phone: '5553334444',
    customer_address: '2 Pine St',
    appointment_at: '2026-11-12T18:00:00.000Z'
  });
  assert.equal(resultChoice('lf').on, 2);
  assert.equal(resultChoice('ltg').on, 0);
  assert.equal(document.getElementById('qcProdBtnLeaffilter').classList.contains('active'), true);
  assert.match(document.getElementById('qcItems').textContent, /1st Floor/);
});

test('confirming a preselected Lighting sale saves that product and the sold fields', async () => {
  const sb = await openAppt({
    id: 'appt-confirm',
    status: 'pending',
    product: 'roofline',
    customer_name: 'Jo Miles',
    customer_phone: '5552223333',
    customer_address: '9 Oak St',
    appointment_at: '2026-11-12T16:00:00.000Z',
    lead_id: 'L-9'
  });
  document.getElementById('qc_0').value = '100';
  document.getElementById('qcSoldAt').value = '6000';
  document.getElementById('jobNum').value = '88421';
  document.getElementById('installDate').value = '2026-11-20';
  document.getElementById('soldNotes').value = 'financing used';
  window.calcQuote();
  const commission = money('qcComm');
  assert.ok(commission > 0);

  await window.submitLeadFromCalc('sold');

  assert.equal(sb.updates.length, 1);
  const saved = sb.updates[0].payload;
  assert.equal(saved.status, 'sold');
  assert.equal(saved.product, 'roofline');
  assert.equal(saved.sale_amount, 6000);
  assert.equal(saved.job_number, '88421 LTG');
  assert.equal(saved.install_date, '2026-11-20');
  assert.equal(saved.notes, 'financing used');
  assert.equal(saved.customer_name, 'Jo Miles');
  assert.equal(saved.commission_amount, commission);
  assert.deepEqual(sb.updates[0].filters.filter(f => f[1] === 'id' || f[1] === 'status'), [
    ['eq', 'id', 'appt-confirm'],
    ['eq', 'status', 'pending']
  ]);
  const lightingText = window.fuTemplateText('price', saved.product, 'day2');
  assert.match(lightingText, /roofline lighting/);
  assert.equal(window.fuProductLabel(saved.product), 'permanent lighting');
});

test('switching the result choice keeps the quote and sold fields and saves Lighting', async () => {
  window.localStorage.setItem('cc_overage_pct_leaffilter', '20');
  window.localStorage.setItem('cc_overage_pct_roofline', '10');
  window.localStorage.setItem('cc_admin_in_opening', 'true');
  const sb = await openAppt({
    id: 'appt-switch',
    status: 'pending',
    product: 'leaffilter',
    customer_name: 'Pat Cole',
    customer_phone: '5551112222',
    customer_address: '1 Main St',
    appointment_at: '2026-11-12T15:00:00.000Z'
  });
  document.getElementById('qc_0').value = '100';
  document.getElementById('qcSoldAt').value = '4000';
  document.getElementById('qcFinPlan').value = '';
  window.calcQuote();
  const leafCommission = money('qcComm');
  assert.equal(leafCommission, 395.8);
  document.getElementById('jobNum').value = '555';
  document.getElementById('installDate').value = '2026-12-01';
  document.getElementById('soldNotes').value = 'left the sample';
  document.getElementById('ccNotDontText').checked = true;

  window.setResultProduct('roofline');

  assert.equal(document.getElementById('qc_0').value, '100');
  assert.equal(document.getElementById('jobNum').value, '555');
  assert.equal(document.getElementById('installDate').value, '2026-12-01');
  assert.equal(document.getElementById('soldNotes').value, 'left the sample');
  assert.equal(document.getElementById('qcSoldAt').value, '4000');
  assert.equal(document.getElementById('ccNotDontText').checked, true);
  assert.equal(document.getElementById('soldCustName').value, 'Pat Cole');
  assert.equal(resultChoice('ltg').on, 2);
  assert.match(document.getElementById('qcOpeningPct').textContent, /Lighting overage 10%/);
  const lightingCommission = money('qcComm');
  assert.equal(lightingCommission, window.saleCommission({
    retail: 3900,
    sold: 4000,
    financeRatePct: 0,
    overagePct: 10
  }).total);
  assert.notEqual(lightingCommission, leafCommission);

  await window.submitLeadFromCalc('sold');
  const saved = sb.updates[0].payload;
  assert.equal(saved.product, 'roofline');
  assert.equal(saved.sale_amount, 4000);
  assert.equal(saved.job_number, '555 LTG');
  assert.equal(saved.install_date, '2026-12-01');
  assert.equal(saved.notes, 'left the sample');
  assert.equal(saved.commission_amount, lightingCommission);
  assert.match(window.fuTemplateText('price', saved.product, 'day2'), /roofline lighting/);
});

test('no sale saves the chosen product and still honors Do not text', async () => {
  const sb = await openAppt({
    id: 'appt-ns',
    status: 'pending',
    product: 'leaffilter',
    customer_name: 'Pat Cole',
    customer_phone: '5551112222',
    customer_address: '1 Main St',
    appointment_at: '2026-11-12T15:00:00.000Z'
  });
  window.setResultProduct('roofline');
  window.ccSetOutcome('not_sold');
  window.selCcR('reason-price');
  document.getElementById('ccNotLeftAt').value = '3200';
  document.getElementById('ccNotFuName').value = 'Pat Cole';
  document.getElementById('ccNotFuPhone').value = '5551112222';
  document.getElementById('ccNotNotes').value = 'call back in spring';
  document.getElementById('ccNotDontText').checked = true;

  await window.submitLeadFromCalc('not_sold');

  assert.equal(sb.updates.length, 1);
  const saved = sb.updates[0].payload;
  assert.equal(saved.status, 'not_sold');
  assert.equal(saved.product, 'roofline');
  assert.equal(saved.sale_amount, 3200);
  assert.equal(saved.reason_id, 'reason-price');
  assert.equal(saved.followup_stopped_reason, 'Do not text');
  assert.equal(saved.followup_done, true);
  assert.match(saved.notes, /call back in spring/);
  assert.match(window.fuTemplateText('price', saved.product, 'day2'), /roofline lighting/);
  assert.doesNotMatch(window.fuTemplateText('price', 'leaffilter', 'day2'), /roofline lighting/);
});

test('a sale cannot be saved until LeafFilter or Lighting is selected', async () => {
  const sb = await openAppt({
    id: 'appt-required',
    status: 'pending',
    product: 'leaffilter',
    customer_name: 'Pat Cole',
    customer_phone: '5551112222',
    appointment_at: '2026-11-12T15:00:00.000Z'
  });
  document.getElementById('qcSoldAt').value = '2500';
  document.getElementById('jobNum').value = '42';
  document.getElementById('installDate').value = '2026-11-22';
  document.querySelectorAll('.result-flow-lf, .result-flow-ltg').forEach(btn => btn.classList.remove('active'));

  await window.submitLeadFromCalc('sold');

  assert.equal(sb.updates.length, 0);
  assert.match(document.getElementById('toast').textContent, /Choose LeafFilter or Lighting/);
  assert.equal(document.getElementById('jobNum').value, '42');
  assert.equal(document.getElementById('installDate').value, '2026-11-22');
  assert.equal(document.getElementById('qcSoldAt').value, '2500');
});

test('no show and cancelled-before-arrival save the product chosen on that prompt', async () => {
  const sb = await openAppt({
    id: 'appt-noshow',
    status: 'pending',
    product: 'roofline',
    customer_name: 'Jo Miles',
    customer_phone: '5552223333',
    customer_address: '9 Oak St',
    appointment_at: '2026-11-12T16:00:00.000Z',
    notes: 'Gate code 12'
  });
  window.openDriveQuestion('appt-noshow');
  assert.equal(document.getElementById('driveProdLtg').classList.contains('active'), true);
  assert.equal(document.getElementById('driveProdLf').classList.contains('active'), false);
  assert.equal(document.getElementById('driveQuestionOverlay').style.display, 'flex');
  window.setDriveProduct('leaffilter');
  document.getElementById('driveQuestionPhone').value = '5552223333';
  await window.confirmDriveQuestion(true);

  assert.equal(sb.updates.length, 1);
  const noShow = sb.updates[0].payload;
  assert.equal(noShow.status, 'not_sold');
  assert.equal(noShow.product, 'leaffilter');
  assert.equal(noShow.drove_there, true);
  assert.match(noShow.notes, /No show/);
  assert.match(noShow.notes, /Gate code 12/);
  assert.equal(noShow.customer_phone, '5552223333');

  sb.updates.length = 0;
  liveAppt = {
    id: 'appt-cancel',
    status: 'pending',
    product: 'leaffilter',
    customer_name: 'Sam Blank',
    customer_phone: '5553334444',
    appointment_at: '2026-11-12T18:00:00.000Z',
    notes: ''
  };
  window.sb = null;
  window.startAppointment(liveAppt);
  window.sb = sb;
  await window.loadAppointments();
  window.openDriveQuestion('appt-cancel');
  assert.equal(document.getElementById('driveProdLf').classList.contains('active'), true);
  window.setDriveProduct('roofline');
  await window.confirmDriveQuestion(false);
  const cancelled = sb.updates[0].payload;
  assert.equal(cancelled.status, 'not_sold');
  assert.equal(cancelled.product, 'roofline');
  assert.equal(cancelled.drove_there, false);
  assert.match(cancelled.notes, /Cancelled before arrival/);
  assert.match(window.fuTemplateText('noshow', cancelled.product, 'day1'), /roofline lighting/);
});
