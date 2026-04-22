// netlify/functions/sections.js
// Section management CRUD

import { neon } from '@netlify/neon';
const sql = neon();

const ALLOWED_FIELDS = [
  'display_number','display_name','tagline','owner_badge',
  'leading_kpi_name','leading_display_label','leading_description',
  'sort_order','active'
];

// Defense-in-depth input caps (mirrors admin UI).
const LIMITS = {
  section_key: 80,
  display_number: 3,
  display_name: 80,
  tagline: 200,
  owner_badge: 100,
  leading_kpi_name: 100,
  leading_display_label: 80,
  leading_description: 200,
};

function cleanString(v, max) {
  if (v == null) return '';
  return String(v).trim().slice(0, max);
}

// display_number must be digits only (01, 02, 10, ...). Strip anything else.
function cleanDisplayNumber(v) {
  return String(v == null ? '' : v).trim().replace(/[^0-9]/g, '').slice(0, LIMITS.display_number);
}

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

      // Validate + normalize all rows up front. Reject the whole batch on
      // any error — better than half-saving.
      const cleaned = [];
      const seenKeys = new Set();
      for (let i = 0; i < incoming.length; i++) {
        const raw = incoming[i] || {};
        const key = cleanString(raw.section_key, LIMITS.section_key);
        if (!key) return json({ ok: false, error: `Section data key is required (row ${i + 1})` }, 400);
        if (seenKeys.has(key)) return json({ ok: false, error: `Duplicate section key: "${key}"` }, 400);
        seenKeys.add(key);

        cleaned.push({
          section_key: key,
          display_number: cleanDisplayNumber(raw.display_number) || '01',
          display_name: cleanString(raw.display_name, LIMITS.display_name) || key,
          tagline: cleanString(raw.tagline, LIMITS.tagline),
          owner_badge: cleanString(raw.owner_badge, LIMITS.owner_badge),
          leading_kpi_name: cleanString(raw.leading_kpi_name, LIMITS.leading_kpi_name) || null,
          leading_display_label: cleanString(raw.leading_display_label, LIMITS.leading_display_label),
          leading_description: cleanString(raw.leading_description, LIMITS.leading_description),
        });
      }

      const current = await sql`SELECT * FROM sections WHERE active = TRUE`;
      const currentByKey = Object.fromEntries(current.map(r => [r.section_key, r]));
      const incomingByKey = Object.fromEntries(cleaned.map(r => [r.section_key, r]));

      for (let i = 0; i < cleaned.length; i++) {
        const s = cleaned[i];
        const before = currentByKey[s.section_key] || null;
        await sql`
          INSERT INTO sections (
            section_key, display_number, display_name, tagline, owner_badge,
            leading_kpi_name, leading_display_label, leading_description, sort_order
          ) VALUES (
            ${s.section_key}, ${s.display_number}, ${s.display_name},
            ${s.tagline}, ${s.owner_badge},
            ${s.leading_kpi_name}, ${s.leading_display_label}, ${s.leading_description},
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

      return json({ ok: true, count: cleaned.length });
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
