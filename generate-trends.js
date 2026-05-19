const https = require("https");

// ─── Config ───────────────────────────────────────────────────────────────────
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TO_EMAIL = process.env.TO_EMAIL;
const FROM_EMAIL = "trends@resend.dev";
const GH_PAT = process.env.GH_PAT;
const PORTFOLIO_REPO = "ThatGuyXris/christopher-teves.github.io";
const TRENDS_FILE_PATH = "public/trends.json";
const AGENT_REPO = "ThatGuyXris/trends-agent";
const HISTORY_FILE_PATH = "sent-history.json";

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

// ─── Helper: HTTPS GET ────────────────────────────────────────────────────────
function get(hostname, path, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path, method: "GET", headers },
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
    req.end();
  });
}

// ─── Helper: HTTPS PUT ────────────────────────────────────────────────────────
function put(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname,
        path,
        method: "PUT",
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

const ghHeaders = {
  "Authorization": `Bearer ${GH_PAT}`,
  "Accept": "application/vnd.github+json",
  "User-Agent": "trends-agent",
  "X-GitHub-Api-Version": "2022-11-28",
};

// ─── Step 1: Read sent history ─────────────────────────────────────────────────
async function readHistory() {
  try {
    const result = await get(
      "api.github.com",
      `/repos/${AGENT_REPO}/contents/${HISTORY_FILE_PATH}`,
      ghHeaders
    );
    const decoded = Buffer.from(result.content, "base64").toString("utf-8");
    const history = JSON.parse(decoded);
    console.log(`Loaded history: ${history.length} past stories`);
    return { history, sha: result.sha };
  } catch {
    console.log("No history file yet — starting fresh");
    return { history: [], sha: undefined };
  }
}

// ─── Step 2: Save updated history ─────────────────────────────────────────────
async function saveHistory(history, sha) {
  // Keep only the last 90 entries to avoid the file growing indefinitely
  const trimmed = history.slice(-90);
  const content = Buffer.from(JSON.stringify(trimmed, null, 2)).toString("base64");
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long", month: "long", day: "numeric",
  });

  const result = await put(
    "api.github.com",
    `/repos/${AGENT_REPO}/contents/${HISTORY_FILE_PATH}`,
    ghHeaders,
    {
      message: `history: update for ${today}`,
      content,
      ...(sha && { sha }),
    }
  );

  if (result.content) {
    console.log("History saved successfully");
  } else {
    console.error("Failed to save history:", JSON.stringify(result, null, 2));
  }
}

// ─── Step 3: Fetch trends from Claude ─────────────────────────────────────────
async function fetchTrends(history) {
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  // Build the avoid list from history
  const avoidList = history.length > 0
    ? `\n\nIMPORTANT: Do NOT cover any of these stories that have already been sent:\n${history.map(h => `- ${h.title} (${h.url})`).join("\n")}\n\nFind completely fresh stories not on this list.`
    : "";

  const prompt = `Today is ${today}. You are a design and technology researcher curating a digest for a UX/UI designer working in tech.

Search the web and find 5 notable trends or developments from the past 48 hours.

Cover a broad mix from these areas, always keeping UX/UI design, Product Design, and AI as the core — but also drawing from:
- Design tools (Figma, Framer, Adobe, etc.)
- General technology & startups
- Business & product strategy
- Creative & visual culture
- Web development & engineering
- Sustainability & future of work

Aim for variety — no more than 2 stories from the same category.${avoidList}

Respond using ONLY a valid JSON array. No markdown, no backticks, no explanation before or after.

[
  {
    "title": "Trend title here",
    "category": "UX/UI Design",
    "why_it_matters": "2-3 sentences on why this matters for designers and product teams.",
    "whats_happening": "A full paragraph describing what happened, what was announced, and the key context.",
    "source_name": "Publication or website name",
    "source_url": "https://full-url.com",
    "date": "${new Date().toISOString().split("T")[0]}"
  }
]

Category must be one of: UX/UI Design, Product Design, AI & Tech, Design Tools, Technology, Business & Strategy, Creative Culture, Web Development, Sustainability
Return valid JSON only.`;

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

  const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
  const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("No JSON array found in response");
  return JSON.parse(jsonMatch[0]);
}

// ─── Step 4: Push trends.json to portfolio repo ───────────────────────────────
async function pushTrendsToPortfolio(trends) {
  let sha = undefined;
  try {
    const existing = await get(
      "api.github.com",
      `/repos/${PORTFOLIO_REPO}/contents/${TRENDS_FILE_PATH}`,
      ghHeaders
    );
    sha = existing.sha;
    console.log("Existing trends.json found, will update it");
  } catch {
    console.log("No existing trends.json, will create it");
  }

  const content = Buffer.from(JSON.stringify(trends, null, 2)).toString("base64");
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long", month: "long", day: "numeric",
  });

  const result = await put(
    "api.github.com",
    `/repos/${PORTFOLIO_REPO}/contents/${TRENDS_FILE_PATH}`,
    ghHeaders,
    {
      message: `trends: update for ${today}`,
      content,
      ...(sha && { sha }),
    }
  );

  if (result.content) {
    console.log("trends.json pushed to portfolio successfully");
  } else {
    console.error("Failed to push trends.json:", JSON.stringify(result, null, 2));
    throw new Error("GitHub push failed");
  }
}

// ─── Step 5: Build HTML email ─────────────────────────────────────────────────
function buildHtml(trends) {
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const categoryColors = {
    "UX/UI Design":       "#585947",
    "Product Design":     "#7A7B68",
    "AI & Tech":          "#D4A657",
    "Design Tools":       "#AAAB9A",
    "Technology":         "#7A7B68",
    "Business & Strategy":"#585947",
    "Creative Culture":   "#D4A657",
    "Web Development":    "#AAAB9A",
    "Sustainability":     "#585947",
  };

  const trendsHtml = trends.map((trend, index) => {
    const color = categoryColors[trend.category] || "#7A7B68";
    return `
      <tr>
        <td style="padding:0 0 24px 0;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:#F8F7F5;border:1px solid #D4CFBE;border-left:4px solid ${color};padding:28px 32px;">
                <p style="margin:0 0 10px 0;">
                  <span style="font-family:Inter,sans-serif;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:${color};">${trend.category}</span>
                  <span style="font-family:Inter,sans-serif;font-size:10px;font-weight:500;color:#AAAB9A;letter-spacing:1px;float:right;">0${index + 1}</span>
                </p>
                <h2 style="margin:0 0 22px 0;font-family:'Space Grotesk',sans-serif;font-size:20px;font-weight:400;color:#7A7B68;line-height:1.3;">${trend.title}</h2>
                <p style="margin:0 0 4px 0;font-family:Inter,sans-serif;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#AAAB9A;">Why it matters</p>
                <p style="margin:0 0 18px 0;font-family:Inter,sans-serif;font-size:14px;color:#7A7B68;line-height:1.7;">${trend.why_it_matters}</p>
                <p style="margin:0 0 4px 0;font-family:Inter,sans-serif;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#AAAB9A;">What's happening</p>
                <p style="margin:0 0 20px 0;font-family:Inter,sans-serif;font-size:14px;color:#7A7B68;line-height:1.7;">${trend.whats_happening}</p>
                <a href="${trend.source_url}" style="font-family:Inter,sans-serif;font-size:13px;color:#585947;text-decoration:underline;">${trend.source_name} ↗</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#E8E5DB;font-family:Inter,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#E8E5DB;padding:40px 16px;">
    <tr><td align="center">
      <table width="620" cellpadding="0" cellspacing="0">
        <tr>
          <td style="background:#7A7B68;padding:40px 40px 36px;">
            <p style="margin:0 0 8px;font-family:Inter,sans-serif;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:#AAAB9A;">Christopher Teves</p>
            <h1 style="margin:0 0 10px;font-family:'Lilita One','Space Grotesk',sans-serif;font-size:36px;font-weight:400;color:#EFEDE8;line-height:0.96;letter-spacing:-2px;">Design & Tech Radar</h1>
            <p style="margin:0;font-family:Inter,sans-serif;font-size:13px;color:#AAAB9A;">${today}</p>
          </td>
        </tr>
        <tr>
          <td style="background:#585947;padding:12px 40px;">
            <p style="margin:0;font-family:Inter,sans-serif;font-size:13px;color:#DDDDD7;">5 fresh trends across design, tech, business & culture</p>
          </td>
        </tr>
        <tr>
          <td style="background:#E8E5DB;padding:28px 24px 4px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              ${trendsHtml}
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#EFEDE8;padding:20px 40px;border-top:1px solid #D4CFBE;">
            <p style="margin:0;font-family:Inter,sans-serif;font-size:12px;color:#AAAB9A;text-align:center;">Generated by your personal AI trends agent · Powered by Claude</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Step 6: Send via Resend ───────────────────────────────────────────────────
async function sendEmail(htmlContent, trends) {
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long", month: "long", day: "numeric",
  });

  const plainText = trends.map((t, i) =>
    `${i + 1}. ${t.title}\n${t.category}\n\nWhy it matters: ${t.why_it_matters}\n\nWhat's happening: ${t.whats_happening}\n\nSource: ${t.source_name} — ${t.source_url}`
  ).join("\n\n---\n\n");

  const result = await post(
    "api.resend.com",
    "/emails",
    { Authorization: `Bearer ${RESEND_API_KEY}` },
    {
      from: FROM_EMAIL,
      to: TO_EMAIL,
      subject: `Christopher Teves · Design & Tech Radar — ${today}`,
      html: htmlContent,
      text: plainText,
    }
  );

  return result;
}

// ─── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log("Reading sent history...");
  const { history, sha: historySha } = await readHistory();

  console.log("Fetching today's trends from Claude...");
  const trends = await fetchTrends(history);
  console.log(`Parsed ${trends.length} trends successfully`);

  console.log("Pushing trends.json to portfolio repo...");
  await pushTrendsToPortfolio(trends);

  console.log("Updating sent history...");
  const newEntries = trends.map(t => ({ title: t.title, url: t.source_url, date: t.date }));
  await saveHistory([...history, ...newEntries], historySha);

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
