// Builds the Next up weather and traffic answer. Coordinates only: no names or phones.
// Mapbox is used when MAPBOX_TOKEN is set. Without it, drive time comes from OSRM
// (no live traffic) or is omitted. Never throws for a missing token.

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const v2 = require('../lib/v2-logic.js');

const NWS_UA = 'LeafFilterSalesTracker/1.0 (https://sales-tracker-lf.vercel.app; conditions)';

function finitePair(point) {
  if (!point) return null;
  const lat = Number(point.lat);
  const lng = Number(point.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: lat, lng: lng };
}

function periodToPoint(period, alerts) {
  const text = String((period && period.shortForecast) || '');
  const pop = period && period.probabilityOfPrecipitation ? Number(period.probabilityOfPrecipitation.value) : null;
  const snow = /snow|flurr/i.test(text);
  const ice = /ice|sleet|freezing rain/i.test(text);
  const rain = /rain|shower|drizzle/i.test(text);
  return {
    tempF: period ? period.temperature : null,
    heatIndexF: period && period.heatIndex != null ? period.heatIndex : (period ? period.temperature : null),
    rainChance: snow ? 0 : (Number.isFinite(pop) ? pop : (rain ? 60 : 0)),
    snowChance: snow ? (Number.isFinite(pop) ? pop : 60) : 0,
    snowAmount: snow ? 0.1 : 0,
    precipType: ice ? 'ice' : (snow ? 'snow' : ''),
    shortForecast: v2.stripWindWords(text),
    alerts: alerts || [],
    startTime: period ? period.startTime : null
  };
}

function forecastAt(periods, isoTime) {
  const target = new Date(isoTime).getTime();
  if (!periods || !periods.length || Number.isNaN(target)) return periods && periods[0];
  let best = periods[0];
  let bestDelta = Infinity;
  periods.forEach(function (period) {
    const start = new Date(period.startTime).getTime();
    if (Number.isNaN(start)) return;
    const delta = Math.abs(start - target);
    if (delta < bestDelta) {
      best = period;
      bestDelta = delta;
    }
  });
  return best;
}

function passTime(departAt, milesFromStart, totalMiles, driveMinutes) {
  const start = new Date(departAt).getTime();
  if (Number.isNaN(start) || !driveMinutes) return departAt;
  const frac = totalMiles > 0 ? Math.min(1, milesFromStart / totalMiles) : 0;
  return new Date(start + frac * driveMinutes * 60000).toISOString();
}

async function readJson(fetchFn, url, headers, timeoutMs) {
  const response = await fetchFn(url, {
    headers: Object.assign({ Accept: 'application/json', 'User-Agent': NWS_UA }, headers || {}),
    signal: AbortSignal.timeout(timeoutMs || 6000)
  });
  if (!response.ok) {
    const error = new Error('HTTP ' + response.status);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function nwsPoint(fetchFn, lat, lng, cache) {
  const key = lat.toFixed(2) + ',' + lng.toFixed(2);
  if (cache.points[key]) return cache.points[key];
  const json = await readJson(fetchFn, 'https://api.weather.gov/points/' + lat.toFixed(4) + ',' + lng.toFixed(4), null, 5000);
  const props = json && json.properties;
  const hourly = props && props.forecastHourly;
  if (!hourly) return null;
  cache.points[key] = hourly;
  return hourly;
}

async function nwsHourly(fetchFn, url, cache) {
  if (!url) return [];
  if (cache.hourly[url]) return cache.hourly[url];
  const json = await readJson(fetchFn, url, null, 5000);
  const periods = json && json.properties && Array.isArray(json.properties.periods) ? json.properties.periods : [];
  cache.hourly[url] = periods;
  return periods;
}

async function nwsAlerts(fetchFn, lat, lng) {
  try {
    const json = await readJson(
      fetchFn,
      'https://api.weather.gov/alerts/active?point=' + lat.toFixed(4) + ',' + lng.toFixed(4),
      null,
      4000
    );
    const features = json && Array.isArray(json.features) ? json.features : [];
    return features.map(function (feature) {
      const props = feature.properties || {};
      return { id: feature.id || props.id || null, event: props.event || '', headline: props.headline || '' };
    });
  } catch (error) {
    return [];
  }
}

async function mapboxRoute(fetchFn, origin, dest, token) {
  const path = origin.lng + ',' + origin.lat + ';' + dest.lng + ',' + dest.lat;
  const url = 'https://api.mapbox.com/directions/v5/mapbox/driving-traffic/' + path
    + '?geometries=geojson&overview=full&access_token=' + encodeURIComponent(token);
  const json = await readJson(fetchFn, url, { 'User-Agent': NWS_UA }, 6000);
  const route = json && json.routes && json.routes[0];
  if (!route) return null;
  return {
    minutes: Math.max(1, Math.round((Number(route.duration) || 0) / 60)),
    miles: Math.round(((Number(route.distance) || 0) / 1609.344) * 10) / 10,
    traffic: true,
    coords: v2.lineCoords(route.geometry)
  };
}

async function osrmRoute(fetchFn, origin, dest) {
  const path = origin.lng + ',' + origin.lat + ';' + dest.lng + ',' + dest.lat;
  const url = 'https://router.project-osrm.org/route/v1/driving/' + path + '?overview=full&geometries=geojson';
  const json = await readJson(fetchFn, url, null, 6000);
  const route = json && json.routes && json.routes[0];
  if (!route) return null;
  return {
    minutes: Math.max(1, Math.round((Number(route.duration) || 0) / 60)),
    miles: Math.round(((Number(route.distance) || 0) / 1609.344) * 10) / 10,
    traffic: false,
    coords: v2.lineCoords(route.geometry)
  };
}

function weatherSummary(point) {
  if (!point) return '';
  const parts = [];
  if (point.tempF != null && point.tempF !== '') parts.push(Math.round(Number(point.tempF)) + '°F');
  const warnings = v2.warningsForPoint(point).map(function (item) { return item.label; });
  if (point.rainChance >= 50) parts.push('rain ' + Math.round(point.rainChance) + '%');
  else if (point.shortForecast) parts.push(point.shortForecast);
  warnings.forEach(function (label) {
    if (parts.join(' ').toLowerCase().indexOf(label.toLowerCase()) === -1) parts.push(label);
  });
  return parts.join(' · ');
}

async function buildConditions(input, deps) {
  const src = input || {};
  const fetchFn = (deps && deps.fetch) || fetch;
  const token = deps && Object.prototype.hasOwnProperty.call(deps, 'mapboxToken')
    ? deps.mapboxToken
    : (process.env.MAPBOX_TOKEN || '');
  const dest = finitePair(src.dest);
  const origin = finitePair(src.origin);
  const appointmentAt = src.appointmentAt || null;
  const cache = { points: {}, hourly: {} };
  const result = {
    weather: null,
    drive: null,
    routeWeather: null,
    severity: 'clear',
    padMinutes: 0,
    padReason: '',
    leaveAt: null,
    updatedAt: new Date().toISOString(),
    degraded: null
  };
  if (!dest) {
    result.degraded = 'no_destination';
    return result;
  }

  let alerts = [];
  try {
    alerts = await nwsAlerts(fetchFn, dest.lat, dest.lng);
    const hourlyUrl = await nwsPoint(fetchFn, dest.lat, dest.lng, cache);
    const periods = await nwsHourly(fetchFn, hourlyUrl, cache);
    const period = forecastAt(periods, appointmentAt);
    if (period) {
      const point = periodToPoint(period, alerts);
      result.weather = {
        tempF: point.tempF,
        rainChance: point.rainChance,
        snowChance: point.snowChance,
        summary: weatherSummary(point),
        warnings: v2.warningsForPoint(point).map(function (item) { return item.label; }),
        shortForecast: point.shortForecast
      };
    }
  } catch (error) {
    result.degraded = result.degraded || 'weather_unavailable';
  }

  let route = null;
  if (origin) {
    if (token) {
      try {
        route = await mapboxRoute(fetchFn, origin, dest, token);
      } catch (error) {
        result.degraded = 'traffic_unavailable';
      }
    }
    if (!route) {
      try {
        route = await osrmRoute(fetchFn, origin, dest);
        if (route) result.degraded = token ? (result.degraded || 'traffic_unavailable') : 'no_traffic';
      } catch (error) {
        if (!result.degraded) result.degraded = token ? 'traffic_unavailable' : 'no_traffic';
      }
    }
  } else if (!token) {
    result.degraded = result.degraded || 'no_traffic';
  }

  if (route) {
    result.drive = {
      minutes: route.minutes,
      miles: route.miles,
      traffic: route.traffic,
      summary: route.minutes + ' min' + (route.traffic ? ' with traffic' : ' drive')
    };
    const samples = v2.sampleRouteMiles(route.coords, 15, 6);
    const points = [];
    const departGuess = appointmentAt
      ? new Date(new Date(appointmentAt).getTime() - route.minutes * 60000).toISOString()
      : null;
    let walked = 0;
    let prev = samples[0];
    for (let i = 0; i < samples.length; i++) {
      if (i > 0) walked += v2.haversineMiles(prev, samples[i]);
      prev = samples[i];
      try {
        const hourlyUrl = await nwsPoint(fetchFn, samples[i].lat, samples[i].lng, cache);
        const periods = await nwsHourly(fetchFn, hourlyUrl, cache);
        const when = passTime(departGuess, walked, route.miles, route.minutes);
        const period = forecastAt(periods, when);
        if (period) points.push(periodToPoint(period, i === samples.length - 1 ? alerts : []));
      } catch (error) {
        // One missed sample does not fail the card.
      }
    }
    const severities = points.map(v2.severityForPoint);
    if (result.weather) {
      severities.push(v2.severityForPoint({
        tempF: result.weather.tempF,
        rainChance: result.weather.rainChance,
        snowChance: result.weather.snowChance,
        shortForecast: result.weather.shortForecast,
        alerts: alerts
      }));
    }
    result.severity = v2.worstSeverity(severities);
    const routeWarnings = [];
    points.forEach(function (point) {
      v2.warningsForPoint(point).forEach(function (item) {
        if (routeWarnings.indexOf(item.label) === -1) routeWarnings.push(item.label);
      });
    });
    result.routeWeather = {
      severity: result.severity,
      summary: routeWarnings.filter(function (label) { return !/wind/i.test(label); }).slice(0, 3).join(' · ')
    };
    const plan = v2.leaveBy({
      appointmentAt: appointmentAt,
      driveMinutes: route.minutes,
      severity: result.severity
    });
    if (plan) {
      result.padMinutes = plan.padMinutes;
      result.padReason = plan.padReason;
      result.leaveAt = plan.leaveAt;
    }
  } else if (result.weather) {
    result.severity = v2.severityForPoint({
      tempF: result.weather.tempF,
      rainChance: result.weather.rainChance,
      snowChance: result.weather.snowChance,
      shortForecast: result.weather.shortForecast,
      alerts: alerts
    });
  }

  if (!token && !result.degraded) result.degraded = 'no_traffic';
  return result;
}

export { buildConditions, periodToPoint, forecastAt, NWS_UA };
