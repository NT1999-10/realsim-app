// Vercel Serverless Function: /api/lead-preview
// ユーザーが指定した許可サイトを1件だけ取得し、候補入力用の情報を返す。

const ALLOWED_DOMAINS = [
  "suumo.jp", "athome.co.jp", "homes.co.jp", "rakumachi.jp", "kenbiya.com",
];
const MAX_BYTES = 500 * 1024;
const TIMEOUT_MS = 6000;
const DAILY_LIMIT = 20;
const usageByIp = new Map();

export function allowedDomain(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  return ALLOWED_DOMAINS.find((domain) =>
    host === domain || host.endsWith("." + domain)) || null;
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return (value ? value.split(",")[0].trim() : "") ||
    req.socket?.remoteAddress || "unknown";
}

function consumeQuota(req) {
  const ip = clientIp(req);
  const day = new Date().toISOString().slice(0, 10);
  const current = usageByIp.get(ip);
  const count = current && current.day === day ? current.count : 0;
  if (count >= DAILY_LIMIT) return false;
  usageByIp.set(ip, { day, count: count + 1 });
  return true;
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#([0-9]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function metaTitle(html) {
  const tags = String(html).match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const attrs = {};
    const re = /([^\s=]+)\s*=\s*(["'])(.*?)\2/g;
    let match;
    while ((match = re.exec(tag))) attrs[match[1].toLowerCase()] = match[3];
    if ((attrs.property || attrs.name || "").toLowerCase() === "og:title" && attrs.content) {
      return decodeEntities(attrs.content).trim();
    }
  }
  const title = String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return title ? decodeEntities(title[1].replace(/<[^>]+>/g, " ")).trim() : "";
}

export function extractLeadFromHtml(html) {
  const bodyMatch = String(html).match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const body = (bodyMatch ? bodyMatch[1] : String(html))
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(body).replace(/\s+/g, " ").trim().slice(0, 20000);
  const priceMatch = text.match(/([0-9,][0-9,.]*)\s*万円/);
  const rentMatch = text.match(/(?:賃料|家賃|想定賃料)[^0-9]{0,10}([0-9,]+)\s*円/);
  const toNumber = (match) => match ? Number(match[1].replace(/,/g, "")) : null;
  return {
    name: metaTitle(html).slice(0, 120) || null,
    price: toNumber(priceMatch),
    rent: toNumber(rentMatch),
  };
}

async function readHtml(response) {
  const type = (response.headers.get("content-type") || "").toLowerCase();
  if (!type.includes("text/html")) throw new Error("HTML以外の応答です");
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_BYTES) throw new Error("応答サイズが上限を超えています");
  if (!response.body) throw new Error("応答本文がありません");

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error("応答サイズが上限を超えています");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function fetchHtml(initialUrl, rootDomain) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let current = initialUrl;
  try {
    for (let redirects = 0; redirects <= 2; redirects++) {
      const response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "RealSimLinkPreview/1.0 (single user-initiated fetch)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects === 2) throw new Error("リダイレクト回数が上限を超えました");
        const location = response.headers.get("location");
        if (!location) throw new Error("リダイレクト先がありません");
        const next = new URL(location, current);
        if (next.protocol !== "https:" || allowedDomain(next.hostname) !== rootDomain) {
          throw new Error("許可されていないリダイレクトです");
        }
        current = next;
        continue;
      }
      if (!response.ok) throw new Error("取得先が応答を拒否しました");
      return await readHtml(response);
    }
    throw new Error("取得できませんでした");
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "POSTのみ受け付けます" });
  }
  if (!consumeQuota(req)) {
    return res.status(429).json({ ok: false, error: "本日の利用回数上限（20回）に達しました" });
  }

  let target;
  try {
    target = new URL(req.body && req.body.url);
  } catch {
    return res.status(400).json({ ok: false, error: "正しいURLを入力してください" });
  }
  if (target.protocol !== "https:") {
    return res.status(400).json({ ok: false, error: "httpsのURLのみ対応しています" });
  }
  const rootDomain = allowedDomain(target.hostname);
  if (!rootDomain) {
    return res.status(400).json({ ok: false, error: "対応サイト外のURLです" });
  }

  try {
    const html = await fetchHtml(target, rootDomain);
    return res.status(200).json({ ok: true, ...extractLeadFromHtml(html) });
  } catch {
    return res.status(200).json({ ok: false });
  }
}
