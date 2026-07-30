// Vercel Serverless Function: /api/auction-import
// BITから運営者が手動で転記・エクスポートしたCSVを管理者だけが取り込む。
// 必要な環境変数: ADMIN_EMAILS, SUPABASE_URL, SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY

const MAX_ROWS = 1000;
const BATCH_SIZE = 200;
const CSV_COLUMNS = [
  "id", "court", "case_no", "item_no", "pref", "city", "address", "type",
  "min_price", "deposit", "bid_start", "bid_end", "open_date", "built_year",
  "floor_area", "land_area", "bit_url", "active",
  "buyable_price", "appraisal_value", "property_tax_yen",
  "city_planning_tax_yen", "zoning", "building_coverage", "floor_area_ratio",
  "occupancy", "price_reduced", "notes",
];
const REQUIRED_COLUMNS = ["case_no", "bit_url"];
const VALID_TYPES = new Set(["マンション", "戸建て", "土地", "その他"]);

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
  if (!user || !user.id || !user.email) {
    return { error: "認証に失敗しました", status: 401 };
  }
  return { userId: user.id, email: String(user.email).toLowerCase() };
}

function adminEmails() {
  return new Set(String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean));
}

export function parseCsv(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (quoted) throw new Error("CSVの引用符が閉じられていません");
  row.push(field.replace(/\r$/, ""));
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function nullableText(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function nullableNumber(value, integer = false) {
  const text = String(value == null ? "" : value).replace(/,/g, "").trim();
  if (!text) return null;
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0 || (integer && !Number.isInteger(number))) {
    throw new Error("数値形式が正しくありません: " + value);
  }
  return number;
}

function nullableDate(value) {
  const text = nullableText(value);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) ||
      Number.isNaN(new Date(text + "T00:00:00Z").getTime())) {
    throw new Error("日付はYYYY-MM-DD形式で入力してください: " + value);
  }
  return text;
}

function booleanValue(value, fallback = true, field = "active") {
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (!text) return fallback;
  if (["true", "1", "yes"].includes(text)) return true;
  if (["false", "0", "no"].includes(text)) return false;
  throw new Error(field + "はtrueまたはfalseで入力してください");
}

function officialBitUrl(value) {
  const text = String(value || "").trim();
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error("bit_urlがURL形式ではありません");
  }
  if (url.protocol !== "https:" || url.hostname !== "www.bit.courts.go.jp") {
    throw new Error("bit_urlはBIT公式サイトのHTTPS URLに限ります");
  }
  return url.toString();
}

function generatedAuctionId(court, caseNo, itemNo) {
  const courtKey = String(court || "").trim().replace(/\s+/g, "") || "裁判所未入力";
  const caseKey = String(caseNo || "").trim().replace(/\s+/g, "");
  const itemKey = Math.max(1, Math.floor(Number(itemNo) || 1));
  return [courtKey, caseKey, itemKey].join(":");
}

export function mapAuctionRow(headers, values, lineNumber) {
  const raw = Object.fromEntries(headers.map((name, index) => [name, values[index] || ""]));
  try {
    const court = nullableText(raw.court);
    const caseNo = nullableText(raw.case_no);
    const itemNoValue = nullableNumber(raw.item_no, true);
    const itemNo = itemNoValue == null ? 1 : itemNoValue;
    const bitUrl = nullableText(raw.bit_url);
    if (!caseNo) throw new Error("事件番号(case_no)は必須です");
    if (itemNo < 1) throw new Error("物件番号(item_no)は1以上で入力してください");
    if (!bitUrl) throw new Error("BITの物件URL(bit_url)は必須です");

    const type = nullableText(raw.type) || "その他";
    if (!VALID_TYPES.has(type)) {
      throw new Error("typeはマンション/戸建て/土地/その他のいずれかです");
    }
    return {
      id: String(raw.id || "").trim() || generatedAuctionId(court, caseNo, itemNo),
      court,
      case_no: caseNo,
      item_no: itemNo,
      pref: nullableText(raw.pref),
      city: nullableText(raw.city),
      address: nullableText(raw.address),
      type,
      min_price: nullableNumber(raw.min_price, true),
      deposit: nullableNumber(raw.deposit, true),
      bid_start: nullableDate(raw.bid_start),
      bid_end: nullableDate(raw.bid_end),
      open_date: nullableDate(raw.open_date),
      built_year: nullableNumber(raw.built_year, true),
      floor_area: nullableNumber(raw.floor_area),
      land_area: nullableNumber(raw.land_area),
      bit_url: officialBitUrl(bitUrl),
      active: booleanValue(raw.active),
      buyable_price: nullableNumber(raw.buyable_price, true),
      appraisal_value: nullableNumber(raw.appraisal_value, true),
      property_tax_yen: nullableNumber(raw.property_tax_yen, true),
      city_planning_tax_yen: nullableNumber(raw.city_planning_tax_yen, true),
      zoning: nullableText(raw.zoning),
      building_coverage: nullableNumber(raw.building_coverage),
      floor_area_ratio: nullableNumber(raw.floor_area_ratio),
      occupancy: nullableText(raw.occupancy),
      price_reduced: booleanValue(raw.price_reduced, false, "price_reduced"),
      notes: nullableText(raw.notes),
      updated_at: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(lineNumber + "行目: " + error.message);
  }
}

export function rowsFromCsvDetailed(text) {
  const parsed = parseCsv(text);
  if (parsed.length < 2) throw new Error("ヘッダーと1件以上のデータ行が必要です");

  const headers = parsed[0].map((value) => value.trim());
  if (new Set(headers).size !== headers.length) {
    throw new Error("CSVヘッダーが重複しています");
  }
  const unknown = headers.filter((name) => !CSV_COLUMNS.includes(name));
  if (unknown.length) throw new Error("未対応の列があります: " + unknown.join(", "));
  const missing = REQUIRED_COLUMNS.filter((name) => !headers.includes(name));
  if (missing.length) throw new Error("必須列がありません: " + missing.join(", "));
  if (parsed.length - 1 > MAX_ROWS) {
    throw new Error("1回に取り込めるのは" + MAX_ROWS + "件までです");
  }

  const rows = [];
  const errors = [];
  const ids = new Set();
  parsed.slice(1).forEach((values, index) => {
    const lineNumber = index + 2;
    try {
      const row = mapAuctionRow(headers, values, lineNumber);
      if (ids.has(row.id)) {
        throw new Error(lineNumber + "行目: CSV内でidが重複しています: " + row.id);
      }
      ids.add(row.id);
      rows.push(row);
    } catch (error) {
      errors.push({
        row: lineNumber,
        reason: String(error && error.message || error)
          .replace(new RegExp("^" + lineNumber + "行目:\\s*"), ""),
      });
    }
  });
  return { rows, errors };
}

export function rowsFromCsv(text) {
  const result = rowsFromCsvDetailed(text);
  if (result.errors.length) {
    const first = result.errors[0];
    throw new Error(first.row + "行目: " + first.reason);
  }
  return result.rows;
}

function csvBody(req) {
  if (req.body && typeof req.body.csv === "string") return req.body.csv;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(req.body)) {
    return req.body.toString("utf8");
  }
  if (typeof req.body === "string") {
    try {
      const parsed = JSON.parse(req.body);
      if (parsed && typeof parsed.csv === "string") return parsed.csv;
    } catch {
      // text/csvは文字列をそのまま取り込む。
    }
    return req.body;
  }
  return "";
}

async function writeBatch(rows) {
  const url = process.env.SUPABASE_URL;
  const headers = serviceHeaders();
  if (!url || !headers) {
    throw new Error("サーバー設定(SERVICE_ROLE_KEY)が不足しています");
  }

  const endpoint = url + "/rest/v1/auction_items?on_conflict=id&select=id";
  const insertResponse = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...headers,
      Prefer: "resolution=ignore-duplicates,return=representation",
    },
    body: JSON.stringify(rows),
  });
  const insertBody = await insertResponse.text();
  let insertedRows = null;
  try { insertedRows = JSON.parse(insertBody); } catch { /* 詳細は下で返す */ }
  if (!insertResponse.ok || !Array.isArray(insertedRows)) {
    throw new Error("競売データの新規登録に失敗しました: " +
      insertBody.slice(0, 300));
  }

  const insertedIds = new Set(insertedRows.map((row) => String(row.id)));
  const updates = rows.filter((row) => !insertedIds.has(row.id));
  if (updates.length) {
    const updateResponse = await fetch(
      url + "/rest/v1/auction_items?on_conflict=id", {
        method: "POST",
        headers: {
          ...headers,
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(updates),
      });
    if (!updateResponse.ok) {
      const detail = (await updateResponse.text()).slice(0, 300);
      throw new Error("既存の競売データ更新に失敗しました: " + detail);
    }
  }

  return { inserted: insertedIds.size, updated: updates.length };
}

async function recentItems() {
  const url = process.env.SUPABASE_URL;
  const headers = serviceHeaders();
  if (!url || !headers) throw new Error("サーバー設定が不足しています");
  const query = new URLSearchParams({
    select: "id,pref,city,address,type,min_price,bid_end,active,updated_at",
    order: "updated_at.desc",
    limit: "20",
  });
  const response = await fetch(url + "/rest/v1/auction_items?" + query, { headers });
  const rows = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(rows)) {
    throw new Error("登録済みデータを取得できませんでした");
  }
  return rows;
}

async function deactivateItem(id) {
  const value = String(id || "").trim();
  if (!value || value.length > 300) throw new Error("物件IDが正しくありません");
  const url = process.env.SUPABASE_URL;
  const headers = serviceHeaders();
  if (!url || !headers) throw new Error("サーバー設定が不足しています");
  const response = await fetch(
    url + "/rest/v1/auction_items?id=eq." + encodeURIComponent(value), {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ active: false, updated_at: new Date().toISOString() }),
    });
  if (!response.ok) throw new Error("物件を無効化できませんでした");
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "GETまたはPOSTのみ受け付けます" });
  }

  const who = await getUser(req);
  if (who.error) return res.status(who.status).json({ error: who.error });
  const allowed = adminEmails();
  const isAdmin = allowed.size > 0 && allowed.has(who.email);

  if (req.method === "GET") {
    if (!isAdmin) return res.status(200).json({ isAdmin: false });
    try {
      return res.status(200).json({ isAdmin: true, items: await recentItems() });
    } catch (error) {
      return res.status(502).json({ error: String(error && error.message || error) });
    }
  }

  if (!allowed.size) {
    return res.status(501).json({ error: "ADMIN_EMAILSが未設定です" });
  }
  if (!isAdmin) {
    return res.status(403).json({ error: "競売CSVの取り込み権限がありません" });
  }

  try {
    if (req.body && typeof req.body === "object" && req.body.action === "deactivate") {
      await deactivateItem(req.body.id);
      console.log("[auction-import] admin=" + who.email + " deactivated=" + req.body.id);
      return res.status(200).json({ ok: true, deactivated: req.body.id });
    }

    const parsed = rowsFromCsvDetailed(csvBody(req));
    let inserted = 0;
    let updated = 0;
    for (let index = 0; index < parsed.rows.length; index += BATCH_SIZE) {
      const result = await writeBatch(parsed.rows.slice(index, index + BATCH_SIZE));
      inserted += result.inserted;
      updated += result.updated;
    }
    const skipped = parsed.errors.length;
    console.log("[auction-import] admin=" + who.email +
      " inserted=" + inserted + " updated=" + updated + " skipped=" + skipped);
    return res.status(200).json({
      ok: true,
      imported: inserted + updated,
      inserted,
      updated,
      skipped,
      errors: parsed.errors,
    });
  } catch (error) {
    console.log("[auction-import] failed", String(error && error.message || error).slice(0, 300));
    return res.status(400).json({ error: String(error && error.message || error) });
  }
}
