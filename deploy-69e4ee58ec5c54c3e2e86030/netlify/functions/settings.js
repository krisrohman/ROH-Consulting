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

      const before = await sql`SELECT key, value FROM settings`;
      const beforeMap = Object.fromEntries(before.map(r => [r.key, r.value]));

      for (const [key, value] of Object.entries(incoming)) {
        await sql`
          INSERT INTO settings (key, value) VALUES (${key}, ${String(value)})
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;

        if (beforeMap[key] !== String(value)) {
          await sql`
            INSERT INTO audit_log (actor, action, entity, before_val, after_val)
            VALUES (${actor}, 'settings.change', ${key},
                    ${JSON.stringify({ value: beforeMap[key] || null })}::jsonb,
                    ${JSON.stringify({ value: String(value) })}::jsonb)`;
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
