// netlify/functions/config.js
// ============================================================
// KPI config CRUD (used by the Admin panel)
//
//   GET    /api/config             → list all KPIs (inc. math_type + goal_direction)
//   POST   /api/config             → replace entire KPI list (body: { kpis: [...] })
//   PATCH  /api/config             → update a single KPI
//   DELETE /api/config?name=X      → soft-delete a KPI
// ============================================================

import { neon } from '@netlify/neon';
const sql = neon();

// Defense-in-depth input caps. The admin UI enforces these too,
// but we validate server-side so scripted / malicious clients can't sneak past.
const LIMITS = {
  kpi_name: 100,
  section: 80,
  unit: 20,
  owner: 60,
  department: 80,
  tier: 20,
};

function cleanString(v, max) {
  if (v == null) return '';
  return String(v).trim().slice(0, max);
}

export default async (request) => {
  const method = request.method;
  const url = new URL(request.url);

  try {
    if (method === 'GET') {
      const rows = await sql`
        SELECT kpi_name, section, unit, owner, department, tier, math_type, goal_direction, sort_order
        FROM kpis
        WHERE active = TRUE
        ORDER BY sort_order ASC`;
      return json({ ok: true, kpis: rows });
    }

    if (method === 'POST') {
      const body = await request.json();
      const actor = body.actor || 'unknown';
      const incoming = body.kpis || [];

      // Validate and normalize every KPI before touching the DB. Reject the whole
      // batch if any row is invalid — partial saves are worse than no save.
      const cleaned = [];
      const seenNames = new Set();
      for (let i = 0; i < incoming.length; i++) {
        const raw = incoming[i] || {};
        const name = cleanString(raw.kpi_name, LIMITS.kpi_name);
        if (!name) {
          return json({ ok: false, error: `KPI name is required (row ${i + 1})` }, 400);
        }
        const nameKey = name.toLowerCase();
        if (seenNames.has(nameKey)) {
          return json({ ok: false, error: `Duplicate KPI name: "${name}"` }, 400);
        }
        seenNames.add(nameKey);

        cleaned.push({
          kpi_name: name,
          section: cleanString(raw.section, LIMITS.section),
          unit: cleanString(raw.unit, LIMITS.unit),
          owner: cleanString(raw.owner, LIMITS.owner),
          department: cleanString(raw.department, LIMITS.department),
          tier: cleanString(raw.tier, LIMITS.tier) || 'lagging',
          math_type: ['sum','avg','latest'].includes(raw.math_type) ? raw.math_type : 'avg',
          goal_direction: ['higher','lower'].includes(raw.goal_direction) ? raw.goal_direction : 'higher',
        });
      }

      // Fetch current state for diffing
      const current = await sql`SELECT * FROM kpis WHERE active = TRUE`;
      const currentByName = Object.fromEntries(current.map(r => [r.kpi_name, r]));
      const incomingByName = Object.fromEntries(cleaned.map(r => [r.kpi_name, r]));

      // Upsert incoming rows
      for (let i = 0; i < cleaned.length; i++) {
        const k = cleaned[i];
        const before = currentByName[k.kpi_name] || null;
        const mathType = k.math_type;
        const goalDir  = k.goal_direction;

        await sql`
          INSERT INTO kpis (kpi_name, section, unit, owner, department, tier, math_type, goal_direction, sort_order)
          VALUES (${k.kpi_name}, ${k.section}, ${k.unit}, ${k.owner || ''}, ${k.department || ''}, ${k.tier || 'lagging'}, ${mathType}, ${goalDir}, ${i * 10})
          ON CONFLICT (kpi_name) DO UPDATE SET
            section = EXCLUDED.section,
            unit = EXCLUDED.unit,
            owner = EXCLUDED.owner,
            department = EXCLUDED.department,
            tier = EXCLUDED.tier,
            math_type = EXCLUDED.math_type,
            goal_direction = EXCLUDED.goal_direction,
            sort_order = EXCLUDED.sort_order,
            active = TRUE`;

        if (!before) {
          await writeAudit(actor, 'kpi.add', k.kpi_name, null, k);
        } else if (JSON.stringify(before) !== JSON.stringify({ ...before, ...k })) {
          await writeAudit(actor, 'kpi.update', k.kpi_name, before, k);
        }
      }

      // Soft-delete KPIs that are no longer in the list
      for (const name of Object.keys(currentByName)) {
        if (!incomingByName[name]) {
          await sql`UPDATE kpis SET active = FALSE WHERE kpi_name = ${name}`;
          await writeAudit(actor, 'kpi.remove', name, currentByName[name], null);
        }
      }

      return json({ ok: true, count: cleaned.length });
    }

    if (method === 'PATCH') {
      const body = await request.json();
      const { kpi_name, actor, ...fields } = body;
      const before = await sql`SELECT * FROM kpis WHERE kpi_name = ${kpi_name}`;

      const allowedFields = ['section','unit','owner','department','tier','math_type','goal_direction','sort_order'];
      const updates = [];
      const values = [];
      for (const [key, val] of Object.entries(fields)) {
        if (allowedFields.includes(key)) {
          updates.push(`${key} = $${updates.length + 1}`);
          values.push(val);
        }
      }
      if (!updates.length) return json({ ok: false, error: 'No valid fields' }, 400);

      await sql(
        `UPDATE kpis SET ${updates.join(', ')} WHERE kpi_name = $${updates.length + 1}`,
        [...values, kpi_name]
      );

      await writeAudit(actor || 'unknown', 'kpi.update', kpi_name, before[0] || null, fields);
      return json({ ok: true });
    }

    if (method === 'DELETE') {
      const name = url.searchParams.get('name');
      const actor = url.searchParams.get('actor') || 'unknown';
      if (!name) return json({ ok: false, error: 'Missing name' }, 400);

      const before = await sql`SELECT * FROM kpis WHERE kpi_name = ${name}`;
      await sql`UPDATE kpis SET active = FALSE WHERE kpi_name = ${name}`;
      await writeAudit(actor, 'kpi.remove', name, before[0] || null, null);
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

export const config = { path: '/api/config' };
