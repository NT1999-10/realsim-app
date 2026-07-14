// Vercel Serverless Function: /api/market-price
// 国土交通省「不動産情報ライブラリ」の直近8四半期を集計するPro限定API。
// 必要な環境変数: MLIT_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY

const MLIT_BASE = "https://www.reinfolib.mlit.go.jp/ex-api/external";
const CITY_TTL_MS = 24 * 60 * 60 * 1000;
const MARKET_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DAILY_LIMIT = 30;
const cityCache = new Map();
const usageByUser = new Map();
const VALID_TYPES = new Set(["mansion", "house", "land"]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getUser(req) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return { error: "サーバーの認証設定が未完了です", status: 501 };
  }
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { error: "ログインが必要です", status: 401 };

  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anon, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    return { error: "認証に失敗しました。再ログインしてください", status: 401 };
  }
  const user = await response.json();
  if (!user || !user.id) return { error: "認証に失敗しました", status: 401 };
  return { userId: user.id };
}

function serviceHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

async function requirePro(userId) {
  const url = process.env.SUPABASE_URL;
  const headers = serviceHeaders();
  if (!url || !headers) {
    return { error: "サーバー設定(SERVICE_ROLE_KEY)が不足しています", status: 501 };
  }
  const response = await fetch(
    `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=plan`,
    { headers });
  if (!response.ok) {
    return { error: "プラン情報を確認できませんでした", status: 500 };
  }
  const rows = await response.json();
  const profile = Array.isArray(rows) ? rows[0] : null;
  if (!profile) return { error: "プロファイルが見つかりません", status: 403 };
  if (profile.plan !== "pro") {
    return { error: "相場照合はProプラン限定です", status: 403 };
  }
  return { ok: true };
}

function consumeDailyQuota(userId) {
  const day = new Date().toISOString().slice(0, 10);
  const current = usageByUser.get(userId);
  const count = current && current.day === day ? current.count : 0;
  if (count >= DAILY_LIMIT) return false;
  usageByUser.set(userId, { day, count: count + 1 });
  return true;
}

function normalizeCityName(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}

function requestKey(pref, cityName, type) {
  return [pref, normalizeCityName(cityName), type].join(":");
}

async function readMarketCache(key) {
  const url = process.env.SUPABASE_URL;
  const headers = serviceHeaders();
  if (!url || !headers) return null;
  try {
    const response = await fetch(
      `${url}/rest/v1/market_cache?key=eq.${encodeURIComponent(key)}&select=payload,fetched_at`,
      { headers });
    if (!response.ok) return null;
    const rows = await response.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || !row.payload || !row.fetched_at) return null;
    const age = Date.now() - new Date(row.fetched_at).getTime();
    return Number.isFinite(age) && age >= 0 && age < MARKET_TTL_MS
      ? row.payload : null;
  } catch {
    return null;
  }
}

async function writeMarketCache(key, payload) {
  const url = process.env.SUPABASE_URL;
  const headers = serviceHeaders();
  if (!url || !headers) return;
  try {
    await fetch(`${url}/rest/v1/market_cache?on_conflict=key`, {
      method: "POST",
      headers: { ...headers, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ key, payload, fetched_at: new Date().toISOString() }),
    });
  } catch {
    // キャッシュ保存失敗は取得結果自体を失敗させない。
  }
}

async function fetchMlit(endpoint, params, apiKey) {
  const query = new URLSearchParams(params);
  const response = await fetch(`${MLIT_BASE}/${endpoint}?${query}`, {
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
      Accept: "application/json",
    },
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("国交省APIの応答を読み取れませんでした");
  }
  if (!response.ok || !data || (data.status && data.status !== "OK")) {
    throw new Error("国交省APIからデータを取得できませんでした");
  }
  return data;
}

async function cityList(pref, apiKey) {
  const cached = cityCache.get(pref);
  if (cached && cached.expiresAt > Date.now()) return cached.cities;

  const response = await fetchMlit("XIT002", { area: pref }, apiKey);
  const rows = Array.isArray(response.data) ? response.data
    : Array.isArray(response) ? response : [];
  const cities = rows
    .map((row) => ({
      code: String(row.id || row.code || row.MunicipalityCode || ""),
      name: String(row.name || row.Municipality || ""),
    }))
    .filter((row) => row.code && row.name);
  cityCache.set(pref, { cities, expiresAt: Date.now() + CITY_TTL_MS });
  return cities;
}

export function resolveCity(cities, input) {
  const name = normalizeCityName(input);
  if (!name) return null;
  const exact = cities.find((city) => normalizeCityName(city.name) === name);
  if (exact) return exact;
  const matches = cities.filter((city) => {
    const candidate = normalizeCityName(city.name);
    return candidate.includes(name) || name.includes(candidate);
  });
  matches.sort((a, b) =>
    Math.abs(normalizeCityName(a.name).length - name.length) -
    Math.abs(normalizeCityName(b.name).length - name.length));
  return matches[0] || null;
}

export function recentEightQuarters(now = new Date()) {
  let year = now.getUTCFullYear();
  let quarter = Math.floor(now.getUTCMonth() / 3) + 1;
  quarter -= 1;
  if (quarter === 0) { quarter = 4; year -= 1; }

  const result = [];
  for (let i = 0; i < 8; i++) {
    result.push({ year, quarter });
    quarter -= 1;
    if (quarter === 0) { quarter = 4; year -= 1; }
  }
  return result;
}

export function matchesType(value, type) {
  const text = String(value || "").replace(/\s+/g, "");
  if (type === "mansion") return text.includes("中古マンション");
  if (type === "house") {
    return text.includes("宅地(土地と建物)") ||
      text.includes("一戸建て") || text.includes("戸建");
  }
  if (type === "land") {
    return text === "宅地(土地)" ||
      (text.includes("土地") && !text.includes("建物"));
  }
  return false;
}

function numberValue(value) {
  if (value == null || value === "") return null;
  const number = Number(String(value).replace(/,/g, "").replace(/㎡/g, "").trim());
  return Number.isFinite(number) && number > 0 ? number : null;
}

function builtYear(value) {
  const match = String(value || "").match(/(\d{4})/);
  return match ? Number(match[1]) : null;
}

export function mapTransaction(row) {
  const price = numberValue(row.TradePrice ?? row.tradePrice ?? row.price);
  const area = numberValue(row.Area ?? row.area);
  if (!price || !area) return null;
  return {
    price,
    area,
    unit: Math.round(price / area),
    builtYear: builtYear(row.BuildingYear ?? row.buildingYear),
    period: String(row.Period ?? row.period ?? ""),
  };
}

function percentile(sorted, ratio) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * ratio;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const value = lower === upper ? sorted[lower]
    : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  return Math.round(value);
}

export function aggregateTransactions(rows, type, city) {
  const samples = rows
    .filter((row) => matchesType(row.Type ?? row.type, type))
    .map(mapTransaction)
    .filter(Boolean);
  const units = samples.map((sample) => sample.unit).sort((a, b) => a - b);
  return {
    count: samples.length,
    medianUnitYenPerM2: percentile(units, 0.5),
    p25: percentile(units, 0.25),
    p75: percentile(units, 0.75),
    samples: samples.slice(0, 50),
    city: { code: city.code, name: city.name },
  };
}

async function fetchTransactions(pref, cityCode, apiKey) {
  const rows = [];
  const quarters = recentEightQuarters();
  for (let index = 0; index < quarters.length; index++) {
    const period = quarters[index];
    const response = await fetchMlit("XIT001", {
      year: String(period.year),
      quarter: String(period.quarter),
      area: pref,
      city: cityCode,
    }, apiKey);
    if (Array.isArray(response.data)) rows.push(...response.data);
    if (index < quarters.length - 1) await sleep(1000);
  }
  return rows;
}

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POSTのみ受け付けます" });
  }

  const who = await getUser(req);
  if (who.error) return res.status(who.status).json({ error: who.error });
  const plan = await requirePro(who.userId);
  if (plan.error) return res.status(plan.status).json({ error: plan.error });
  const body = parseBody(req);
  const pref = String(body.pref || "").trim();
  const cityName = normalizeCityName(body.cityName);
  const type = String(body.type || "");
  if (!/^(0[1-9]|[1-3]\d|4[0-7])$/.test(pref)) {
    return res.status(400).json({ error: "都道府県コードが正しくありません" });
  }
  if (!cityName || cityName.length > 80) {
    return res.status(400).json({ error: "市区町村を入力してください" });
  }
  if (!VALID_TYPES.has(type)) {
    return res.status(400).json({ error: "物件種別が正しくありません" });
  }

  const apiKey = process.env.MLIT_API_KEY;
  if (!apiKey) {
    return res.status(501).json({
      error: "サーバーに MLIT_API_KEY が未設定です",
    });
  }

  if (!consumeDailyQuota(who.userId)) {
    return res.status(429).json({ error: "本日の相場照合回数上限(30回)に達しました" });
  }

  const key = requestKey(pref, cityName, type);
  const cached = await readMarketCache(key);
  if (cached) {
    res.setHeader("X-Market-Cache", "HIT");
    return res.status(200).json(cached);
  }

  try {
    const cities = await cityList(pref, apiKey);
    const city = resolveCity(cities, cityName);
    if (!city) return res.status(404).json({ error: "市区町村が見つかりません" });

    const rows = await fetchTransactions(pref, city.code, apiKey);
    const payload = aggregateTransactions(rows, type, city);
    await writeMarketCache(key, payload);
    res.setHeader("X-Market-Cache", "MISS");
    return res.status(200).json(payload);
  } catch (error) {
    return res.status(502).json({
      error: error && error.message
        ? error.message : "相場データの取得に失敗しました",
    });
  }
}
