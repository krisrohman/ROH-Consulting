// netlify/functions/settings.js
// ============================================================
// Dashboard settings CRUD
//
//   GET  /api/settings          → all key/value pairs
//   POST /api/settings          → save (body: { settings: {...}, actor })
// ============================================================

import { neon } from '@netlify/neon';
const sql = neon();

export default async (request) => {
  try {
    if (request.method === 'GET') {
      const rows = await sql`SELECT key, value FROM settings`;
      const out = {};
      for (const r of rows) out[r.key] = r.value;
      return json({ ok: true, settings: out });
    }

    if (request.method === 'POST') {
      const body = await request.json();
      const actor = body.actor || 'unknown';
      const incoming = body.settings || {};

      // Defense-in-depth cap on any single setting value. Most settings are
      // short strings; `kpi_targets` is a JSON blob and needs more room.
      const DEFAULT_LIMIT = 500;
      const LARGE_VALUE_KEYS = new Set(['kpi_targets', 'hidden_kpis', 'kpi_thresholds', 'kpi_scopes', 'kpi_rounding']);
      const LARGE_LIMIT = 8000;

      const before = await sql`SELECT key, value FROM settings`;
      const beforeMap = Object.fromEntries(before.map(r => [r.key, r.value]));

      for (const [key, rawValue] of Object.entries(incoming)) {
        const cleanKey = String(key || '').trim().slice(0, 80);
        if (!cleanKey) continue;
        const limit = LARGE_VALUE_KEYS.has(cleanKey) ? LARGE_LIMIT : DEFAULT_LIMIT;
        const value = String(rawValue == null ? '' : rawValue).trim().slice(0, limit);

        await sql`
          INSERT INTO settings (key, value) VALUES (${cleanKey}, ${value})
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;

        if (beforeMap[cleanKey] !== value) {
          await sql`
            INSERT INTO audit_log (actor, action, entity, before_val, after_val)
            VALUES (${actor}, 'settings.change', ${cleanKey},
                    ${JSON.stringify({ value: beforeMap[cleanKey] || null })}::jsonb,
                    ${JSON.stringify({ value })}::jsonb)`;
        }
      }

      return json({ ok: true });
    }

    return json({ ok: false, error: 'Method not allowed' }, 405);
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: err.message }, 500);
  }
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

export const config = { path: '/api/settings' };
