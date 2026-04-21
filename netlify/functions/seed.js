// netlify/functions/seed.js
// One-shot seeder for the canonical scorecard copy.
// POST /api/seed  → upserts 5 sections, kpi_targets, and base settings.
// Idempotent: merges with existing values instead of clobbering.

import { neon } from '@netlify/neon';
const sql = neon();

const SECTIONS = [
  { section_key: 'Member growth',     display_number: '01', display_name: 'Member growth',     owner_badge: 'Chris · sales ops',   leading_kpi_name: 'Net recurring members / studio', leading_display_label: 'Net recurring members / studio', leading_description: '+12 by EOY' },
  { section_key: 'Member engagement', display_number: '02', display_name: 'Member engagement', owner_badge: 'Vic · fitness',       leading_kpi_name: 'Workouts per member / week',     leading_display_label: 'Workouts per member, per week',  leading_description: '> 1.5×' },
  { section_key: 'Brand awareness',   display_number: '03', display_name: 'Brand awareness',   owner_badge: 'Christy · marketing', leading_kpi_name: 'PSA leads, YoY change',          leading_display_label: 'PSA leads, year-over-year',      leading_description: '> +0%' },
  { section_key: 'Studio refresh',    display_number: '04', display_name: 'Studio refresh',    owner_badge: 'Scott · finance',     leading_kpi_name: 'Studio remodels',                leading_display_label: 'Capex program completion',       leading_description: '53 total' },
  { section_key: 'People & culture',  display_number: '05', display_name: 'People & culture',  owner_badge: 'Deana · people ops',  leading_kpi_name: 'Glassdoor rating',               leading_display_label: 'Glassdoor rating',               leading_description: '> 3.5' },
];

const KPI_TARGETS = {
  'Net recurring members / studio': '+12 by EOY',
  'Intro conversion':               '> 50%',
  'Lead portal management':         '> 80%',
  'Revenue portal management':      '> 80%',
  'Weekend sales, no zeros':        '100%',
  'Workouts per member / week':     '> 1.5×',
  'HRM usage':                      '> 77%',
  '120-day retention':              '> 75%',
  'Member portal management':       '> 80%',
  'Fitness event achievement':      '4 / month',
  'PSA leads, YoY change':          '> +0%',
  'Cost per booking, Meta':         '< $170',
  'Cost per lead, Meta':            '< $80',
  'Studio remodels':                '21 / year',
  'Treadmill refreshes':            '32 / year',
  'Glassdoor rating':               '> 3.5',
  'Internal promotions':            '> 30 / year',
  'eNPS score':                     '> 40',
  'Voluntary turnover':             '< 20%',
};

// Settings that describe identity / brand / north star — only set if empty.
const BASE_SETTINGS = {
  dashboard_title:       'Austin Fitness Group',
  fiscal_year:           'FY 2026',
  brand_color:           '#D85A30',
  north_star_kpi:        'Net recurring members / studio',
  north_star_headline:   'Net recurring members per studio, on average.',
  north_star_eoy_target: '12',
  hero_tagline:          'High standards. Relentless execution. No shortcuts.',
};

export default async (request) => {
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const actor = body.actor || 'seed';
    const force = body.force === true;
    const report = { sections_added: 0, sections_skipped: 0, settings_added: 0, targets_merged: 0 };

    // 1) Sections — upsert (only fills in rows; doesn't nuke user edits to
    //    an existing row unless force=true).
    for (let i = 0; i < SECTIONS.length; i++) {
      const s = SECTIONS[i];
      const existing = await sql`SELECT section_key FROM sections WHERE section_key = ${s.section_key}`;
      if (existing.length && !force) {
        report.sections_skipped++;
        continue;
      }
      await sql`
        INSERT INTO sections (
          section_key, display_number, display_name, tagline, owner_badge,
          leading_kpi_name, leading_display_label, leading_description, sort_order, active
        ) VALUES (
          ${s.section_key}, ${s.display_number}, ${s.display_name}, ${''}, ${s.owner_badge},
          ${s.leading_kpi_name}, ${s.leading_display_label}, ${s.leading_description}, ${i * 10}, TRUE
        )
        ON CONFLICT (section_key) DO UPDATE SET
          display_number = EXCLUDED.display_number,
          display_name = EXCLUDED.display_name,
          owner_badge = EXCLUDED.owner_badge,
          leading_kpi_name = EXCLUDED.leading_kpi_name,
          leading_display_label = EXCLUDED.leading_display_label,
          leading_description = EXCLUDED.leading_description,
          sort_order = EXCLUDED.sort_order,
          active = TRUE`;
      if (existing.length) {
        await audit(actor, 'section.seed-overwrite', s.section_key, null, s);
      } else {
        await audit(actor, 'section.seed', s.section_key, null, s);
        report.sections_added++;
      }
    }

    // 2) kpi_targets — MERGE with existing, never clobber user edits.
    const curTargetsRow = await sql`SELECT value FROM settings WHERE key = 'kpi_targets'`;
    let curTargets = {};
    try {
      if (curTargetsRow.length) curTargets = JSON.parse(curTargetsRow[0].value) || {};
    } catch (_) { curTargets = {}; }

    for (const [name, target] of Object.entries(KPI_TARGETS)) {
      if (curTargets[name] && !force) continue;
      curTargets[name] = target;
      report.targets_merged++;
    }
    await sql`
      INSERT INTO settings (key, value) VALUES ('kpi_targets', ${JSON.stringify(curTargets)})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;

    // 3) Base settings — only fill in keys that don't exist yet (or force).
    for (const [key, value] of Object.entries(BASE_SETTINGS)) {
      const cur = await sql`SELECT value FROM settings WHERE key = ${key}`;
      if (cur.length && cur[0].value && !force) continue;
      await sql`
        INSERT INTO settings (key, value) VALUES (${key}, ${value})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
      report.settings_added++;
    }

    return json({ ok: true, ...report });
  } catch (err) {
    console.error('Seed failed:', err);
    return json({ ok: false, error: err.message }, 500);
  }
};

async function audit(actor, action, entity, before, after) {
  try {
    await sql`
      INSERT INTO audit_log (actor, action, entity, before_val, after_val)
      VALUES (${actor}, ${action}, ${entity}, ${before}::jsonb, ${after ? JSON.stringify(after) : null}::jsonb)`;
  } catch (_) { /* audit is best-effort */ }
}

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

export const config = { path: '/api/seed' };
