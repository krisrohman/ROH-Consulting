exports.handler = async function(event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const { food } = JSON.parse(event.body);

    const prompt = `You are a calm, reassuring travel medicine expert helping a traveler in Mexico.

Be realistic and encouraging — most food at established restaurants and shops is fine. Don't catastrophize normal tourist food.

Scoring guide:
- 9-10: Very safe (bottled drinks, cooked restaurant food, packaged items)
- 7-8: Generally safe with normal care (gelato at a proper shop, cooked street tacos, peelable fruit)
- 5-6: Worth being selective about where you get it (ceviche, fresh juices, salads)
- 3-4: Real risk, most travelers should avoid (raw seafood, tap water ice from unknown source)
- 1-2: Avoid entirely (tap water, raw oysters)

Is "${food}" safe to eat or drink in Mexico?

Reply ONLY with raw JSON, no markdown:
{"score":<1-10>,"verdict":"SAFE or CAUTION or AVOID","headline":"short sentence","why":"1-2 sentences","tip":"one practical tip","emoji":"<relevant emoji>","sources":["CDC Travelers Health or WHO Food Safety"]}

For sources use whichever of CDC Travelers Health or WHO Food Safety actually applies.`;

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
