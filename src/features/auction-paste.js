export const AUCTION_CSV_COLUMNS = [
  "id", "court", "case_no", "item_no", "pref", "city", "address", "type",
  "min_price", "deposit", "bid_start", "bid_end", "open_date", "built_year",
  "floor_area", "land_area", "bit_url", "active",
];

const HEADER_ALIASES = [
  ["case_no", ["事件番号"]],
  ["court", ["裁判所名", "裁判所"]],
  ["item_no", ["物件番号"]],
  ["pref", ["都道府県"]],
  ["city", ["市区町村", "市町村"]],
  ["address", ["所在地", "所在", "住所"]],
  ["type", ["物件種別", "種別", "種類"]],
  ["min_price", ["売却基準価額", "売却基準額", "基準価額"]],
  ["deposit", ["買受申出保証額", "保証額"]],
  ["bid_start", ["入札期間開始", "入札開始"]],
  ["bid_end", ["入札期間終了", "入札締切", "入札終了"]],
  ["bid_period", ["入札期間"]],
  ["open_date", ["開札期日", "開札日"]],
  ["built_year", ["建築年", "築年"]],
  ["floor_area", ["建物面積", "専有面積", "床面積"]],
  ["land_area", ["土地面積", "敷地面積"]],
  ["bit_url", ["物件URL", "URL", "リンク"]],
  ["active", ["有効", "公開"]],
  ["id", ["物件ID", "ID"]],
];

function text(value) {
  return String(value == null ? "" : value).trim();
}

function fold(value) {
  return text(value).normalize("NFKC").toLowerCase()
    .replace(/[\s_＿\-‐‑‒–—―()（）[\]［］【】「」『』:：]/g, "");
}

export function pasteHeaderKey(value) {
  const raw = text(value).normalize("NFKC").toLowerCase();
  const compact = fold(raw);
  const english = AUCTION_CSV_COLUMNS.find((key) => fold(key) === compact);
  if (english) return english;
  for (const [key, aliases] of HEADER_ALIASES) {
    if (aliases.some((alias) => compact.includes(fold(alias)))) return key;
  }
  return null;
}

function delimiterCount(line, delimiter) {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') {
      if (quoted && line[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && line[index] === delimiter) {
      count += 1;
    }
  }
  return count;
}

export function detectPasteDelimiter(source) {
  const firstLine = String(source || "").replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] || "";
  const candidates = ["\t", ",", "，"];
  let best = ",";
  let count = 0;
  for (const candidate of candidates) {
    const next = delimiterCount(firstLine, candidate);
    if (next > count) {
      best = candidate;
      count = next;
    }
  }
  return best;
}

export function parsePastedTable(source, delimiter = detectPasteDelimiter(source)) {
  const input = String(source || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  const pushRow = () => {
    row.push(field.replace(/\r$/, ""));
    if (row.some((value) => text(value))) rows.push(row);
    row = [];
    field = "";
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      pushRow();
    } else {
      field += char;
    }
  }

  if (quoted) throw new Error("引用符が閉じられていません");
  if (field || row.length) pushRow();
  return rows;
}

function validDate(year, month, day) {
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year &&
    value.getUTCMonth() === month - 1 && value.getUTCDate() === day;
}

export function normalizeAuctionDate(value) {
  const source = text(value).normalize("NFKC");
  if (!source) return null;
  let year;
  let month;
  let day;
  let match = source.match(/^令和(元|\d+)年(\d{1,2})月(\d{1,2})日$/);
  if (match) {
    year = 2018 + (match[1] === "元" ? 1 : Number(match[1]));
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    match = source.match(/^(\d{4})(?:年|[/-])(\d{1,2})(?:月|[/-])(\d{1,2})日?$/);
    if (!match) throw new Error("日付形式が正しくありません: " + value);
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  }
  if (!validDate(year, month, day)) {
    throw new Error("存在しない日付です: " + value);
  }
  return [year, String(month).padStart(2, "0"), String(day).padStart(2, "0")].join("-");
}

export function splitAuctionPeriod(value) {
  const source = text(value).normalize("NFKC");
  if (!source) return [null, null];
  const datePattern = /令和(?:元|\d+)年\d{1,2}月\d{1,2}日|(?:19|20)\d{2}(?:年|[/-])\d{1,2}(?:月|[/-])\d{1,2}日?/g;
  const dates = source.match(datePattern) || [];
  if (dates.length < 2) {
    throw new Error("入札期間を開始日と終了日に分割できません: " + value);
  }
  return [normalizeAuctionDate(dates[0]), normalizeAuctionDate(dates[1])];
}

function parseMoney(value, label) {
  const source = text(value).normalize("NFKC");
  if (!source) return { value: null, warnings: [] };
  const hasMan = source.includes("万円");
  const hasYen = source.includes("円");
  const plain = source.replace(/[,\s]/g, "").replace(/万円|円|¥/g, "");
  const number = Number(plain);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(label + "の金額形式が正しくありません: " + value);
  }
  const inferMan = !hasMan && number < 100000;
  const yen = Math.round(number * (hasMan || inferMan ? 10000 : 1));
  const warnings = [];
  if (hasMan) warnings.push(label + "は万円表記から円へ換算しました");
  else if (inferMan) warnings.push(label + "は100,000未満のため万円と推測しました");
  else if (!hasYen) warnings.push(label + "は単位なしのため円として判定しました");
  return { value: yen, warnings };
}

function parseArea(value, label) {
  const source = text(value).normalize("NFKC");
  if (!source) return null;
  const plain = source.replace(/[,\s]/g, "")
    .replace(/平方メートル|m(?:2|²)|㎡/gi, "");
  const number = Number(plain);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(label + "の数値形式が正しくありません: " + value);
  }
  return number;
}

function parseInteger(value, label, fallback = null) {
  const source = text(value).normalize("NFKC");
  if (!source) return fallback;
  const plain = source.replace(/[,\s]/g, "").replace(/^第/, "").replace(/号$/, "");
  const number = Number(plain);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(label + "の数値形式が正しくありません: " + value);
  }
  return number;
}

function normalizeType(value) {
  const source = text(value).normalize("NFKC");
  if (!source) return { value: "その他", warning: "種別が空欄のため「その他」と判定しました" };
  if (source.includes("区分所有") || source.includes("マンション")) {
    return { value: "マンション", warning: null };
  }
  if (source.includes("土地") && source.includes("建物")) {
    return { value: "戸建て", warning: null };
  }
  if (source.includes("一戸建") || source.includes("戸建")) {
    return { value: "戸建て", warning: null };
  }
  if (source.includes("土地")) return { value: "土地", warning: null };
  if (source === "その他") return { value: "その他", warning: null };
  return { value: "その他", warning: "種別「" + source + "」を「その他」と判定しました" };
}

function normalizeActive(value) {
  const source = text(value).normalize("NFKC").toLowerCase();
  if (!source) return true;
  if (["true", "1", "yes", "有効", "公開"].includes(source)) return true;
  if (["false", "0", "no", "無効", "非公開"].includes(source)) return false;
  throw new Error("activeはtrueまたはfalseで入力してください: " + value);
}

export function auctionPasteId(values) {
  const court = text(values.court).replace(/\s+/g, "") || "裁判所未入力";
  const caseNo = text(values.case_no).replace(/\s+/g, "");
  const itemNo = Math.max(1, Number(values.item_no) || 1);
  return [court, caseNo, Math.floor(itemNo)].join(":");
}

function isOfficialBitUrl(value) {
  try {
    const url = new URL(text(value));
    return url.protocol === "https:" && url.hostname === "www.bit.courts.go.jp";
  } catch {
    return false;
  }
}

function evaluateValues(raw, line) {
  const errors = [];
  const warnings = [];
  const values = {
    id: text(raw.id),
    court: text(raw.court),
    case_no: text(raw.case_no),
    item_no: 1,
    pref: text(raw.pref),
    city: text(raw.city),
    address: text(raw.address),
    type: "その他",
    min_price: null,
    deposit: null,
    bid_start: null,
    bid_end: null,
    open_date: null,
    built_year: null,
    floor_area: null,
    land_area: null,
    bit_url: text(raw.bit_url),
    active: true,
  };

  const capture = (run, fallback, assign) => {
    try {
      assign(run());
    } catch (error) {
      errors.push(String(error && error.message || error));
      assign(fallback);
    }
  };

  capture(() => {
    const value = parseInteger(raw.item_no, "物件番号", 1);
    if (value < 1) throw new Error("物件番号は1以上で入力してください");
    return value;
  }, text(raw.item_no),
    (value) => { values.item_no = value; });

  const type = normalizeType(raw.type);
  values.type = type.value;
  if (type.warning) warnings.push(type.warning);

  capture(() => parseMoney(raw.min_price, "売却基準価額"), text(raw.min_price),
    (result) => {
      if (result && typeof result === "object") {
        values.min_price = result.value;
        warnings.push(...result.warnings);
      } else values.min_price = result;
    });
  capture(() => parseMoney(raw.deposit, "買受申出保証額"), text(raw.deposit),
    (result) => {
      if (result && typeof result === "object") {
        values.deposit = result.value;
        warnings.push(...result.warnings);
      } else values.deposit = result;
    });

  let period = [null, null];
  if (text(raw.bid_period)) {
    capture(() => splitAuctionPeriod(raw.bid_period), [text(raw.bid_period), null],
      (value) => { period = value; });
  }
  capture(() => normalizeAuctionDate(raw.bid_start || period[0]), text(raw.bid_start || period[0]),
    (value) => { values.bid_start = value; });
  capture(() => normalizeAuctionDate(raw.bid_end || period[1]), text(raw.bid_end || period[1]),
    (value) => { values.bid_end = value; });
  capture(() => normalizeAuctionDate(raw.open_date), text(raw.open_date),
    (value) => { values.open_date = value; });

  capture(() => parseInteger(raw.built_year, "築年"), text(raw.built_year),
    (value) => { values.built_year = value; });
  capture(() => parseArea(raw.floor_area, "建物面積"), text(raw.floor_area),
    (value) => { values.floor_area = value; });
  capture(() => parseArea(raw.land_area, "土地面積"), text(raw.land_area),
    (value) => { values.land_area = value; });
  capture(() => normalizeActive(raw.active), true,
    (value) => { values.active = value; });

  if (!values.case_no) errors.push("事件番号(case_no)がありません");
  if (values.bit_url && !isOfficialBitUrl(values.bit_url)) {
    errors.push("物件URLはBIT公式サイト(https://www.bit.courts.go.jp/)に限ります");
  }

  if (!values.id) values.id = auctionPasteId(values);

  const missing = [];
  if (!values.court) missing.push("裁判所");
  if (!values.pref && !values.city && !values.address) missing.push("所在地");
  if (values.min_price == null) missing.push("売却基準価額");
  if (!values.bid_start || !values.bid_end) missing.push("入札期間");
  if (!values.open_date) missing.push("開札日");
  if (missing.length) warnings.push("任意項目の不足: " + missing.join("・"));

  return {
    line,
    raw: { ...raw },
    values,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    status: errors.length ? "error" : warnings.length ? "warning" : "ok",
  };
}

export function parseAuctionPaste(source) {
  const parsed = parsePastedTable(source);
  if (!parsed.length) throw new Error("貼り付け内容が空です");
  const mapped = parsed[0].map(pasteHeaderKey);
  const hasHeader = mapped.filter(Boolean).length >= 2;
  const headers = hasHeader ? mapped : AUCTION_CSV_COLUMNS;
  const body = hasHeader ? parsed.slice(1) : parsed;
  if (!body.length) throw new Error("登録候補のデータ行がありません");
  if (body.length > 1000) throw new Error("1回に解析できるのは1,000件までです");

  const seen = new Set();
  return body.map((cells, index) => {
    const raw = {};
    headers.forEach((key, column) => {
      if (key && raw[key] == null) raw[key] = cells[column] == null ? "" : cells[column];
    });
    const evaluated = evaluateValues(raw, index + (hasHeader ? 2 : 1));
    if (!hasHeader) {
      evaluated.warnings.push("ヘッダーを検出できなかったため既定の列順として解析しました");
      if (!evaluated.errors.length) evaluated.status = "warning";
    }
    if (evaluated.values.id && seen.has(evaluated.values.id)) {
      evaluated.errors.push("貼り付け内容で物件IDが重複しています: " + evaluated.values.id);
      evaluated.status = "error";
    }
    if (evaluated.values.id) seen.add(evaluated.values.id);
    return { ...evaluated, selected: evaluated.errors.length === 0 };
  });
}

export function updateAuctionPasteRow(row, key, value) {
  const evaluated = evaluateValues({ ...(row.raw || row.values), [key]: value }, row.line);
  return {
    ...evaluated,
    selected: evaluated.errors.length
      ? false : row.errors.length ? true : row.selected,
  };
}

function csvCell(value) {
  const source = String(value == null ? "" : value);
  return /[",\r\n]/.test(source)
    ? '"' + source.replace(/"/g, '""') + '"' : source;
}

export function auctionPasteRowsToCsv(rows) {
  const lines = rows.map((row) => {
    const values = row.values || row;
    return AUCTION_CSV_COLUMNS.map((key) => csvCell(values[key])).join(",");
  });
  return AUCTION_CSV_COLUMNS.join(",") + "\n" + lines.join("\n");
}

export function auctionTemplateCsv() {
  const example = {
    id: "", court: "東京地方裁判所", case_no: "令和8年(ケ)第1号", item_no: 1,
    pref: "東京都", city: "文京区", address: "文京区○○", type: "マンション",
    min_price: 12890000, deposit: 2578000, bid_start: "2026-08-04",
    bid_end: "2026-08-12", open_date: "2026-08-19", built_year: 2001,
    floor_area: 45.2, land_area: "", bit_url: "",
    active: true,
  };
  return "\uFEFF" + auctionPasteRowsToCsv([example]);
}
