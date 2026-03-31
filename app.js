// ============================================================
// PRICE DATA  (effective 1/18/2026)
// ============================================================
const PRICES = {
  lf: {
    perFoot: {
      '5inch':   { '1st': 39, '2nd': 41, '3rd': 43 },
      '6inch':   { '1st': 40, '2nd': 42, '3rd': 44 },
      'versaMax':{ '1st': 50, '2nd': 50, '3rd': 50 },
    },
    extras: {
      removeProtection: { type: 'perFoot',  rate: 3.00,  label: 'Remove Existing Gutter Protection' },
      mitres:           { type: 'perUnit',  rate: 30.00, label: 'Inside/Outside Mitres' },
      cutShingle:       { type: 'perFoot',  rate: 1.00,  label: 'Cut Under Shingle Hangers' },
      strapsWedges:     { type: 'perFoot',  rate: 3.50,  label: 'Straps/Wedges (Angled Fascia)' },
      extraLabor:       { type: 'perUnit',  rate: 80.00, label: 'Extra Labor' },
      copperGutter:     { type: 'perFoot',  rate: 8.00,  label: 'Copper Gutter Charge (SS hardware)' },
    }
  },
  gut: {
    perFoot: { '5inch': 22, '6inch': 23 },
    adminFee: 500, // NET / non-commissionable
    extras: {
      tileAdapter:        { type: 'perUnit',  rate: 30.00, label: 'Tile Adapters' },
      groundSpout:        { type: 'perUnit',  rate: 50.00, label: 'Ground Spouts' },
      critterGate:        { type: 'perUnit',  rate: 50.00, label: 'CritterGate' },
      cleanSeal:          { type: 'perFoot',  rate: 7.00,  label: 'Clean, Seal & Reinforce' },
      dripEdge:           { type: 'perFoot',  rate: 5.00,  label: 'New Drip Edge/Flashing' },
      fasciaBoards:       { type: 'perFoot',  rate: 25.00, label: 'New Fascia Boards' },
      azekFascia:         { type: 'perFoot',  rate: 40.00, label: 'New AZEK Fascia Boards' },
      wrapFascia:         { type: 'perFoot',  rate: 18.00, label: 'Wrap Fascia w/ Aluminum' },
      soffitAlum:         { type: 'perFoot',  rate: 23.00, label: 'New Soffit — Alum/Vinyl' },
      soffitWood:         { type: 'perFoot',  rate: 39.00, label: 'New Soffit — Wood' },
      sawzallHangers:     { type: 'perFoot',  rate: 1.00,  label: 'Sawzall Hangers' },
      modifyGutterHeight: { type: 'perFoot',  rate: 4.00,  label: 'Modify Gutter Height' },
      cutShingleOverhang: { type: 'perFoot',  rate: 4.00,  label: 'Cut & Remove Shingle Overhang' },
      gutterCorner:       { type: 'perUnit',  rate: 100.00,label: 'Replace Gutter Corner' },
      porchSoffitAlum:    { type: 'perSqFt', rate: 15.00, label: 'Porch Ceiling/Soffit >3ft — Vinyl/Alum' },
      porchSoffitWood:    { type: 'perSqFt', rate: 17.00, label: 'Porch Ceiling/Soffit >3ft — Wood' },
    }
  }
};

// Extras that need a qty input (both types)
const QTY_EXTRAS = {
  lf:  ['mitres','extraLabor'],
  gut: ['tileAdapter','groundSpout','critterGate','gutterCorner','porchSoffitAlum','porchSoffitWood']
};

// ============================================================
// STATE
// ============================================================
const state = {
  jobType: 'lf',
  lf:  { size: '5inch', floor: '1st', linearFeet: 0, extras: {} },
  gut: { size: '5inch',             linearFeet: 0, extras: {} },
  settings: { commissionRate: 10, commissionType: 'full' }
};

// ============================================================
// INIT
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  renderHistory();
});

// ============================================================
// PAGE / TAB NAVIGATION
// ============================================================
function switchPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.getElementById('nav-' + page).classList.add('active');
  if (page === 'history') renderHistory();
}

function switchJobType(type) {
  state.jobType = type;
  document.getElementById('tab-lf').classList.toggle('active', type === 'lf');
  document.getElementById('tab-gutters').classList.toggle('active', type === 'gut');
  document.getElementById('lf-form').style.display = type === 'lf' ? '' : 'none';
  document.getElementById('gutters-form').style.display = type === 'gut' ? '' : 'none';
  hideResults();
}

// ============================================================
// PILL SELECTION
// ============================================================
function selectPill(form, field, value, btn) {
  // Find all sibling pills by looking for pill-group parent
  const group = btn.closest('.pill-group');
  group.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');

  state[form][field] = value;

  // Versa Max note
  if (form === 'lf' && field === 'size') {
    document.getElementById('versa-note').style.display = value === 'versaMax' ? '' : 'none';
  }
  calc();
}

// ============================================================
// EXTRAS TOGGLE
// ============================================================
function toggleExtra(form, key) {
  state[form].extras[key] = !state[form].extras[key];
  const box = document.getElementById('chk-' + form + '-' + key);
  if (box) box.classList.toggle('checked', state[form].extras[key]);

  // Show/hide qty row if applicable
  const qtyRow = document.getElementById('qty-row-' + form + '-' + key);
  if (qtyRow) qtyRow.style.display = state[form].extras[key] ? '' : 'none';

  calc();
}

// ============================================================
// CALCULATION ENGINE
// ============================================================
function calc() {
  const type = state.jobType;
  const s = state[type];
  const extras = PRICES[type].extras;
  const linFt = parseFloat(document.getElementById(type === 'lf' ? 'lf-linear-feet' : 'gut-linear-feet').value) || 0;
  s.linearFeet = linFt;

  let breakdown = [];
  let commissionable = 0;
  let netOnly = 0; // not commissionable

  if (type === 'lf') {
    // Base price
    const baseRate = PRICES.lf.perFoot[s.size][s.floor];
    const base = baseRate * linFt;
    if (linFt > 0) {
      breakdown.push({ label: `LeafFilter ${sizeLabel(s.size)} — ${s.floor} Floor (${linFt} ft × $${baseRate})`, amount: base });
    }
    commissionable += base;

    // Extras
    for (const [key, on] of Object.entries(s.extras)) {
      if (!on) continue;
      const ex = extras[key];
      let amount = 0;
      if (ex.type === 'perFoot') {
        amount = ex.rate * linFt;
        breakdown.push({ label: `${ex.label} (${linFt} ft × $${ex.rate.toFixed(2)})`, amount });
      } else if (ex.type === 'perUnit') {
        const qty = qtyVal('lf', key);
        amount = ex.rate * qty;
        const unitLabel = key === 'extraLabor' ? 'hr' : 'ea';
        breakdown.push({ label: `${ex.label} (${qty} ${unitLabel} × $${ex.rate.toFixed(2)})`, amount });
      }
      commissionable += amount;
    }

  } else {
    // Gutters — admin fee is NET
    netOnly = PRICES.gut.adminFee;
    breakdown.push({ label: 'Admin/Set-up Fee (NET — non-commissionable)', amount: netOnly, net: true });

    const baseRate = PRICES.gut.perFoot[s.size];
    const base = baseRate * linFt;
    if (linFt > 0) {
      breakdown.push({ label: `${s.size === '5inch' ? '5"' : '6"'} Seamless Gutters (${linFt} ft × $${baseRate})`, amount: base });
    }
    commissionable += base;

    for (const [key, on] of Object.entries(s.extras)) {
      if (!on) continue;
      const ex = extras[key];
      let amount = 0;
      if (ex.type === 'perFoot') {
        amount = ex.rate * linFt;
        breakdown.push({ label: `${ex.label} (${linFt} ft × $${ex.rate.toFixed(2)})`, amount });
      } else if (ex.type === 'perUnit') {
        const qty = qtyVal('gut', key);
        amount = ex.rate * qty;
        breakdown.push({ label: `${ex.label} (${qty} ea × $${ex.rate.toFixed(2)})`, amount });
      } else if (ex.type === 'perSqFt') {
        const qty = qtyVal('gut', key);
        amount = ex.rate * qty;
        breakdown.push({ label: `${ex.label} (${qty} sq ft × $${ex.rate.toFixed(2)})`, amount });
      }
      commissionable += amount;
    }
  }

  const total = commissionable + netOnly;

  if (total === 0 && linFt === 0) { hideResults(); return; }

  // Commission
  const rate = state.settings.commissionRate / 100;
  const commBasis = state.settings.commissionType === 'net' ? commissionable : total;
  const commission = commBasis * rate;

  showResults(breakdown, total, netOnly, commissionable, commission);
}

function qtyVal(form, key) {
  const el = document.getElementById('qty-' + form + '-' + key);
  return el ? (parseFloat(el.value) || 1) : 1;
}

function sizeLabel(size) {
  return size === '5inch' ? '5"' : size === '6inch' ? '6"' : 'Versa Max';
}

// ============================================================
// RENDER RESULTS
// ============================================================
function showResults(breakdown, total, netOnly, commissionable, commission) {
  const section = document.getElementById('results-section');
  section.style.display = '';
  section.classList.remove('animate-in');
  void section.offsetWidth;
  section.classList.add('animate-in');

  let html = '';
  breakdown.forEach(row => {
    const cls = row.net ? 'result-net' : 'result-value';
    html += `<div class="result-row">
      <span class="result-label">${row.label}</span>
      <span class="${cls}">${fmt(row.amount)}</span>
    </div>`;
  });

  if (state.jobType === 'gut' && netOnly > 0 && commissionable > 0) {
    html += `<div class="result-row" style="margin-top:6px;padding-top:8px;border-top:1px solid var(--border)">
      <span class="result-label" style="font-size:12px;color:var(--text-muted)">Commissionable subtotal</span>
      <span class="result-value" style="font-size:12px">${fmt(commissionable)}</span>
    </div>`;
  }

  document.getElementById('results-breakdown').innerHTML = html;
  document.getElementById('result-total').textContent = fmt(total);
  document.getElementById('result-commission').textContent = fmt(commission);
  document.getElementById('action-buttons').style.display = '';

  // Store for saving
  state._lastResult = { breakdown, total, netOnly, commissionable, commission };
}

function hideResults() {
  document.getElementById('results-section').style.display = 'none';
  document.getElementById('action-buttons').style.display = 'none';
  state._lastResult = null;
}

function fmt(n) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ============================================================
// SAVE JOB
// ============================================================
function saveJob() {
  if (!state._lastResult) return;
  const r = state._lastResult;
  const type = state.jobType;
  const s = state[type];

  const job = {
    id: Date.now(),
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    type: type === 'lf' ? 'LeafFilter' : 'Gutters & Downspouts',
    size: sizeLabel(s.size),
    floor: type === 'lf' ? s.floor + ' Floor' : null,
    linearFeet: s.linearFeet,
    extrasCount: Object.values(s.extras).filter(Boolean).length,
    total: r.total,
    commissionable: r.commissionable,
    commission: r.commission,
    commissionRate: state.settings.commissionRate,
    breakdown: r.breakdown,
  };

  const jobs = getJobs();
  jobs.unshift(job);
  localStorage.setItem('lf_jobs', JSON.stringify(jobs));

  // Flash feedback
  const btn = document.querySelector('.btn-primary');
  const orig = btn.textContent;
  btn.textContent = '✅ Job Saved!';
  btn.style.background = 'linear-gradient(135deg, #1B5E20, #388E3C)';
  setTimeout(() => {
    btn.textContent = orig;
    btn.style.background = '';
  }, 1800);
}

function getJobs() {
  try { return JSON.parse(localStorage.getItem('lf_jobs') || '[]'); } catch { return []; }
}

// ============================================================
// RESET
// ============================================================
function resetCalc() {
  // Reset LF
  state.lf = { size: '5inch', floor: '1st', linearFeet: 0, extras: {} };
  state.gut = { size: '5inch', linearFeet: 0, extras: {} };

  // UI resets
  document.getElementById('lf-linear-feet').value = '';
  document.getElementById('gut-linear-feet').value = '';

  // Reset pills
  ['lf-size-5','lf-size-6','lf-size-versa'].forEach((id,i) => {
    document.getElementById(id).classList.toggle('active', i===0);
  });
  ['lf-floor-1','lf-floor-2','lf-floor-3'].forEach((id,i) => {
    document.getElementById(id).classList.toggle('active', i===0);
  });
  ['gut-size-5','gut-size-6'].forEach((id,i) => {
    document.getElementById(id).classList.toggle('active', i===0);
  });

  // Reset all checkboxes
  document.querySelectorAll('.chkbox').forEach(el => el.classList.remove('checked'));
  document.querySelectorAll('.qty-row').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.qty-input').forEach(el => el.value = 1);

  document.getElementById('versa-note').style.display = 'none';
  hideResults();
}

// ============================================================
// HISTORY
// ============================================================
function renderHistory() {
  const jobs = getJobs();
  const container = document.getElementById('history-list');
  if (!jobs.length) {
    container.innerHTML = `<div class="history-empty">
      <div class="history-empty-icon">📋</div>
      <div style="font-size:16px;font-weight:700;margin-bottom:6px">No jobs saved yet</div>
      <div style="font-size:13px">Complete a quote and tap Save to track it here.</div>
    </div>`;
    return;
  }

  container.innerHTML = jobs.map((job, idx) => `
    <div class="history-item">
      <button class="history-delete" onclick="deleteJob(${idx})">✕</button>
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div class="history-type">${job.type}</div>
        <div class="history-date">${job.date}</div>
      </div>
      <div class="history-detail">
        ${job.linearFeet} ft · ${job.size}${job.floor ? ' · ' + job.floor : ''}
        ${job.extrasCount > 0 ? ` · ${job.extrasCount} extra${job.extrasCount > 1 ? 's' : ''}` : ''}
      </div>
      <div class="history-total">${fmt(job.total)}</div>
      <div class="history-commission">💰 ${fmt(job.commission)} commission (${job.commissionRate}%)</div>
    </div>
  `).join('');
}

function deleteJob(idx) {
  const jobs = getJobs();
  jobs.splice(idx, 1);
  localStorage.setItem('lf_jobs', JSON.stringify(jobs));
  renderHistory();
}

function clearHistory() {
  if (!confirm('Clear all saved jobs?')) return;
  localStorage.removeItem('lf_jobs');
  renderHistory();
}

// ============================================================
// SETTINGS
// ============================================================
function saveSettings() {
  state.settings.commissionRate = parseFloat(document.getElementById('setting-commission-rate').value) || 10;
  localStorage.setItem('lf_settings', JSON.stringify(state.settings));
  calc(); // recalc if results visible
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('lf_settings') || '{}');
    if (saved.commissionRate !== undefined) state.settings.commissionRate = saved.commissionRate;
    if (saved.commissionType !== undefined) state.settings.commissionType = saved.commissionType;
    document.getElementById('setting-commission-rate').value = state.settings.commissionRate;
    const typeId = 'comm-type-' + state.settings.commissionType;
    document.getElementById('comm-type-full').classList.toggle('active', state.settings.commissionType === 'full');
    document.getElementById('comm-type-net').classList.toggle('active', state.settings.commissionType === 'net');
  } catch {}
}

function selectCommType(type, btn) {
  state.settings.commissionType = type;
  document.getElementById('comm-type-full').classList.toggle('active', type === 'full');
  document.getElementById('comm-type-net').classList.toggle('active', type === 'net');
  saveSettings();
}
