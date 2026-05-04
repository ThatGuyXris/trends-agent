const https = require("https");

// ─── Config ───────────────────────────────────────────────────────────────────
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TO_EMAIL = process.env.TO_EMAIL;
const FROM_EMAIL = "trends@resend.dev";

// ─── Helper: HTTPS POST ────────────────────────────────────────────────────────
function post(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          ...headers,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try { resolve(JSON.parse(raw)); }
          catch { resolve(raw); }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ─── Step 1: Call Claude with web search ──────────────────────────────────────
async function fetchTrends() {
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const prompt = `Today is ${today}. You are a design and technology researcher.

Search the web and find 5 notable trends from the past 48 hours in UX/UI design, product design, AI, or design tools like Figma.

Write your response as a JSON array. Return ONLY the JSON, no other text before or after it.

Use this exact structure:
[
  {
    "title": "Trend title here",
    "category": "Design Tools",
    "why_it_matters": "2-3 sentences on why this matters for designers and product teams.",
    "whats_happening": "A full paragraph describing what happened, what was announced, and the key context.",
    "source_name": "Publication or website name",
    "source_url": "https://full-url.com"
  }
]

Category must be one of: UX/UI Design, Product Design, AI & Tech, Design Tools
Return valid JSON only. No markdown, no backticks, no explanation.`;

  const response = await post(
    "api.anthropic.com",
    "/v1/messages",
    {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    {
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: prompt }],
    }
  );

  const textBlock = response.content?.find((block) => block.type === "text");
  if (!textBlock) throw new Error("No text response from Claude");

  console.log("Raw Claude output:");
  console.log(textBlock.text);

  // Strip markdown code fences if present
  const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

// ─── Step 2: Build HTML email from JSON ───────────────────────────────────────
function buildHtml(trends) {
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const categoryColors = {
    "UX/UI Design": "#4f46e5",
    "Product Design": "#7c3aed",
    "AI & Tech": "#0891b2",
    "Design Tools": "#059669",
  };

  const trendsHtml = trends.map((trend, index) => {
    const color = categoryColors[trend.category] || "#4f46e5";
    return `
      <tr>
        <td style="padding:0 0 24px 0;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:#ffffff;border:1px solid #e5e7eb;border-left:4px solid ${color};border-radius:8px;padding:24px 28px;">

                <p style="margin:0 0 12px 0;">
                  <span style="background:${color};color:#ffffff;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;padding:3px 10px;border-radius:20px;">${trend.category}</span>
                </p>

                <h2 style="margin:0 0 20px 0;color:#111827;font-size:18px;font-weight:700;line-height:1.4;">${index + 1}. ${trend.title}</h2>

                <p style="margin:0 0 4px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#9ca3af;">Why it matters</p>
                <p style="margin:0 0 18px 0;color:#374151;font-size:15px;line-height:1.75;">${trend.why_it_matters}</p>

                <p style="margin:0 0 4px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#9ca3af;">What's happening</p>
                <p style="margin:0 0 18px 0;color:#374151;font-size:15px;line-height:1.75;">${trend.whats_happening}</p>

                <p style="margin:0;font-size:13px;color:#6b7280;">
                  Source: <a href="${trend.source_url}" style="color:${color};text-decoration:underline;">${trend.source_name}</a>
                </p>

              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 16px;">
    <tr><td align="center">
      <table width="620" cellpadding="0" cellspacing="0">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);border-radius:12px 12px 0 0;padding:36px 40px 32px;">
            <p style="margin:0 0 6px;color:rgba(255,255,255,0.65);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;">Daily Trends Digest</p>
            <h1 style="margin:0 0 8px;color:#ffffff;font-size:30px;font-weight:800;line-height:1.1;">Design & Tech Radar</h1>
            <p style="margin:0;color:rgba(255,255,255,0.75);font-size:14px;">${today}</p>
          </td>
        </tr>

        <!-- Intro -->
        <tr>
          <td style="background:#eef2ff;padding:12px 40px;">
            <p style="margin:0;color:#4338ca;font-size:14px;">5 trends across UX/UI, Product Design, AI & Design Tools — curated by your AI agent.</p>
          </td>
        </tr>

        <!-- Trends -->
        <tr>
          <td style="background:#f3f4f6;padding:24px 24px 4px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              ${trendsHtml}
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;border-radius:0 0 12px 12px;padding:20px 40px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">Generated by your personal AI trends agent · Powered by Claude</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Step 3: Send via Resend ───────────────────────────────────────────────────
async function sendEmail(htmlContent, trends) {
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long", month: "long", day: "numeric",
  });

  // Plain text fallback
  const plainText = trends.map((t, i) =>
    `${i + 1}. ${t.title}\n${t.category}\n\nWhy it matters: ${t.why_it_matters}\n\nWhat's happening: ${t.whats_happening}\n\nSource: ${t.source_name} - ${t.source_url}`
  ).join("\n\n---\n\n");

  const result = await post(
    "api.resend.com",
    "/emails",
    { Authorization: `Bearer ${RESEND_API_KEY}` },
    {
      from: FROM_EMAIL,
      to: TO_EMAIL,
      subject: `Design & Tech Radar — ${today}`,
      html: htmlContent,
      text: plainText,
    }
  );

  return result;
}

// ─── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log("Fetching today's trends from Claude...");
  const trends = await fetchTrends();
  console.log(`Parsed ${trends.length} trends successfully`);

  console.log("Sending email via Resend...");
  const html = buildHtml(trends);
  const result = await sendEmail(html, trends);

  if (result.id) {
    console.log(`Email sent! ID: ${result.id}`);
  } else {
    console.error("Email failed:", JSON.stringify(result, null, 2));
    process.exit(1);
  }
})();
