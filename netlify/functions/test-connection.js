// netlify/functions/test-connection.js
// Pings the Apps Script URL and reports back whether it's reachable.
// Used by the admin page's "Test connection" button to avoid browser CORS.

const FALLBACK_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbzlDHNo24PBsvjmF1zVUpHDRjcMkxIfDuaMYb1TkHVvG7otz9fPvIKYMvQFRuI7I0DO/exec';

export default async (request) => {
  const urlObj = new URL(request.url);
  const testUrl = urlObj.searchParams.get('url') ||
                  process.env.APPS_SCRIPT_URL ||
                  FALLBACK_APPS_SCRIPT_URL;

  try {
    const t0 = Date.now();
    // Cache-bust the Apps Script URL so Google's edge doesn't serve a stale
    // response. Same as dashboard.js.
    const bustUrl = testUrl + (testUrl.includes('?') ? '&' : '?') + 't=' + t0;
    const res = await fetch(bustUrl, { method: 'GET', cache: 'no-store' });
    const text = await res.text();
    const elapsed = Date.now() - t0;

    let parsed = null;
    try { parsed = JSON.parse(text); } catch (_) { /* non-JSON response */ }

    const ok = res.ok && parsed && parsed.ok === true;

    return json({
      ok,
      statusCode: res.status,
      elapsed_ms: elapsed,
      has_weekly: !!(parsed && parsed.weekly && parsed.weekly.rows),
      weekly_row_count: (parsed && parsed.weekly && parsed.weekly.rows) ? parsed.weekly.rows.length : 0,
      synced_at: parsed && parsed.syncedAt,
      error: parsed && parsed.error,
      preview: text.slice(0, 200)
    });
  } catch (err) {
    return json({ ok: false, error: err.message });
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

export const config = { path: '/api/test-connection' };
