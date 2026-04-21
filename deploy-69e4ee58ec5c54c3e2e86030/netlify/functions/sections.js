// netlify/functions/sections.js
// Section management CRUD

import { neon } from '@netlify/neon';
const sql = neon();

const ALLOWED_FIELDS = [
  'display_number','display_name','tagline','owner_badge',
  'leading_kpi_name','leading_display_label','leading_description',
  'sort_order','active'
];

export default async (request) => {
  const method = request.method;
  const url = new URL(request.url);

  try {
    if (method === 'GET') {
      const rows = await sql`
        SELECT section_key, display_number, display_name, tagline, owner_badge,
               leading_kpi_name, leading_display_label, leading_description,
               sort_order
        FROM sections
        WHERE active = TRUE
        ORDER BY sort_order ASC`;
      return json({ ok: true, sections: rows });
    }

    if (method === 'POST') {
      const body = await request.json();
      const actor = body.actor || 'unknown';
      const incoming = body.sections || [];

      const current = await sql`SELECT * FROM sections WHERE active = TRUE`;
      const currentByKey = Object.fromEntries(current.map(r => [r.section_key, r]));
      const incomingByKey = Object.fromEntries(incoming.map(r => [r.section_key, r]));

      for (let i = 0; i < incoming.length; i++) {
        const s = incoming[i];
        const before = currentByKey[s.section_key] || null;
        await sql`
          INSERT INTO sections (
            section_key, display_number, display_name, tagline, owner_badge,
            leading_kpi_name, leading_display_label, leading_description, sort_order
          ) VALUES (
            ${s.section_key}, ${s.display_number || '01'}, ${s.display_name || s.section_key},
            ${s.tagline || ''}, ${s.owner_badge || ''},
            ${s.leading_kpi_name || null}, ${s.leading_display_label || ''}, ${s.leading_description || ''},
            ${i * 10}
          )
          ON CONFLICT (section_key) DO UPDATE SET
            display_number = EXCLUDED.display_number,
            display_name = EXCLUDED.display_name,
            tagline = EXCLUDED.tagline,
            owner_badge = EXCLUDED.owner_badge,
            leading_kpi_name = EXCLUDED.leading_kpi_name,
            leading_display_label = EXCLUDED.leading_display_label,
            leading_description = EXCLUDED.leading_description,
            sort_order = EXCLUDED.sort_order,
            active = TRUE`;

        if (!before) {
          await writeAudit(actor, 'section.add', s.section_key, null, s);
        } else if (JSON.stringify(before) !== JSON.stringify({ ...before, ...s })) {
          await writeAudit(actor, 'section.update', s.section_key, before, s);
        }
      }

      for (const key of Object.keys(currentByKey)) {
        if (!incomingByKey[key]) {
          await sql`UPDATE sections SET active = FALSE WHERE section_key = ${key}`;
          await writeAudit(actor, 'section.remove', key, currentByKey[key], null);
        }
      }

      return json({ ok: true, count: incoming.length });
    }

    if (method === 'PATCH') {
      const body = await request.json();
      const { section_key, actor, ...fields } = body;
      const before = await sql`SELECT * FROM sections WHERE section_key = ${section_key}`;

      const updates = [];
      const values = [];
      for (const [key, val] of Object.entries(fields)) {
        if (ALLOWED_FIELDS.includes(key)) {
          updates.push(`${key} = $${updates.length + 1}`);
          values.push(val);
        }
      }
      if (!updates.length) return json({ ok: false, error: 'No valid fields' }, 400);

      await sql(
        `UPDATE sections SET ${updates.join(', ')} WHERE section_key = $${updates.length + 1}`,
        [...values, section_key]
      );
      await writeAudit(actor || 'unknown', 'section.update', section_key, before[0] || null, fields);
      return json({ ok: true });
    }

    if (method === 'DELETE') {
      const key = url.searchParams.get('key');
      const actor = url.searchParams.get('actor') || 'unknown';
      if (!key) return json({ ok: false, error: 'Missing key' }, 400);

      const before = await sql`SELECT * FROM sections WHERE section_key = ${key}`;
      await sql`UPDATE sections SET active = FALSE WHERE section_key = ${key}`;
      await writeAudit(actor, 'section.remove', key, before[0] || null, null);
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

export const config = { path: '/api/sections' };
