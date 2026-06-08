const https = require("https");

// ─── Config ───────────────────────────────────────────────────────────────────
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TO_EMAIL = process.env.TO_EMAIL;
const FROM_EMAIL = "trends@resend.dev"; // Resend's free shared domain for testing

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

## [Trend Title]
**Category:** [UX/UI Design | Product Design | AI & Tech | Design Tools]
**Why it matters:** 2–3 sentences explaining the significance for designers and product teams.
**What's happening:** A paragraph with the key details, context, and what changed or was announced.
**Read more:** [Source name](URL)

---

After all 5 trends, add a short closing section:
## This week's signal
One sentence summarising the overarching theme you see across today's trends.

Keep the tone sharp, curious, and professional — like a well-informed colleague sharing what they found this morning.`;

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

  // Extract the final text response from the content blocks
  const textBlock = response.content?.find((block) => block.type === "text");
  if (!textBlock) throw new Error("No text response from Claude");
  return textBlock.text;
}

// ─── Step 2: Convert markdown to clean HTML email ─────────────────────────────
function markdownToHtml(md) {
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const body = md
    // H2 headings
    .replace(
      /^## (.+)$/gm,
      '<h2 style="color:#1a1a1a;font-size:20px;margin:32px 0 8px;">$1</h2>'
    )
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Links
    .replace(
      /\[(.+?)\]\((.+?)\)/g,
      '<a href="$2" style="color:#4f46e5;text-decoration:none;">$1</a>'
    )
    // Horizontal rule
    .replace(/^---$/gm, '<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">')
    // Paragraphs
    .replace(/\n\n/g, "</p><p>")
    .replace(/^(?!<)(.+)$/gm, "$1");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);padding:40px 40px 32px;">
            <p style="margin:0 0 4px;color:rgba(255,255,255,0.7);font-size:13px;text-transform:uppercase;letter-spacing:1px;">Daily Trends Digest</p>
            <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;line-height:1.2;">Design & Tech Radar</h1>
            <p style="margin:12px 0 0;color:rgba(255,255,255,0.8);font-size:14px;">${today}</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px;color:#374151;font-size:16px;line-height:1.7;">
            <p>${body}</p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:24px 40px 32px;border-top:1px solid #f3f4f6;">
            <p style="margin:0;color:#9ca3af;font-size:13px;text-align:center;">
              Generated by your personal AI trends agent · Powered by Claude
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Step 3: Send via Resend ───────────────────────────────────────────────────
async function sendEmail(htmlContent, markdownContent) {
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
      subject: `🎨 Design & Tech Radar — ${today}`,
      html: htmlContent,
      text: markdownContent, // plain text fallback
    }
  );

  return result;
}

// ─── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log("🔍 Fetching today's trends from Claude...");
  const markdown = await fetchTrends();
  console.log("✅ Trends generated successfully");

  console.log("📧 Sending email via Resend...");
  const html = markdownToHtml(markdown);
  const result = await sendEmail(html, markdown);

  if (result.id) {
    console.log(`✅ Email sent! ID: ${result.id}`);
  } else {
    console.error("❌ Email failed:", JSON.stringify(result, null, 2));
    process.exit(1);
  }
})();
