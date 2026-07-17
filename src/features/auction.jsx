import React, { useEffect, useMemo, useState } from "react";
import { supabase, authEnabled } from "../auth.js";
import { T } from "../theme.js";
import { cardSt, h2St, btnSt } from "../ui.jsx";

const PREFECTURES = [
  "", "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
  "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
  "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
  "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];

const TYPES = ["", "マンション", "戸建て", "土地", "その他"];
const DEFAULT_FILTERS = { pref: "", type: "", maxPriceMan: "", sort: "bid_end" };
const CHECK_ITEMS = [
  "占有者の有無", "引渡命令の要否", "滞納管理費", "境界・越境",
  "再建築可否", "内覧不可前提の修繕予備費",
];

const inputSt = {
  width: "100%", padding: "8px 10px", border: `1px solid ${T.line}`,
  borderRadius: 7, fontSize: 13, color: T.ink, background: "#FBFCFD",
};

const labelSt = { display: "block", fontSize: 11.5, color: T.sub };

export function auctionRequest(filters, page) {
  const maxPriceMan = Number(filters.maxPriceMan);
  return {
    pref: filters.pref,
    type: filters.type,
    maxPrice: filters.maxPriceMan === "" || !Number.isFinite(maxPriceMan)
      ? null : Math.max(0, Math.floor(maxPriceMan * 10000)),
    sort: filters.sort,
    page,
  };
}

export function followRecord(item) {
  return {
    id: item.id,
    court: item.court,
    case_no: item.case_no,
    item_no: item.item_no,
    pref: item.pref,
    city: item.city,
    type: item.type,
    min_price: item.min_price,
    bid_start: item.bid_start,
    bid_end: item.bid_end,
    open_date: item.open_date,
    bit_url: item.bit_url,
  };
}

const yen = (value) => Number.isFinite(Number(value))
  ? Math.round(Number(value)).toLocaleString() + "円" : "—";
const dateLabel = (value) => value ? String(value).replace(/-/g, "/") : "—";

async function accessToken() {
  if (!authEnabled) return null;
  const { data } = await supabase.auth.getSession();
  return data.session ? data.session.access_token : null;
}

async function fetchAuctions(filters, page) {
  const token = await accessToken();
  if (!token) throw new Error("競売一覧の利用にはログインが必要です");
  const response = await fetch("/api/auction-list", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify(auctionRequest(filters, page)),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || !Array.isArray(data.items)) {
    throw new Error((data && data.error) || "競売データの取得に失敗しました");
  }
  return data;
}

function Checklist() {
  return (
    <section style={{ ...cardSt, marginTop: 14 }}>
      <h2 style={h2St}>3点セット確認チェックリスト</h2>
      <div style={{ display: "grid", gap: 8,
        gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))" }}>
        {CHECK_ITEMS.map((label) => (
          <label key={label} style={{ display: "flex", alignItems: "center", gap: 8,
            padding: "8px 10px", border: `1px solid ${T.line}`, borderRadius: 8,
            fontSize: 12.5, color: T.ink, cursor: "pointer" }}>
            <input type="checkbox" />
            {label}
          </label>
        ))}
      </div>
      <div style={{ fontSize: 11, color: T.sub, marginTop: 9 }}>
        このチェック欄は印刷・確認用です。チェック状態は保存されません。
      </div>
    </section>
  );
}

function AuctionCard({ item, followed, onBid, onToggleFollow }) {
  const location = [item.pref, item.city].filter(Boolean).join("");
  return (
    <article style={{ border: `1px solid ${T.line}`, borderRadius: 12,
      padding: 14, background: "#FFF", boxShadow: "0 6px 18px rgba(31,58,82,.05)" }}>
      <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between",
        gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 15, color: T.navy }}>{location || "所在地未登録"}</strong>
            <span style={{ fontSize: 11, color: T.blue, background: "rgba(45,125,210,.09)",
              padding: "2px 8px", borderRadius: 10 }}>{item.type || "その他"}</span>
            {item.isNew && (
              <span style={{ fontSize: 10.5, fontWeight: 800, color: "#FFF",
                background: T.real, padding: "2px 8px", borderRadius: 10 }}>NEW</span>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: T.sub, marginTop: 4 }}>
            {[item.court, item.case_no,
              item.item_no != null ? "物件番号" + item.item_no : ""].filter(Boolean).join(" ／ ")}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10.5, color: T.sub }}>売却基準価額</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: T.real }}>{yen(item.min_price)}</div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 8, marginTop: 12,
        gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
        <div style={{ padding: "8px 10px", borderRadius: 8, background: "#F7F9FB" }}>
          <div style={{ fontSize: 10.5, color: T.sub }}>入札期間</div>
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>
            {dateLabel(item.bid_start)} 〜 {dateLabel(item.bid_end)}
          </div>
        </div>
        <div style={{ padding: "8px 10px", borderRadius: 8, background: "#F7F9FB" }}>
          <div style={{ fontSize: 10.5, color: T.sub }}>開札日</div>
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>{dateLabel(item.open_date)}</div>
        </div>
        <div style={{ padding: "8px 10px", borderRadius: 8, background: "#F7F9FB" }}>
          <div style={{ fontSize: 10.5, color: T.sub }}>買受申出保証額</div>
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>{yen(item.deposit)}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12,
        alignItems: "center" }}>
        <button type="button" onClick={() => onBid(item)} style={btnSt(T.blue)}>
          入札上限を計算
        </button>
        <button type="button" onClick={() => onToggleFollow(item)}
          style={{ ...btnSt(followed ? T.sub : T.teal) }}>
          {followed ? "フォロー解除" : "フォロー"}
        </button>
        <a href={item.bit_url} target="_blank" rel="noreferrer"
          style={{ fontSize: 12.5, color: T.blue, textDecoration: "underline",
            marginLeft: "auto" }}>
          BITで3点セットを見る↗
        </a>
      </div>
    </article>
  );
}

export default function AuctionTab({
  follows, onToggleFollow, onBid, loadData, saveData,
}) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState({ items: [], total: 0, page: 1, hasMore: false });
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    loadData("auction-search", DEFAULT_FILTERS).then((saved) => {
      if (!active) return;
      setFilters({ ...DEFAULT_FILTERS, ...(saved || {}) });
      setReady(true);
    });
    return () => { active = false; };
  }, [loadData]);

  const followedIds = useMemo(() => new Set(follows.map((item) => item.id)), [follows]);

  const search = async (page = 1) => {
    if (!ready) return;
    setStatus("loading");
    setError("");
    await saveData("auction-search", filters);
    try {
      const data = await fetchAuctions(filters, page);
      setResult(data);
      setStatus("done");
    } catch (err) {
      setError(String((err && err.message) || err));
      setStatus("error");
    }
  };

  return (
    <div>
      <section style={cardSt}>
        <h2 style={h2St}>競売ウォッチ</h2>
        <div style={{ fontSize: 12.5, color: T.sub, lineHeight: 1.7, marginBottom: 12 }}>
          管理者がBITから確認・登録した競売物件を検索できます。
        </div>
        <div style={{ display: "grid", gap: 10,
          gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
          <label style={labelSt}>都道府県
            <select value={filters.pref}
              onChange={(e) => setFilters({ ...filters, pref: e.target.value })}
              style={{ ...inputSt, marginTop: 3 }}>
              {PREFECTURES.map((value) => (
                <option key={value || "all"} value={value}>{value || "すべて"}</option>
              ))}
            </select>
          </label>
          <label style={labelSt}>種別
            <select value={filters.type}
              onChange={(e) => setFilters({ ...filters, type: e.target.value })}
              style={{ ...inputSt, marginTop: 3 }}>
              {TYPES.map((value) => (
                <option key={value || "all"} value={value}>{value || "すべて"}</option>
              ))}
            </select>
          </label>
          <label style={labelSt}>売却基準価額の上限
            <input type="number" min={0} step={100} value={filters.maxPriceMan}
              onChange={(e) => setFilters({ ...filters, maxPriceMan: e.target.value })}
              placeholder="例: 3000" style={{ ...inputSt, marginTop: 3 }} />
            <span style={{ fontSize: 10.5 }}>万円</span>
          </label>
          <label style={labelSt}>並び順
            <select value={filters.sort}
              onChange={(e) => setFilters({ ...filters, sort: e.target.value })}
              style={{ ...inputSt, marginTop: 3 }}>
              <option value="bid_end">入札期限が近い順</option>
              <option value="min_price">基準価額が安い順</option>
            </select>
          </label>
        </div>
        <button type="button" disabled={!ready || status === "loading"}
          onClick={() => search(1)}
          style={{ ...btnSt(T.navy), marginTop: 12,
            opacity: !ready || status === "loading" ? 0.6 : 1 }}>
          {status === "loading" ? "検索中…" : "競売物件を検索"}
        </button>
        {error && (
          <div role="alert" style={{ marginTop: 10, padding: "9px 11px",
            borderRadius: 8, color: T.real, background: "rgba(209,75,50,.08)",
            fontSize: 12.5 }}>{error}</div>
        )}
      </section>

      {status === "done" && (
        <section style={cardSt}>
          <div style={{ display: "flex", justifyContent: "space-between",
            alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <h2 style={{ ...h2St, marginBottom: 0 }}>検索結果 {result.total.toLocaleString()}件</h2>
            <span style={{ fontSize: 11.5, color: T.sub }}>{result.page}ページ目</span>
          </div>
          {result.items.length ? (
            <div style={{ display: "grid", gap: 10 }}>
              {result.items.map((item) => (
                <AuctionCard key={item.id} item={item} followed={followedIds.has(item.id)}
                  onBid={onBid} onToggleFollow={onToggleFollow} />
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: T.sub, padding: "16px 0" }}>
              条件に合う入札受付中の物件はありません。
            </div>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14 }}>
            <button type="button" disabled={result.page <= 1 || status === "loading"}
              onClick={() => search(result.page - 1)}
              style={{ ...btnSt(T.sub), opacity: result.page <= 1 ? 0.45 : 1 }}>前へ</button>
            <button type="button" disabled={!result.hasMore || status === "loading"}
              onClick={() => search(result.page + 1)}
              style={{ ...btnSt(T.navy), opacity: result.hasMore ? 1 : 0.45 }}>次へ</button>
          </div>
        </section>
      )}

      <Checklist />
      <div style={{ fontSize: 11.5, color: T.real, lineHeight: 1.7,
        padding: "0 4px 14px" }}>
        競売には引渡し・占有・瑕疵のリスクがあり、3点セットの精読と現地確認が不可欠です
      </div>
    </div>
  );
}
