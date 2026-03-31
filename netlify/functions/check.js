exports.handler = async function(event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const { food } = JSON.parse(event.body);

    const prompt = `You are a practical travel medicine expert. A tourist is at a normal restaurant or shop in Mexico City or a popular resort town like Sayulita or Cancun.

They want to know: is "${food}" safe?

Rules:
- If CDC/WHO would consider it safe at an established restaurant or shop, say SAFE
- Only say CAUTION if the traveler genuinely needs to be selective about WHERE they get it
- Only say AVOID if CDC/WHO explicitly advise travelers to skip it entirely (tap water, raw shellfish, etc)
- Do NOT say CAUTION just because something theoretically could be risky anywhere in the world

Reply with ONLY raw JSON:
{"verdict":"SAFE or CAUTION or AVOID","headline":"one direct sentence","why":"1-2 sentences","tip":"one tip","emoji":"emoji","sources":["CDC Travelers Health or WHO Food Safety"]}`;

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
