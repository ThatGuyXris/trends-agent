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
          try {
            resolve(JSON.parse(raw));
          } catch {
            resolve(raw);
          }
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
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const prompt = `Today is ${today}.

You are a senior design and technology researcher. Search the web and find the 5 most notable trends or developments from the past 48 hours across these areas:
- UX & UI design
- Product design
- AI & new technology
- Design tools (especially Figma and similar)

For each trend, write a full, engaging write-up in this exact structure:

TREND: [Trend Title]
CATEGORY: [UX/UI Design | Product Design | AI & Tech | Design Tools]
WHY IT MATTERS: 2-3 sentences explaining the significance for designers and product teams.
WHAT IS HAPPENING: A full paragraph with the key details, context, and what changed or was announced.
READ MORE: [Source name] [URL]
END

After all 5 trends, add:
SIGNAL: One sentence summarising the overarching theme you see across today's trends.

Use exactly these labels (TREND, CATEGORY, WHY IT MATTERS, WHAT IS HAPPENING, READ MORE, END, SIGNAL) so the email formats correctly. Do not use markdown symbols like # or **.`;

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

// ─── Step 2: Parse structured text into HTML ──────────────────────────────────
function parseToHtml(text) {
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const blocks = text.split(/(?=TREND:)/g).filter(b => b.trim());
  const signalMatch = text.match(/SIGNAL:\s*(.+)/);
  const signal = signalMatch ? signalMatch[1].trim() : "";

  let trendsHtml = "";

  blocks.forEach((block, index) => {
    if (!block.startsWith("TREND:")) return;

    const getValue = (label) => {
      const regex = new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n[A-Z ]+:|END|$)`);
      const match = block.match(regex);
      return match ? match[1].trim() : "";
    };

    const title = getValue("TREND");
    const category = getValue("CATEGORY");
    const whyItMatters = getValue("WHY IT MATTERS");
    const whatIsHappening = getValue("WHAT IS HAPPENING");
    const readMoreRaw = getValue("READ MORE");

    const urlMatch = readMoreRaw.match(/(https?:\/\/\S+)/);
    const url = urlMatch ? urlMatch[1] : "#";
    const sourceName = readMoreRaw.replace(url, "").trim() || "Read more";

    const categoryColors = {
      "UX/UI Design": "#4f46e5",
      "Product Design": "#7c3aed",
      "AI & Tech": "#0891b2",
      "Design Tools": "#059669",
    };
    const tagColor = categoryColors[category] || "#4f46e5";

    trendsHtml += `
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
        <tr>
          <td style="background:#f8f7ff;border-left:4px solid ${tagColor};border-radius:0 8px 8px 0;padding:24px 28px;">
            <p style="margin:0 0 10px;"><span style="background:${tagColor};color:#fff;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;padding:3px 10px;border-radius:20px;">${category}</span></p>
            <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:20px;font-weight:700;line-height:1.3;">${index}. ${title}</h2>
            <p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;">Why it matters</p>
            <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.7;">${whyItMatters}</p>
            <p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;">What's happening</p>
            <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.7;">${whatIsHappening}</p>
            <a href="${url}" style="display:inline-block;background:#1a1a1a;color:#ffffff;font-size:13px;font-weight:600;text-decoration:none;padding:8px 18px;border-radius:6px;">Read more at ${sourceName}</a>
          </td>
        </tr>
      </table>`;
  });

  const signalHtml = signal ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">
      <tr>
        <td style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);border-radius:10px;padding:24px 28px;">
          <p style="margin:0 0 6px;color:rgba(255,255,255,0.7);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">This week's signal</p>
          <p style="margin:0;color:#ffffff;font-size:16px;line-height:1.6;font-style:italic;">"${signal}"</p>
        </td>
      </tr>
    </table>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 16px;">
    <tr><td align="center">
      <table width="620" cellpadding="0" cellspacing="0">
        <tr>
          <td style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);border-radius:12px 12px 0 0;padding:40px 40px 36px;">
            <p style="margin:0 0 6px;color:rgba(255,255,255,0.65);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;">Daily Trends Digest</p>
            <h1 style="margin:0 0 8px;color:#ffffff;font-size:32px;font-weight:800;line-height:1.1;">Design & Tech Radar</h1>
            <p style="margin:0;color:rgba(255,255,255,0.75);font-size:15px;">${today}</p>
          </td>
        </tr>
        <tr>
          <td style="background:#eef2ff;padding:14px 40px;">
            <p style="margin:0;color:#4338ca;font-size:14px;">5 trends across UX/UI, Product Design, AI & Design Tools — curated by your AI agent.</p>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:36px 40px 28px;">
            ${trendsHtml}
            ${signalHtml}
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;border-radius:0 0 12px 12px;padding:20px 40px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;color:#9ca3af;font-size:13px;text-align:center;">Generated by your personal AI trends agent · Powered by Claude</p>
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
    weekday: "long",
    month: "long",
    day: "numeric",
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
  console.log("Trends generated successfully");
  console.log("--- RAW OUTPUT ---");
  console.log(rawText);
  console.log("--- END RAW OUTPUT ---");

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
