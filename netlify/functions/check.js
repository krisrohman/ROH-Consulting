exports.handler = async function(event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const { food } = JSON.parse(event.body);

    const prompt = `You are a travel medicine expert with knowledge of CDC Travelers' Health and WHO food safety guidelines.

A traveler is in Mexico and wants to know if "${food}" is safe to eat or drink.

Based on CDC and WHO guidance, give an honest assessment. Reply ONLY with raw JSON, no markdown:
{"score":<1-10>,"verdict":"SAFE or CAUTION or AVOID","headline":"one honest sentence","why":"1-2 sentences based on CDC/WHO guidance","tip":"one practical tip","emoji":"<relevant emoji>","sources":["list which of CDC Travelers Health or WHO Food Safety applies"]}`;

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
