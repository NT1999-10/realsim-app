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
];
const REQUIRED_COLUMNS = ["id", "bit_url"];
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

function booleanValue(value) {
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (!text) return true;
  if (["true", "1", "yes"].includes(text)) return true;
  if (["false", "0", "no"].includes(text)) return false;
  throw new Error("activeはtrueまたはfalseで入力してください");
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

export function mapAuctionRow(headers, values, lineNumber) {
  const raw = Object.fromEntries(headers.map((name, index) => [name, values[index] || ""]));
  try {
    const type = nullableText(raw.type) || "その他";
    if (!VALID_TYPES.has(type)) {
      throw new Error("typeはマンション/戸建て/土地/その他のいずれかです");
    }
    return {
      id: String(raw.id || "").trim(),
      court: nullableText(raw.court),
      case_no: nullableText(raw.case_no),
      item_no: nullableNumber(raw.item_no, true),
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
      bit_url: officialBitUrl(raw.bit_url),
      active: booleanValue(raw.active),
      updated_at: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(lineNumber + "行目: " + error.message);
  }
}

export function rowsFromCsv(text) {
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

  const rows = parsed.slice(1).map((values, index) =>
    mapAuctionRow(headers, values, index + 2));
  if (rows.length > MAX_ROWS) {
    throw new Error("1回に取り込めるのは" + MAX_ROWS + "件までです");
  }
  const ids = new Set();
  for (const row of rows) {
    if (!row.id) throw new Error("idは必須です");
    if (ids.has(row.id)) throw new Error("CSV内でidが重複しています: " + row.id);
    ids.add(row.id);
  }
  return rows;
}

function csvBody(req) {
  if (typeof req.body === "string") return req.body;
  if (req.body && typeof req.body.csv === "string") return req.body.csv;
  return "";
}

async function upsertBatch(rows) {
  const url = process.env.SUPABASE_URL;
  const headers = serviceHeaders();
  if (!url || !headers) {
    throw new Error("サーバー設定(SERVICE_ROLE_KEY)が不足しています");
  }
  const response = await fetch(url + "/rest/v1/auction_items?on_conflict=id", {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error("競売データの保存に失敗しました: " + detail);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POSTのみ受け付けます" });
  }

  const allowed = adminEmails();
  if (!allowed.size) {
    return res.status(501).json({ error: "ADMIN_EMAILSが未設定です" });
  }

  const who = await getUser(req);
  if (who.error) return res.status(who.status).json({ error: who.error });
  if (!allowed.has(who.email)) {
    return res.status(403).json({ error: "競売CSVの取り込み権限がありません" });
  }

  try {
    const rows = rowsFromCsv(csvBody(req));
    for (let index = 0; index < rows.length; index += BATCH_SIZE) {
      await upsertBatch(rows.slice(index, index + BATCH_SIZE));
    }
    console.log("[auction-import] admin=" + who.email + " imported=" + rows.length);
    return res.status(200).json({ ok: true, imported: rows.length });
  } catch (error) {
    console.log("[auction-import] failed", String(error && error.message || error).slice(0, 300));
    return res.status(400).json({ error: String(error && error.message || error) });
  }
}
