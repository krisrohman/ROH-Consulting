// netlify/functions/users.js
// ============================================================
// User access management (Access & Security panel)
//
//   GET    /api/users                          → list all users
//   POST   /api/users                          → invite (body: { email, name, role, actor })
//   PATCH  /api/users                          → change role (body: { email, role, actor })
//   DELETE /api/users?email=X&actor=Y          → remove
// ============================================================

import { neon } from '@netlify/neon';
const sql = neon();

const VALID_ROLES = ['owner', 'admin', 'viewer'];

export default async (request) => {
  const method = request.method;
  const url = new URL(request.url);

  try {
    if (method === 'GET') {
      const rows = await sql`SELECT email, name, role, created_at FROM users ORDER BY
        CASE role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END,
        email ASC`;
      return json({ ok: true, users: rows });
    }

    if (method === 'POST') {
      const body = await request.json();
      const { email, name, role, actor } = body;

      if (!email || !email.includes('@')) return json({ ok: false, error: 'Invalid email' }, 400);
      if (!VALID_ROLES.includes(role)) return json({ ok: false, error: 'Invalid role' }, 400);

      const normalized = email.toLowerCase().trim();

      await sql`
        INSERT INTO users (email, name, role)
        VALUES (${normalized}, ${name || normalized.split('@')[0]}, ${role})
        ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role`;

      await writeAudit(actor || 'unknown', 'user.invite', normalized, null, { role, name });

      return json({ ok: true });
    }

    if (method === 'PATCH') {
      const body = await request.json();
      const { email, role, actor } = body;

      if (!VALID_ROLES.includes(role)) return json({ ok: false, error: 'Invalid role' }, 400);

      const before = await sql`SELECT role FROM users WHERE email = ${email}`;
      await sql`UPDATE users SET role = ${role} WHERE email = ${email}`;
      await writeAudit(actor || 'unknown', 'user.role.change', email,
                       { role: before[0]?.role || null },
                       { role });
      return json({ ok: true });
    }

    if (method === 'DELETE') {
      const email = url.searchParams.get('email');
      const actor = url.searchParams.get('actor') || 'unknown';
      if (!email) return json({ ok: false, error: 'Missing email' }, 400);

      const before = await sql`SELECT email, name, role FROM users WHERE email = ${email}`;
      await sql`DELETE FROM users WHERE email = ${email}`;
      await writeAudit(actor, 'user.remove', email, before[0] || null, null);
      return json({ ok: true });
    }

    return json({ ok: false, error: 'Method not allowed' }, 405);
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: err.message }, 500);
  }
};

async function writeAudit(actor, action, entity, before, after) {
  await sql`
    INSERT INTO audit_log (actor, action, entity, before_val, after_val)
    VALUES (${actor}, ${action}, ${entity}, ${before}::jsonb, ${after}::jsonb)`;
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

export const config = { path: '/api/users' };
