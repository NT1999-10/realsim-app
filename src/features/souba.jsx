import React, { useMemo, useState } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { supabase, authEnabled } from "../auth.js";
import { T } from "../theme.js";
import { Field, Select, Kpi, cardSt, h2St, btnSt, LockCard } from "../ui.jsx";

const PREFECTURES = [
  ["01", "北海道"], ["02", "青森県"], ["03", "岩手県"], ["04", "宮城県"],
  ["05", "秋田県"], ["06", "山形県"], ["07", "福島県"], ["08", "茨城県"],
  ["09", "栃木県"], ["10", "群馬県"], ["11", "埼玉県"], ["12", "千葉県"],
  ["13", "東京都"], ["14", "神奈川県"], ["15", "新潟県"], ["16", "富山県"],
  ["17", "石川県"], ["18", "福井県"], ["19", "山梨県"], ["20", "長野県"],
  ["21", "岐阜県"], ["22", "静岡県"], ["23", "愛知県"], ["24", "三重県"],
  ["25", "滋賀県"], ["26", "京都府"], ["27", "大阪府"], ["28", "兵庫県"],
  ["29", "奈良県"], ["30", "和歌山県"], ["31", "鳥取県"], ["32", "島根県"],
  ["33", "岡山県"], ["34", "広島県"], ["35", "山口県"], ["36", "徳島県"],
  ["37", "香川県"], ["38", "愛媛県"], ["39", "高知県"], ["40", "福岡県"],
  ["41", "佐賀県"], ["42", "長崎県"], ["43", "熊本県"], ["44", "大分県"],
  ["45", "宮崎県"], ["46", "鹿児島県"], ["47", "沖縄県"],
].map(([v, l]) => ({ v, l }));

const TYPE_OPTIONS = [
  { v: "mansion", l: "中古マンション" },
  { v: "house", l: "戸建て" },
  { v: "land", l: "土地" },
];

const STAGE_ERRORS = {
  auth: "APIキーが未設定または無効です(Vercelの環境変数 MLIT_API_KEY を確認してください)",
  xit002: "市区町村が見つかりませんでした。表記(例: 文京区)をご確認ください",
  empty: "この地域・種別の取引データが見つかりませんでした。種別や市区町村を変えてお試しください",
  timeout: "データ取得に時間がかかっています。時間をおいて再度お試しください",
  parse: "データの取得に失敗しました。時間をおいて再度お試しください",
  other: "データの取得に失敗しました。時間をおいて再度お試しください",
};

const inputStyle = {
  width: "100%", padding: "8px 10px", border: `1px solid ${T.line}`,
  borderRadius: 6, fontSize: 14, color: T.ink, background: "#FBFCFD",
};

const unitMan = (value) => {
  if (value == null || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? (number / 10000).toFixed(1) + "万円/㎡" : "—";
};

export function evaluateDeviation(value) {
  if (!Number.isFinite(value)) {
    return { color: T.sub, label: "判定できません" };
  }
  if (value < -10) return { color: T.blue, label: "割安圏。相場より安い理由(再建築不可・借地権・築古・低層階など)の確認を" };
  if (value <= 10) return { color: T.good, label: "相場圏内" };
  if (value <= 25) return { color: T.warnInk, label: "やや割高" };
  return { color: T.real, label: "割高。指値の根拠になります" };
}

async function accessToken() {
  if (!authEnabled) return null;
  const { data } = await supabase.auth.getSession();
  return data.session ? data.session.access_token : null;
}

async function requestMarketPrice(body) {
  const token = await accessToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const response = await fetch("/api/market-price", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!data || data.ok !== true) {
    const stage = data && data.stage;
    throw new Error(STAGE_ERRORS[stage] || STAGE_ERRORS.other);
  }
  return data;
}

function MarketTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const point = payload[0] && payload[0].payload;
  if (!point) return null;
  return (
    <div style={{ padding: "8px 10px", borderRadius: 8, background: "#FFF",
      border: `1px solid ${T.line}`, boxShadow: "0 8px 22px rgba(31,58,82,.14)",
      fontSize: 11.5, lineHeight: 1.7, color: T.ink }}>
      <div style={{ fontWeight: 700, color: point.target ? T.real : T.navy }}>
        {point.target ? "対象物件" : "成約事例"}
      </div>
      <div>面積 {Number(point.area).toLocaleString()}㎡</div>
      <div>単価 {unitMan(point.unit)}</div>
      {!point.target && point.period && <div>{point.period}</div>}
    </div>
  );
}

export default function SoubaCheck({ p, isPro, onUpgrade }) {
  const [pref, setPref] = useState("13");
  const [cityName, setCityName] = useState("");
  const [type, setType] = useState("mansion");
  const [area, setArea] = useState(25);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const targetUnit = area > 0 ? (Number(p.price) * 10000) / area : null;
  const deviation = result && result.medianUnitYenPerM2 > 0 && targetUnit != null
    ? ((targetUnit - result.medianUnitYenPerM2) / result.medianUnitYenPerM2) * 100
    : null;
  const verdict = evaluateDeviation(deviation);

  const clearResult = () => {
    setResult(null);
    setError("");
  };

  const chartSamples = useMemo(() => {
    if (!result || !Array.isArray(result.samples)) return [];
    return result.samples
      .map((sample) => ({
        ...sample,
        area: Number(sample.area),
        unit: Number(sample.unit),
      }))
      .filter((sample) => Number.isFinite(sample.area) && Number.isFinite(sample.unit));
  }, [result]);

  const compare = async () => {
    const city = cityName.trim();
    if (!city) { setError("市区町村を入力してください"); return; }
    if (!(area > 0)) { setError("専有面積を入力してください"); return; }

    setLoading(true);
    setResult(null);
    setError("");
    try {
      const data = await requestMarketPrice({ pref, cityName: city, type });
      const count = Number(data.count) || 0;
      if (count < 5) {
        throw new Error(`データが少なすぎます(n<5、取得${count}件)`);
      }
      if (!Number.isFinite(Number(data.medianUnitYenPerM2))) {
        throw new Error("相場単価を算出できませんでした");
      }
      setResult(data);
    } catch (err) {
      setError(String((err && err.message) || err));
    } finally {
      setLoading(false);
    }
  };

  const content = (
    <section style={cardSt}>
      <h2 style={h2St}>国交省データで相場照合</h2>
      <div style={{ fontSize: 12.5, color: T.sub, lineHeight: 1.7, marginBottom: 12 }}>
        国土交通省の直近の取引事例(データ整備済みの過去3年分)から、対象物件の㎡単価を照合します。
      </div>

      <div style={{ display: "grid", gap: 12,
        gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
        <Select label="都道府県" value={pref}
          onChange={(value) => { setPref(value); clearResult(); }} options={PREFECTURES} />
        <label style={{ display: "block" }}>
          <span style={{ fontSize: 12, color: T.sub, display: "block", marginBottom: 3 }}>
            市区町村
          </span>
          <input type="text" value={cityName}
            onChange={(e) => { setCityName(e.target.value); clearResult(); }}
            placeholder="例: 文京区" style={inputStyle} />
        </label>
        <Select label="種別" value={type}
          onChange={(value) => { setType(value); clearResult(); }} options={TYPE_OPTIONS} />
        <Field label="専有面積" value={area} onChange={setArea}
          unit="㎡" step={0.1} min={1} />
      </div>

      <button type="button" onClick={compare} disabled={loading}
        style={{ ...btnSt(T.blue), marginTop: 13, opacity: loading ? 0.6 : 1 }}>
        {loading ? "照合中…" : "相場を照合する"}
      </button>

      {error && (
        <div role="alert" style={{ marginTop: 10, padding: "9px 11px",
          borderRadius: 8, background: T.realSoft, color: T.real,
          fontSize: 12.5, lineHeight: 1.7 }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Kpi label="成約・取引事例" value={result.count.toLocaleString() + "件"}
              sub={`${result.city.name}・対象年 ${(result.years || []).join("・")}`} />
            <Kpi label="中央値単価" value={unitMan(result.medianUnitYenPerM2)}
              sub={`25–75%: ${unitMan(result.p25)}〜${unitMan(result.p75)}`} />
            <Kpi label="対象物件の単価" value={unitMan(targetUnit)}
              sub={`${Number(p.price).toLocaleString()}万円 ÷ ${area}㎡`} />
          </div>

          <div style={{ marginTop: 12, padding: 16, borderRadius: 12,
            border: `1px solid ${verdict.color}`,
            background: "linear-gradient(135deg,rgba(45,125,210,.05),rgba(255,255,255,.94))" }}>
            <div style={{ fontSize: 11.5, color: T.sub }}>中央値からの乖離</div>
            <div style={{ fontSize: 30, lineHeight: 1.3, fontWeight: 800,
              color: verdict.color, fontVariantNumeric: "tabular-nums" }}>
              {deviation == null
                ? "—" : `${deviation >= 0 ? "+" : ""}${deviation.toFixed(1)}%`}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: verdict.color }}>
              {verdict.label}
            </div>
          </div>

          <div style={{ marginTop: 14, height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={T.line} />
                <XAxis type="number" dataKey="area" name="面積" unit="㎡"
                  tick={{ fontSize: 10.5, fill: T.sub }} />
                <YAxis type="number" dataKey="unit" name="単価"
                  tickFormatter={(value) => Math.round(value / 10000) + "万"}
                  tick={{ fontSize: 10.5, fill: T.sub }} width={54} />
                <Tooltip content={<MarketTooltip />} />
                <Scatter name="成約事例" data={chartSamples} fill={T.blue} opacity={0.68} />
                <Scatter name="対象物件"
                  data={targetUnit == null
                    ? [] : [{ area: Number(area), unit: targetUnit, target: true }]}
                  fill={T.real} shape="diamond" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, color: T.sub, marginTop: 10, lineHeight: 1.7 }}>
        成約事例は立地・階数・状態の個別性が大きく、単価比較は参考情報です
      </div>
    </section>
  );

  return isPro ? content : (
    <LockCard onUpgrade={onUpgrade} label="国交省データによる相場照合">
      {content}
    </LockCard>
  );
}
