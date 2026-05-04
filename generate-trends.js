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

  const prompt = `Today is ${today}.

You are a senior design and technology researcher. Search the web and find the 5 most notable trends or developments from the past 48 hours across these areas:
- UX & UI design
- Product design
- AI & new technology
- Design tools (especially Figma and similar)

Respond using EXACTLY this format for each trend, with no extra symbols, asterisks, or hashtags:

---TREND---
TITLE: Write the trend title here
CATEGORY: UX/UI Design
WHY_IT_MATTERS: Write 2-3 sentences here explaining significance for designers and product teams.
WHATS_HAPPENING: Write a full paragraph here with all the key details, context, and what changed or was announced.
SOURCE_NAME: Name of the publication or website
SOURCE_URL: https://full-url-here.com
---END---

Repeat this block 5 times, once per trend.

Then at the very end write:
SIGNAL: One sentence summarising the overarching theme across today's trends.

Important rules:
- CATEGORY must be one of: UX/UI Design, Product Design, AI & Tech, Design Tools
- Do not use any markdown, asterisks, hashtags, or bullet points anywhere
- Fill in ALL fields completely, especially WHATS_HAPPENING — never leave it short
- SOURCE_URL must be a full working URL starting with https://`;

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
  return textBlock.text;
}

// ─── Step 2: Parse into HTML ───────────────────────────────────────────────────
function parseToHtml(text) {
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  // Extract trend blocks
  const trendBlocks = [...text.matchAll(/---TREND---([\s\S]*?)---END---/g)];

  // Extract signal
  const signalMatch = text.match(/SIGNAL:\s*(.+)/);
  const signal = signalMatch ? signalMatch[1].trim() : "";

  const categoryColors = {
    "UX/UI Design": "#4f46e5",
    "Product Design": "#7c3aed",
    "AI & Tech": "#0891b2",
    "Design Tools": "#059669",
  };

  const getField = (block, field) => {
    const match = block.match(new RegExp(`${field}:\\s*([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`));
    return match ? match[1].trim() : "";
  };

  let trendsHtml = "";

  trendBlocks.forEach((match, index) => {
    const block = match[1];
    const title = getField(block, "TITLE");
    const category = getField(block, "CATEGORY");
    const whyItMatters = getField(block, "WHY_IT_MATTERS");
    const whatsHappening = getField(block, "WHATS_HAPPENING");
    const sourceName = getField(block, "SOURCE_NAME");
    const sourceUrl = getField(block, "SOURCE_URL");

    const tagColor = categoryColors[category] || "#4f46e5";

    trendsHtml += `
      <tr>
        <td style="padding:0 0 28px 0;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:#ffffff;border:1px solid #e5e7eb;border-left:4px solid ${tagColor};border-radius:8px;padding:24px 28px;">

                <p style="margin:0 0 12px 0;">
                  <span style="background:${tagColor};color:#ffffff;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;padding:3px 10px;border-radius:20px;">${category}</span>
                </p>

                <h2 style="margin:0 0 18px 0;color:#111827;font-size:19px;font-weight:700;line-height:1.4;">${index + 1}. ${title}</h2>

                <p style="margin:0 0 4px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#9ca3af;">Why it matters</p>
                <p style="margin:0 0 18px 0;color:#374151;font-size:15px;line-height:1.75;">${whyItMatters}</p>

                <p style="margin:0 0 4px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#9ca3af;">What's happening</p>
                <p style="margin:0 0 18px 0;color:#374151;font-size:15px;line-height:1.75;">${whatsHappening}</p>

                <p style="margin:0;font-size:13px;color:#6b7280;">
                  Source: <a href="${sourceUrl}" style="color:${tagColor};text-decoration:underline;">${sourceName}</a>
                </p>

              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  });

  const signalHtml = signal ? `
      <tr>
        <td style="padding:4px 0 0 0;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);border-radius:10px;padding:24px 28px;">
                <p style="margin:0 0 6px 0;color:rgba(255,255,255,0.65);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Today's signal</p>
                <p style="margin:0;color:#ffffff;font-size:16px;line-height:1.65;font-style:italic;">"${signal}"</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>` : "";

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
          <td style="background:#f3f4f6;padding:28px 28px 8px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              ${trendsHtml}
              ${signalHtml}
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
async function sendEmail(htmlContent, plainText) {
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long", month: "long", day: "numeric",
  });

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
  const rawText = await fetchTrends();
  console.log("Raw output from Claude:");
  console.log(rawText);

  console.log("Sending email via Resend...");
  const html = parseToHtml(rawText);
  const result = await sendEmail(html, rawText);

  if (result.id) {
    console.log(`Email sent! ID: ${result.id}`);
  } else {
    console.error("Email failed:", JSON.stringify(result, null, 2));
    process.exit(1);
  }
})();
