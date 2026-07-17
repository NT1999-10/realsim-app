// Vercel Serverless Function: /api/auction-list
// 競売物件を検索するPro限定API。読み取りはservice role経由のみ。

const PAGE_SIZE = 50;
const VALID_TYPES = new Set(["マンション", "戸建て", "土地", "その他"]);
const VALID_SORTS = new Set(["bid_end", "min_price"]);
const SEEN_KEY = "auction-seen";
const NEW_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function serviceHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return {
    apikey: key,
    Authorization: "Bearer " + key,
    "Content-Type": "application/json",
  };
}

async function getUser(req) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return { error: "サーバーの認証設定が未完了です", status: 501 };
  }

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { error: "ログインが必要です", status: 401 };

  const response = await fetch(url + "/auth/v1/user", {
    headers: { apikey: anon, Authorization: "Bearer " + token },
  });
  if (!response.ok) {
    return { error: "認証に失敗しました。再ログインしてください", status: 401 };
  }
  const user = await response.json();
  if (!user || !user.id) return { error: "認証に失敗しました", status: 401 };
  return { userId: user.id };
}

async function requirePro(userId) {
  const url = process.env.SUPABASE_URL;
  const headers = serviceHeaders();
  if (!url || !headers) {
    return { error: "サーバー設定(SERVICE_ROLE_KEY)が不足しています", status: 501 };
  }
  const response = await fetch(
    url + "/rest/v1/profiles?id=eq." + encodeURIComponent(userId) + "&select=plan",
    { headers });
  const rows = await response.json().catch(() => []);
  if (!response.ok) return { error: "プラン情報を確認できませんでした", status: 502 };
  if (!rows[0]) return { error: "プロファイルが見つかりません", status: 403 };
  if (rows[0].plan !== "pro") {
    return { error: "競売ウォッチはProプラン限定です", status: 403 };
  }
  return { ok: true };
}

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

export function normalizeQuery(input) {
  const pref = String(input.pref || "").trim();
  const type = String(input.type || "").trim();
  const sort = VALID_SORTS.has(input.sort) ? input.sort : "bid_end";
  const page = Math.max(1, Math.floor(Number(input.page) || 1));
  const maxPrice = input.maxPrice == null || input.maxPrice === ""
    ? null : Number(input.maxPrice);

  if (pref.length > 20) throw new Error("都道府県が正しくありません");
  if (type && !VALID_TYPES.has(type)) throw new Error("物件種別が正しくありません");
  if (maxPrice != null && (!Number.isFinite(maxPrice) || maxPrice < 0)) {
    throw new Error("上限価格が正しくありません");
  }
  return { pref, type, sort, page, maxPrice };
}

function todayJst() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function readSeen(userId) {
  const url = process.env.SUPABASE_URL;
  const headers = serviceHeaders();
  try {
    const response = await fetch(
      url + "/rest/v1/user_data?user_id=eq." + encodeURIComponent(userId) +
      "&key=eq." + encodeURIComponent(SEEN_KEY) + "&select=value",
      { headers });
    const rows = await response.json();
    const value = rows && rows[0] && rows[0].value;
    return value && typeof value === "object" ? value.maxFirstSeen || null : null;
  } catch {
    return null;
  }
}

async function writeSeen(userId, maxFirstSeen) {
  if (!maxFirstSeen) return;
  const url = process.env.SUPABASE_URL;
  const headers = serviceHeaders();
  try {
    await fetch(url + "/rest/v1/user_data?on_conflict=user_id,key", {
      method: "POST",
      headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        user_id: userId,
        key: SEEN_KEY,
        value: { maxFirstSeen },
        updated_at: new Date().toISOString(),
      }),
    });
  } catch {
    // 既読位置の保存失敗で一覧取得自体は失敗させない。
  }
}

export function addNewFlags(items, seenAt, now = Date.now()) {
  const newAfter = now - NEW_DAYS_MS;
  return items.map((item) => {
    const first = new Date(item.first_seen).getTime();
    return {
      ...item,
      isNew: Number.isFinite(first) && first >= newAfter &&
        (!seenAt || item.first_seen > seenAt),
    };
  });
}

async function listItems(query) {
  const url = process.env.SUPABASE_URL;
  const headers = serviceHeaders();
  if (!url || !headers) throw new Error("サーバー設定が不足しています");

  const offset = (query.page - 1) * PAGE_SIZE;
  const params = new URLSearchParams({
    select: "id,court,case_no,item_no,pref,city,address,type,min_price,deposit,bid_start,bid_end,open_date,built_year,floor_area,land_area,bit_url,first_seen,updated_at",
    active: "eq.true",
    bid_end: "gte." + todayJst(),
    order: query.sort + ".asc.nullslast",
  });
  if (query.pref) params.set("pref", "eq." + query.pref);
  if (query.type) params.set("type", "eq." + query.type);
  if (query.maxPrice != null) params.set("min_price", "lte." + Math.floor(query.maxPrice));

  const response = await fetch(url + "/rest/v1/auction_items?" + params, {
    headers: {
      ...headers,
      Prefer: "count=exact",
      Range: offset + "-" + (offset + PAGE_SIZE - 1),
    },
  });
  const items = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(items)) {
    throw new Error("競売データを取得できませんでした");
  }
  const range = response.headers.get("content-range") || "";
  const totalText = range.split("/")[1];
  const total = totalText && totalText !== "*" ? Number(totalText) : items.length;
  return { items, total: Number.isFinite(total) ? total : items.length };
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

  let query;
  try {
    query = normalizeQuery(parseBody(req));
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  try {
    const seenAt = await readSeen(who.userId);
    const result = await listItems(query);
    const items = addNewFlags(result.items, seenAt);
    const latest = result.items.reduce((max, item) =>
      item.first_seen && (!max || item.first_seen > max) ? item.first_seen : max, null);
    await writeSeen(who.userId, latest);
    return res.status(200).json({
      items,
      total: result.total,
      page: query.page,
      pageSize: PAGE_SIZE,
      hasMore: query.page * PAGE_SIZE < result.total,
    });
  } catch (error) {
    console.log("[auction-list] failed", String(error && error.message || error).slice(0, 300));
    return res.status(502).json({ error: "競売データの取得に失敗しました" });
  }
}
