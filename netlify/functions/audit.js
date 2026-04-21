// netlify/functions/audit.js
// ============================================================
// GET /api/audit?limit=50
//   → returns recent audit log entries
// ============================================================

import { neon } from '@netlify/neon';
const sql = neon();

export default async (request) => {
  try {
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);

    const rows = await sql`
      SELECT id, actor, action, entity, before_val, after_val, created_at
      FROM audit_log
      ORDER BY created_at DESC
      LIMIT ${limit}`;

    return json({ ok: true, entries: rows });
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

export const config = { path: '/api/audit' };
