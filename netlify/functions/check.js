exports.handler = async function(event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const { food } = JSON.parse(event.body);

    const prompt = `You are a travel medicine expert. A tourist is visiting Mexico City or a popular Mexican resort town and wants to know if "${food}" is safe.

Assume they are eating at normal tourist restaurants and shops, not remote villages. Use CDC and WHO traveler guidelines.

Be practical and realistic — most food at established restaurants is fine. Only flag genuine risks.

Reply with ONLY raw JSON:
{"verdict":"SAFE or CAUTION or AVOID","headline":"one sentence","why":"1-2 sentences","tip":"one tip","emoji":"emoji","sources":["CDC Travelers Health or WHO Food Safety"]}

SAFE = fine at reputable places
CAUTION = use judgment about where you get it
AVOID = genuinely skip this`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": process.env.ANTHROPIC_API_KEY
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 350,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const raw = await response.text();
    if (!response.ok) return { statusCode: 500, headers: {"Content-Type":"application/json"}, body: JSON.stringify({ error: "HTTP " + response.status + ": " + raw }) };

    const data = JSON.parse(raw);
    if (data.type === "error") return { statusCode: 500, headers: {"Content-Type":"application/json"}, body: JSON.stringify({ error: data.error.message }) };

    const text = (data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("");
    const s = text.indexOf("{"), e = text.lastIndexOf("}");
    if (s < 0) return { statusCode: 500, headers: {"Content-Type":"application/json"}, body: JSON.stringify({ error: "RAW: " + raw }) };

    return { statusCode: 200, headers: {"Content-Type":"application/json"}, body: text.slice(s, e+1) };

  } catch(e) {
    return { statusCode: 500, headers: {"Content-Type":"application/json"}, body: JSON.stringify({ error: e.message }) };
  }
};
