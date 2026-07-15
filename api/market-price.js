import zlib from "zlib";

// Vercel Serverless Function: /api/market-price
// 国土交通省「不動産情報ライブラリ」の整備済み過去3年を集計するPro限定API。

const MLIT_BASE = "https://www.reinfolib.mlit.go.jp/ex-api/external";
const CITY_TTL_MS = 24 * 60 * 60 * 1000;
const MARKET_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TIME_BUDGET_MS = 8000;
const FETCH_TIMEOUT_MS = 4000;
const DAILY_LIMIT = 30;
const cityCache = new Map();
const usageByUser = new Map();
const VALID_TYPES = new Set(["mansion", "house", "land"]);
const VALID_STAGES = new Set(["auth", "xit002", "empty", "parse", "timeout", "other"]);

class StageError extends Error {
  constructor(stage, message, snippet = "") {
    super(message);
    this.stage = VALID_STAGES.has(stage) ? stage : "other";
    this.snippet = String(snippet || "").slice(0, 300);
  }
}

function remainingMs(t0) {
  return TIME_BUDGET_MS - (Date.now() - t0);
}

async function fetchBytes(url, options, t0) {
  const remaining = remainingMs(t0);
  if (remaining <= 0) {
    throw new StageError("timeout", "全体の時間予算を超過しました");
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(), Math.min(FETCH_TIMEOUT_MS, remaining));
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const buffer = Buffer.from(await response.arrayBuffer());
    return { response, buffer };
  } catch (error) {
    if (controller.signal.aborted || (error && error.name === "AbortError")) {
      throw new StageError("timeout", "外部APIの応答がタイムアウトしました");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function decodeBufferText(buffer) {
  return buffer[0] === 0x1f && buffer[1] === 0x8b
    ? zlib.gunzipSync(buffer).toString("utf8")
    : buffer.toString("utf8");
}

function responsePreview(buffer) {
  try { return decodeBufferText(buffer).slice(0, 300); }
  catch { return buffer.toString("utf8").slice(0, 300); }
}

function parseJsonBuffer(buffer) {
  let text = "";
  try {
    text = decodeBufferText(buffer);
    return { data: JSON.parse(text), text };
  } catch {
    throw new StageError("parse", "API応答の解析に失敗しました", text || responsePreview(buffer));
  }
}

async function fetchJson(url, options, t0) {
  const { response, buffer } = await fetchBytes(url, options, t0);
  const parsed = parseJsonBuffer(buffer);
  return { response, data: parsed.data, text: parsed.text };
}

function fail(res, stage, error) {
  return res.status(200).json({
    ok: false,
    stage: VALID_STAGES.has(stage) ? stage : "other",
    error: String(error || "データの取得に失敗しました"),
  });
}

async function getUser(req, t0) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return { error: "サーバーの認証設定が未完了です" };

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { error: "ログインが必要です" };

  const { response, data } = await fetchJson(`${url}/auth/v1/user`, {
    headers: { apikey: anon, Authorization: `Bearer ${token}` },
  }, t0);
  if (!response.ok || !data || !data.id) {
    return { error: "認証に失敗しました。再ログインしてください" };
  }
  return { userId: data.id };
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

async function requirePro(userId, t0) {
  const url = process.env.SUPABASE_URL;
  const headers = serviceHeaders();
  if (!url || !headers) {
    return { error: "サーバー設定(SERVICE_ROLE_KEY)が不足しています" };
  }
  const { response, data } = await fetchJson(
    `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=plan`,
    { headers }, t0);
  const profile = Array.isArray(data) ? data[0] : null;
  if (!response.ok) return { error: "プラン情報を確認できませんでした" };
  if (!profile) return { error: "プロファイルが見つかりません" };
  if (profile.plan !== "pro") return { error: "相場照合はProプラン限定です" };
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
  return ["mlit-v2", pref, normalizeCityName(cityName), type].join(":");
}

async function readMarketCache(key, t0) {
  const url = process.env.SUPABASE_URL;
  const headers = serviceHeaders();
  if (!url || !headers) return null;
  try {
    const { response, data } = await fetchJson(
      `${url}/rest/v1/market_cache?key=eq.${encodeURIComponent(key)}&select=payload,fetched_at`,
      { headers }, t0);
    if (!response.ok) return null;
    const row = Array.isArray(data) ? data[0] : null;
    if (!row || !row.payload || !row.fetched_at) return null;
    const age = Date.now() - new Date(row.fetched_at).getTime();
    return Number.isFinite(age) && age >= 0 && age < MARKET_TTL_MS
      ? row.payload : null;
  } catch {
    return null;
  }
}

async function writeMarketCache(key, payload, t0) {
  const url = process.env.SUPABASE_URL;
  const headers = serviceHeaders();
  if (!url || !headers || remainingMs(t0) <= 0) return;
  try {
    await fetchBytes(`${url}/rest/v1/market_cache?on_conflict=key`, {
      method: "POST",
      headers: { ...headers, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ key, payload, fetched_at: new Date().toISOString() }),
    }, t0);
  } catch {
    // キャッシュ保存失敗は取得結果自体を失敗させない。
  }
}

async function fetchMlit(endpoint, params, apiKey, t0, stage) {
  const query = new URLSearchParams(params);
  const { response, buffer } = await fetchBytes(
    `${MLIT_BASE}/${endpoint}?${query}`, {
      headers: {
        "Ocp-Apim-Subscription-Key": apiKey,
        "Accept-Encoding": "gzip",
        Accept: "application/json",
      },
    }, t0);
  const preview = responsePreview(buffer);

  if (response.status === 401 || response.status === 403) {
    console.log("[market-price] MLIT auth failure", preview);
    throw new StageError("auth", "国交省APIの認証に失敗しました", preview);
  }

  const { data, text } = parseJsonBuffer(buffer);
  if (!response.ok || !data || (data.status && data.status !== "OK")) {
    console.log(`[market-price] ${endpoint} failure`, text.slice(0, 300));
    throw new StageError(stage, "国交省APIからデータを取得できませんでした", text);
  }
  return data;
}

async function cityList(pref, apiKey, t0) {
  const cached = cityCache.get(pref);
  if (cached && cached.expiresAt > Date.now()) return cached.cities;

  const response = await fetchMlit("XIT002", { area: pref }, apiKey, t0, "xit002");
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

export function targetYears(now = new Date()) {
  const start = now.getUTCFullYear() - 2;
  return [start, start - 1, start - 2];
}

export function matchesType(value, type) {
  const text = String(value || "").replace(/\s+/g, "");
  if (type === "mansion") return text.includes("中古マンション");
  if (type === "house") return text.includes("宅地(土地と建物)");
  if (type === "land") return text.includes("宅地(土地)");
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
  const unit = price / area;
  if (unit < 10000 || unit > 10000000) return null;
  return {
    price,
    area,
    unit: Math.round(unit),
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

async function fetchTransactions(cityCode, apiKey, t0) {
  const years = targetYears();
  const results = await Promise.all(years.map(async (year) => {
    try {
      const response = await fetchMlit("XIT001", {
        year: String(year),
        city: cityCode,
      }, apiKey, t0, "other");
      const rows = Array.isArray(response.data) ? response.data : [];
      console.log(`[market-price] year=${year} count=${rows.length}`);
      return { year, rows, error: null };
    } catch (error) {
      const normalized = error instanceof StageError
        ? error : new StageError("other", String(error && error.message || error));
      console.log(`[market-price] year=${year} failed stage=${normalized.stage}`,
        normalized.snippet.slice(0, 300));
      return { year, rows: [], error: normalized };
    }
  }));
  return results;
}

function failureFromResults(results) {
  const errors = results.map((result) => result.error).filter(Boolean);
  for (const stage of ["auth", "parse", "timeout", "other"]) {
    const found = errors.find((error) => error.stage === stage);
    if (found) return found;
  }
  return new StageError("empty", "取引データが見つかりませんでした");
}

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

export default async function handler(req, res) {
  const t0 = Date.now();
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return fail(res, "other", "POSTのみ受け付けます");
    }

    const who = await getUser(req, t0);
    if (who.error) return fail(res, "other", who.error);
    const plan = await requirePro(who.userId, t0);
    if (plan.error) return fail(res, "other", plan.error);

    const body = parseBody(req);
    const pref = String(body.pref || "").trim();
    const cityName = normalizeCityName(body.cityName);
    const type = String(body.type || "");
    if (!/^(0[1-9]|[1-3]\d|4[0-7])$/.test(pref)) {
      return fail(res, "other", "都道府県コードが正しくありません");
    }
    if (!cityName || cityName.length > 80) {
      return fail(res, "xit002", "市区町村を入力してください");
    }
    if (!VALID_TYPES.has(type)) {
      return fail(res, "other", "物件種別が正しくありません");
    }

    const apiKey = process.env.MLIT_API_KEY;
    if (!apiKey) return fail(res, "auth", "MLIT_API_KEY が未設定です");
    if (!consumeDailyQuota(who.userId)) {
      return fail(res, "other", "本日の相場照合回数上限(30回)に達しました");
    }

    const key = requestKey(pref, cityName, type);
    const cached = await readMarketCache(key, t0);
    if (cached && cached.ok === true) {
      res.setHeader("X-Market-Cache", "HIT");
      return res.status(200).json(cached);
    }

    const cities = await cityList(pref, apiKey, t0);
    const city = resolveCity(cities, cityName);
    if (!city) return fail(res, "xit002", "市区町村が見つかりませんでした");
    console.log(`[market-price] city=${city.name} code=${city.code}`);

    const yearly = await fetchTransactions(city.code, apiKey, t0);
    const rows = yearly.flatMap((result) => result.rows);
    const years = yearly.filter((result) => result.rows.length > 0)
      .map((result) => result.year);
    if (!rows.length) {
      const failure = failureFromResults(yearly);
      return fail(res, failure.stage, failure.message);
    }

    const aggregate = aggregateTransactions(rows, type, city);
    if (!aggregate.count) {
      return fail(res, "empty", "指定した地域・種別の取引データが見つかりませんでした");
    }

    const payload = { ok: true, ...aggregate, years };
    await writeMarketCache(key, payload, t0);
    res.setHeader("X-Market-Cache", "MISS");
    return res.status(200).json(payload);
  } catch (error) {
    const normalized = error instanceof StageError
      ? error : new StageError("other", String(error && error.message || error));
    console.log(`[market-price] failed stage=${normalized.stage}`,
      normalized.snippet.slice(0, 300));
    return fail(res, normalized.stage, normalized.message);
  }
}
