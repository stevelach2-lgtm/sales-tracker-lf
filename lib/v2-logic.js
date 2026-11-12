// Display and workflow helpers for dashboard v2.
// Commission, markup, pricing, admin fee, and text-hour rules are not in this file.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.V2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var WEEKLY_COMMISSION_GOAL = 3500;
  var VISIT_MINUTES = 60;
  var HOME_DEFAULT = '221 Sunny Jim Dr, Medford, NJ 08055';
  var MOCKUP_STYLE = 'warm-white individual pinpoint lights, evenly spaced about every 12 inches along the eaves and roofline, never a continuous strip';
  var MOCKUP_IMAGE_MAX_BYTES = 3 * 1024 * 1024;

  // Dated IRS business standard mileage rates. Add a row when a new year is published.
  // https://www.irs.gov/tax-professionals/standard-mileage-rates
  var IRS_MILEAGE_RATES = [
    { start: '2026-01-01', end: '2026-06-30', cents: 72.5, rate: 0.725, label: '72.5¢' },
    { start: '2026-07-01', end: '2026-12-31', cents: 76, rate: 0.76, label: '76¢' }
  ];

  function dateKey(value) {
    var text = String(value || '').trim();
    var match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
    return match ? match[1] : '';
  }

  function irsRateForDate(value) {
    var key = dateKey(value);
    if (!key) return null;
    for (var i = 0; i < IRS_MILEAGE_RATES.length; i++) {
      var row = IRS_MILEAGE_RATES[i];
      if (key >= row.start && key <= row.end) return row;
    }
    return null;
  }

  function roundMoney(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  function deductionForDays(rows) {
    var miles = 0;
    var dollars = 0;
    var missingRate = false;
    var labels = {};
    (rows || []).forEach(function (row) {
      if (!row) return;
      var m = Number(row.miles);
      if (!isFinite(m) || m <= 0) return;
      miles += m;
      var rate = irsRateForDate(row.date);
      if (!rate) {
        missingRate = true;
        return;
      }
      dollars += m * rate.rate;
      labels[rate.label] = true;
    });
    return {
      miles: Math.round(miles * 10) / 10,
      dollars: roundMoney(dollars),
      missingRate: missingRate,
      rateLabels: Object.keys(labels)
    };
  }

  function alertText(alert) {
    if (!alert) return '';
    return String(alert.event || alert.headline || alert.eventName || '').trim();
  }

  // Rain, snow, ice, flooding, and temperature extremes only. Wind never qualifies.
  function nwsAlertAllowed(alert) {
    var event = alertText(alert).toLowerCase();
    if (!event) return false;
    var weather = /rain|flood|snow|blizzard|ice|sleet|freez|winter|cold|heat|frost/;
    var wind = /\bwind\b|\bbreeze\b|\bgust\b/;
    if (wind.test(event) && !weather.test(event)) return false;
    return weather.test(event);
  }

  function filterNwsAlerts(alerts) {
    return (alerts || []).filter(nwsAlertAllowed).map(function (alert) {
      return { event: alertText(alert), id: alert.id || null };
    });
  }

  function num(value) {
    var n = Number(value);
    return isFinite(n) ? n : null;
  }

  function pointSignals(point) {
    var p = point || {};
    var forecast = String(p.shortForecast || p.precipType || '').toLowerCase();
    var rainChance = num(p.rainChance);
    if (rainChance == null) rainChance = 0;
    var snowChance = num(p.snowChance);
    if (snowChance == null) snowChance = 0;
    var snowAmount = num(p.snowAmount);
    if (snowAmount == null) snowAmount = 0;
    var temp = num(p.tempF);
    var heat = num(p.heatIndexF);
    if (heat == null) heat = temp;
    var alerts = filterNwsAlerts(p.alerts);
    var mentionsSnow = /snow|flurr/.test(forecast) || snowChance > 0 || snowAmount > 0;
    var mentionsIce = /ice storm|blizzard|sleet|freezing rain|freezing drizzle|\bice\b/.test(forecast);
    var mentionsRain = /rain|shower|drizzle/.test(forecast) || rainChance >= 50;
    var winterAlert = alerts.some(function (a) {
      return /winter|blizzard|ice|sleet|snow|freez/.test(a.event.toLowerCase());
    });
    var iceStorm = winterAlert || /ice storm|blizzard/.test(forecast);
    var rainAtFreezing = mentionsRain && temp != null && temp <= 32;
    return {
      temp: temp,
      heat: heat,
      rainChance: rainChance,
      snow: mentionsSnow,
      iceStorm: iceStorm,
      iceRisk: mentionsIce || rainAtFreezing,
      rain: mentionsRain,
      alerts: alerts,
      forecast: forecast
    };
  }

  function warningsForPoint(point) {
    var s = pointSignals(point);
    var out = [];
    if (s.rain && s.rainChance >= 50) out.push({ kind: 'rain', label: 'Rain likely' });
    else if (s.rain && /rain|shower|drizzle/.test(s.forecast)) out.push({ kind: 'rain', label: 'Rain' });
    if (s.snow) out.push({ kind: 'snow', label: 'Snow' });
    if (s.iceStorm) out.push({ kind: 'ice', label: 'Ice storm' });
    else if (s.iceRisk) out.push({ kind: 'ice', label: 'Ice risk' });
    if (s.temp != null && s.temp <= 25) out.push({ kind: 'cold', label: 'Very cold' });
    if (s.heat != null && s.heat >= 90) out.push({ kind: 'heat', label: 'Heat' });
    s.alerts.forEach(function (alert) {
      out.push({ kind: 'alert', label: alert.event });
    });
    return out.filter(function (item) {
      return !/\bwind\b/i.test(item.label);
    });
  }

  // clear < rain < snow < ice. Snow and freezing rain share the 25% pad. Ice storm / winter alert is 40%.
  function severityRank(name) {
    if (name === 'ice') return 3;
    if (name === 'snow') return 2;
    if (name === 'rain') return 1;
    return 0;
  }

  function severityForPoint(point) {
    var s = pointSignals(point);
    if (s.iceStorm) return 'ice';
    if (s.snow || s.iceRisk) return 'snow';
    if (s.rain && s.rainChance >= 50) return 'rain';
    if (s.rain && /rain|shower|drizzle/.test(s.forecast) && s.rainChance >= 50) return 'rain';
    return 'clear';
  }

  function worstSeverity(points) {
    var best = 'clear';
    (points || []).forEach(function (point) {
      var next = typeof point === 'string' ? point : severityForPoint(point);
      if (severityRank(next) > severityRank(best)) best = next;
    });
    return best;
  }

  function weatherPadMinutes(driveMinutes, severity) {
    var drive = Math.max(0, Number(driveMinutes) || 0);
    if (severity === 'ice') return Math.max(20, Math.ceil(drive * 0.40));
    if (severity === 'snow') return Math.max(15, Math.ceil(drive * 0.25));
    if (severity === 'rain') return Math.max(10, Math.ceil(drive * 0.10));
    return 0;
  }

  function padReason(pad, severity) {
    if (!pad) return '';
    if (severity === 'ice') return '+' + pad + ' min ice';
    if (severity === 'snow') return '+' + pad + ' min snow';
    if (severity === 'rain') return '+' + pad + ' min rain';
    return '';
  }

  function leaveBy(input) {
    var src = input || {};
    var appt = new Date(src.appointmentAt);
    if (isNaN(appt.getTime())) return null;
    if (src.driveMinutes == null || src.driveMinutes === '' || !isFinite(Number(src.driveMinutes))) return null;
    var drive = Math.max(0, Math.round(Number(src.driveMinutes)));
    var severity = src.severity || 'clear';
    var pad = weatherPadMinutes(drive, severity);
    var ideal = new Date(appt.getTime() - (drive + pad) * 60000);
    var earliest = src.earliestLeaveAt ? new Date(src.earliestLeaveAt) : null;
    var tight = false;
    var lateMinutes = 0;
    var leave = ideal;
    if (earliest && !isNaN(earliest.getTime()) && ideal.getTime() < earliest.getTime()) {
      tight = true;
      leave = earliest;
      lateMinutes = Math.max(1, Math.ceil((earliest.getTime() + (drive + pad) * 60000 - appt.getTime()) / 60000));
    }
    return {
      leaveAt: leave.toISOString(),
      driveMinutes: drive,
      padMinutes: pad,
      totalMinutes: drive + pad,
      severity: severity,
      padReason: padReason(pad, severity),
      tight: tight,
      lateMinutes: lateMinutes,
      warning: tight ? ("Tight: you'll be about " + lateMinutes + ' min late') : ''
    };
  }

  function homeBy(input) {
    var src = input || {};
    var start = new Date(src.lastAppointmentAt);
    if (isNaN(start.getTime())) return null;
    if (src.driveHomeMinutes == null || !isFinite(Number(src.driveHomeMinutes))) return null;
    var drive = Math.max(0, Math.round(Number(src.driveHomeMinutes)));
    var visit = src.visitMinutes == null ? VISIT_MINUTES : Number(src.visitMinutes);
    if (!isFinite(visit)) visit = VISIT_MINUTES;
    return new Date(start.getTime() + (visit + drive) * 60000).toISOString();
  }

  function haversineMiles(a, b) {
    if (!a || !b) return 0;
    var R = 3958.7613;
    var dLat = (b.lat - a.lat) * Math.PI / 180;
    var dLng = (b.lng - a.lng) * Math.PI / 180;
    var la1 = a.lat * Math.PI / 180;
    var la2 = b.lat * Math.PI / 180;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function sampleRouteMiles(coords, everyMiles, cap) {
    if (!coords || !coords.length) return [];
    var step = everyMiles > 0 ? everyMiles : 15;
    var limit = cap > 0 ? cap : 8;
    var out = [coords[0]];
    var since = 0;
    var prev = coords[0];
    for (var i = 1; i < coords.length; i++) {
      since += haversineMiles(prev, coords[i]);
      if (since >= step) {
        out.push(coords[i]);
        since = 0;
        if (out.length >= limit) break;
      }
      prev = coords[i];
    }
    var last = coords[coords.length - 1];
    var tail = out[out.length - 1];
    if (out.length < limit && (tail.lat !== last.lat || tail.lng !== last.lng)) out.push(last);
    return out;
  }

  function lineCoords(geometry) {
    var raw = geometry && geometry.coordinates;
    if (!raw && geometry && geometry.type === 'Feature') raw = geometry.geometry && geometry.geometry.coordinates;
    if (!Array.isArray(raw)) return [];
    return raw.map(function (pair) {
      return { lng: Number(pair[0]), lat: Number(pair[1]) };
    }).filter(function (p) {
      return isFinite(p.lat) && isFinite(p.lng);
    });
  }

  function utcDate(key) {
    var parts = dateKey(key).split('-').map(Number);
    return new Date(Date.UTC(parts[0], (parts[1] || 1) - 1, parts[2] || 1));
  }

  function isoDate(d) {
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  function payFridayForInstall(installDate, pushWeeks) {
    var key = dateKey(installDate);
    if (!key) return '';
    var d = utcDate(key);
    var extra = Math.max(0, Number(pushWeeks) || 0) * 7;
    d.setUTCDate(d.getUTCDate() + extra);
    var dow = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() + (6 - dow));
    d.setUTCDate(d.getUTCDate() + 6);
    return isoDate(d);
  }

  function nextFridayOnOrAfter(todayKey) {
    var key = dateKey(todayKey);
    if (!key) return '';
    var d = utcDate(key);
    var dow = d.getUTCDay();
    var add = dow <= 5 ? (5 - dow) : 6;
    d.setUTCDate(d.getUTCDate() + add);
    return isoDate(d);
  }

  function earnedCommission(leads) {
    return roundMoney((leads || []).reduce(function (sum, lead) {
      if (!lead || lead.status !== 'sold') return sum;
      if (lead.is_cancelled === true || lead.is_cancelled === 'true') return sum;
      return sum + (parseFloat(lead.commission_amount) || 0);
    }, 0));
  }

  function goalProgress(earned, goal) {
    var target = goal == null ? WEEKLY_COMMISSION_GOAL : Number(goal);
    var amount = Number(earned) || 0;
    var pct = target > 0 ? Math.max(0, Math.min(100, (amount / target) * 100)) : 0;
    return { earned: roundMoney(amount), goal: target, pct: Math.round(pct) };
  }

  function classifyUnpaid(jobs, todayKey) {
    var friday = nextFridayOnOrAfter(todayKey);
    var paysFriday = 0;
    var waiting = 0;
    var notInstalled = 0;
    var waitingByDate = {};
    (jobs || []).forEach(function (job) {
      if (!job || job.status === 'not_sold' || job.status === 'pending') return;
      if (job.is_cancelled === true || job.is_cancelled === 'true') return;
      if (job.commission_paid === true || job.commission_paid === 'true') return;
      var amount = parseFloat(job.commission_amount) || 0;
      if (!dateKey(job.install_date)) {
        notInstalled += amount;
        return;
      }
      var pay = payFridayForInstall(job.install_date, job.pay_push_weeks || 0);
      if (job.is_funded === true || job.is_funded === 'true') {
        if (pay === friday) paysFriday += amount;
        return;
      }
      waiting += amount;
      waitingByDate[pay] = roundMoney((waitingByDate[pay] || 0) + amount);
    });
    return {
      paysFriday: roundMoney(paysFriday),
      paysFridayDate: friday,
      waiting: roundMoney(waiting),
      waitingByDate: waitingByDate,
      notInstalled: roundMoney(notInstalled)
    };
  }

  function mockupButtonLabel(configured) {
    return configured === false ? 'Not set up yet' : 'Night mockup';
  }

  function mockupStatusLabel(status) {
    if (status === 'requested') return 'Mockup requested';
    if (status === 'in_progress') return 'Mockup in progress';
    if (status === 'ready') return 'Mockup ready';
    if (status === 'failed') return "Couldn't make";
    return '';
  }

  // Pure status flow. The server applies the same decisions before it writes a row.
  function mockupRequestDecision(input) {
    var src = input || {};
    if (src.webhookConfigured === false) {
      return { ok: false, notConfigured: true, callWebhook: false, buttonLabel: 'Not set up yet', status: null, error: null };
    }
    if (!src.hasPhoto) {
      return {
        ok: false,
        notConfigured: false,
        callWebhook: false,
        buttonLabel: 'Night mockup',
        status: 'failed',
        error: 'Add a photo of the house first'
      };
    }
    if (src.webhookOk === false) {
      return {
        ok: false,
        notConfigured: false,
        callWebhook: true,
        buttonLabel: 'Night mockup',
        status: 'failed',
        error: src.webhookError || 'Could not reach the mockup service'
      };
    }
    return { ok: true, notConfigured: false, callWebhook: true, buttonLabel: 'Night mockup', status: 'requested', error: null };
  }

  function mockupImageBytes(b64) {
    var text = String(b64 || '').replace(/\s/g, '');
    if (!text) return 0;
    var pad = text.slice(-2) === '==' ? 2 : (text.slice(-1) === '=' ? 1 : 0);
    return Math.floor((text.length * 3) / 4) - pad;
  }

  function mockupImageTooLarge(b64) {
    return mockupImageBytes(b64) > MOCKUP_IMAGE_MAX_BYTES;
  }

  function applyMockupUpload(input) {
    var src = input || {};
    if (!src.secretOk) return { http: 401, error: 'Unauthorized' };
    if (!src.leadId) return { http: 400, error: 'lead_id is required' };
    var raw = src.status;
    var status = (raw == null || String(raw).trim() === '') ? 'ready' : String(raw).trim();
    if (status !== 'in_progress' && status !== 'failed' && status !== 'ready') {
      return { http: 400, error: 'Unknown status' };
    }
    if (status === 'in_progress') return { http: 200, status: 'in_progress', error: null };
    if (status === 'failed') {
      if (!src.error) return { http: 400, error: 'A reason is required' };
      return { http: 200, status: 'failed', error: String(src.error) };
    }
    if (status === 'ready') {
      if (!src.hasImage) return { http: 400, error: 'image is required' };
      return { http: 200, status: 'ready', error: null };
    }
    return { http: 400, error: 'Unknown status' };
  }

  function retryMockup(current) {
    if (current !== 'failed' && current !== 'ready') return { ok: false, error: 'Nothing to try again' };
    return { ok: true, status: 'requested' };
  }

  function stripWindWords(text) {
    return String(text || '')
      .replace(/\b(windy|breezy|gusty|blustery|high winds?|wind advisory)\b/ig, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+,/g, ',')
      .trim();
  }

  function withinLastMinutes(appointmentAt, now, minutes) {
    var appt = new Date(appointmentAt).getTime();
    var clock = now ? new Date(now).getTime() : Date.now();
    if (isNaN(appt) || isNaN(clock)) return false;
    var delta = appt - clock;
    return delta <= minutes * 60000 && delta >= -VISIT_MINUTES * 60000;
  }

  return {
    WEEKLY_COMMISSION_GOAL: WEEKLY_COMMISSION_GOAL,
    VISIT_MINUTES: VISIT_MINUTES,
    HOME_DEFAULT: HOME_DEFAULT,
    MOCKUP_STYLE: MOCKUP_STYLE,
    MOCKUP_IMAGE_MAX_BYTES: MOCKUP_IMAGE_MAX_BYTES,
    IRS_MILEAGE_RATES: IRS_MILEAGE_RATES,
    dateKey: dateKey,
    irsRateForDate: irsRateForDate,
    deductionForDays: deductionForDays,
    nwsAlertAllowed: nwsAlertAllowed,
    filterNwsAlerts: filterNwsAlerts,
    warningsForPoint: warningsForPoint,
    severityForPoint: severityForPoint,
    worstSeverity: worstSeverity,
    weatherPadMinutes: weatherPadMinutes,
    padReason: padReason,
    leaveBy: leaveBy,
    homeBy: homeBy,
    haversineMiles: haversineMiles,
    sampleRouteMiles: sampleRouteMiles,
    lineCoords: lineCoords,
    payFridayForInstall: payFridayForInstall,
    nextFridayOnOrAfter: nextFridayOnOrAfter,
    earnedCommission: earnedCommission,
    goalProgress: goalProgress,
    classifyUnpaid: classifyUnpaid,
    mockupButtonLabel: mockupButtonLabel,
    mockupStatusLabel: mockupStatusLabel,
    mockupRequestDecision: mockupRequestDecision,
    mockupImageBytes: mockupImageBytes,
    mockupImageTooLarge: mockupImageTooLarge,
    applyMockupUpload: applyMockupUpload,
    retryMockup: retryMockup,
    stripWindWords: stripWindWords,
    withinLastMinutes: withinLastMinutes
  };
});
