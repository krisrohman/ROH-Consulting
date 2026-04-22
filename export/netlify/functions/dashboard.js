// netlify/functions/dashboard.js
// Reads KPI config + settings + sections from Neon, pulls weekly data from
// Apps Script, computes monthly + YTD + trend per math_type.

import { neon } from '@netlify/neon';

const FALLBACK_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbzlDHNo24PBsvjmF1zVUpHDRjcMkxIfDuaMYb1TkHVvG7otz9fPvIKYMvQFRuI7I0DO/exec';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const sql = neon();

export default async () => {
  try {
    let sectionRows = [];
    const [kpiRows, settingRows] = await Promise.all([
      sql`SELECT kpi_name, section, unit, owner, department, tier, math_type, goal_direction, sort_order FROM kpis ORDER BY sort_order`,
      sql`SELECT key, value FROM settings`
    ]);

    try {
      sectionRows = await sql`
        SELECT section_key, display_number, display_name, tagline, owner_badge,
               leading_kpi_name, leading_display_label, leading_description, sort_order
        FROM sections WHERE active = TRUE ORDER BY sort_order ASC`;
    } catch (_) {
      sectionRows = [];
    }

    const settings = {};
    settingRows.forEach(s => { settings[s.key] = s.value; });

    const appsScriptUrl =
      settings.apps_script_url ||
      process.env.APPS_SCRIPT_URL ||
      FALLBACK_APPS_SCRIPT_URL;

    // Cache-bust: Google's script.google.com edge caches Apps Script web-app
    // responses per-URL for ~60s. Without a unique query param, sheet edits
    // don't show up until the edge expires. Adding ?t=<now> forces a fresh
    // fetch every time. Also pass fetch cache: 'no-store' for the Netlify
    // runtime's own HTTP cache.
    const bustUrl = appsScriptUrl + (appsScriptUrl.includes('?') ? '&' : '?') + 't=' + Date.now();
    const sheetResp = await fetch(bustUrl, { cache: 'no-store' }).then(r => r.json());

    if (!sheetResp || !sheetResp.ok) {
      throw new Error('Apps Script returned not-ok: ' + (sheetResp && sheetResp.error));
    }

    const mathTypeByKpi = {};
    kpiRows.forEach(k => { mathTypeByKpi[k.kpi_name] = k.math_type || 'avg'; });

    const actuals = computeMonthlyActuals(sheetResp.weekly, mathTypeByKpi);

    return json({
      ok: true,
      kpis: kpiRows,
      sections: sectionRows,
      settings,
      sheet: {
        actuals,
        priorYear: sheetResp.priorYear || [],
        targets:   sheetResp.targets   || [],
        weekly:    sheetResp.weekly    || { columns: [], months: [], rows: [] }
      },
      syncedAt: sheetResp.syncedAt || new Date().toISOString()
    });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function computeMonthlyActuals(weekly, mathTypeByKpi) {
  if (!weekly || !weekly.rows || !weekly.columns || !weekly.months) return [];

  const columns = weekly.columns; // ["W1","W2",...,"W52"]
  const months  = weekly.months;  // ["Jan","Jan",...,"Dec"]
  const results = [];

  for (const row of weekly.rows) {
    const kpi = row.kpi;
    const mathType = mathTypeByKpi[kpi] || 'avg';
    const weeks = row.weeks || {};

    const monthBuckets = {};
    for (const m of MONTHS) monthBuckets[m] = [];

    // Walk columns in order so we stay aligned with months[]
    for (let i = 0; i < columns.length; i++) {
      const weekLabel = columns[i];
      const monthAbbrev = months[i];
      const v = weeks[weekLabel];
      if (v === null || v === undefined || v === '') continue;
      if (!monthBuckets[monthAbbrev]) continue;
      monthBuckets[monthAbbrev].push(Number(v));
    }

    const monthResults = {};
    let ytdValues = [];
    for (const m of MONTHS) {
      const bucket = monthBuckets[m];
      if (!bucket.length) {
        monthResults[m] = null;
        continue;
      }
      if (mathType === 'sum') {
        monthResults[m] = bucket.reduce((a, b) => a + b, 0);
      } else if (mathType === 'latest') {
        monthResults[m] = bucket[bucket.length - 1];
      } else {
        monthResults[m] = bucket.reduce((a, b) => a + b, 0) / bucket.length;
      }
      ytdValues = ytdValues.concat(bucket);
    }

    let ytd = null;
    if (ytdValues.length) {
      if (mathType === 'sum') {
        ytd = ytdValues.reduce((a, b) => a + b, 0);
      } else if (mathType === 'latest') {
        ytd = ytdValues[ytdValues.length - 1];
      } else {
        ytd = ytdValues.reduce((a, b) => a + b, 0) / ytdValues.length;
      }
    }

    // Last 4 non-null weekly values → percent change oldest→newest
    const orderedVals = columns.map(c => weeks[c]).filter(v => v !== null && v !== undefined && v !== '').slice(-4).map(Number);
    let trend = null;
    if (orderedVals.length >= 2) {
      const oldest = orderedVals[0];
      const newest = orderedVals[orderedVals.length - 1];
      if (oldest !== 0) {
        const pct = ((newest - oldest) / Math.abs(oldest)) * 100;
        if (Math.abs(pct) < 1) trend = 'flat';
        else if (pct > 0) trend = 'up';
        else trend = 'down';
      }
    }

    results.push({
      kpi,
      months: monthResults,
      ytd,
      math_type: mathType,
      trend
    });
  }

  return results;
}

export const config = { path: '/api/dashboard' };
