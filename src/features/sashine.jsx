import React, { useMemo, useState } from "react";
import { computeMetrics } from "../engine.js";
import { T } from "../theme.js";
import { Field, Select, cardSt, h2St, LockCard } from "../ui.jsx";

function withPrice(p, price, extraCostsYen) {
  const pctExtra = extraCostsYen > 0 ? (extraCostsYen / (price * 1e4)) * 100 : 0;
  return { ...p, price, costsPct: p.costsPct + pctExtra };
}

export function solveMaxPrice(p, extraCostsYen, check) {
  if (!p || p.price <= 0) return null;
  let lo = p.price * 0.1;
  let hi = p.price * 2.0;
  if (!check(computeMetrics(withPrice(p, lo, extraCostsYen)), withPrice(p, lo, extraCostsYen))) {
    return null;
  }
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const q = withPrice(p, mid, extraCostsYen);
    if (check(computeMetrics(q), q)) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo);
}

const targetOptions = [
  { v: "irr", l: "IRR ≥ X%" },
  { v: "cf", l: "月次CF ≥ X円" },
  { v: "dscr", l: "DSCR ≥ X" },
];

const money = (v) => Math.round(v).toLocaleString() + "円";
const pct = (v) => (v == null || !isFinite(v) ? "—" : v.toFixed(1) + "%");
const ratio = (v) => (v == null || !isFinite(v) ? "—" : v.toFixed(2));

export default function SashineLab({ p, isPro, onUpgrade }) {
  const [mode, setMode] = useState("normal");
  const [targetType, setTargetType] = useState("irr");
  const [targetValue, setTargetValue] = useState(5);
  const [evictionCost, setEvictionCost] = useState(500000);
  const [arrearsCost, setArrearsCost] = useState(200000);
  const [repairCost, setRepairCost] = useState(1000000);
  const [otherCost, setOtherCost] = useState(300000);

  const extraCostsYen = mode === "auction"
    ? evictionCost + arrearsCost + repairCost + otherCost : 0;

  const result = useMemo(() => {
    const check = targetType === "irr"
      ? (m) => m.irr != null && m.irr >= targetValue
      : targetType === "cf"
        ? (m) => m.real[0].cf / 12 >= targetValue
        : (m) => m.dscr == null || m.dscr >= targetValue;
    const price = solveMaxPrice(p, extraCostsYen, check);
    if (price == null) return null;
    const q = withPrice(p, price, extraCostsYen);
    return { price, metrics: computeMetrics(q) };
  }, [p, targetType, targetValue, extraCostsYen]);

  const switchMode = (next) => {
    setMode(next);
    setTargetType("irr");
    setTargetValue(next === "auction" ? 8 : 5);
  };

  const targetUnit = targetType === "irr" ? "%" : targetType === "cf" ? "円/月" : "";
  const targetStep = targetType === "cf" ? 1000 : 0.1;
  const gapPct = result && p.price > 0 ? ((result.price - p.price) / p.price) * 100 : null;
  const bidGuide = result ? Math.floor(result.price / 10) * 10 : null;

  const content = (
    <section style={cardSt}>
      <h2 style={h2St}>指値・入札上限逆算機</h2>
      <div style={{ fontSize: 12.5, color: T.sub, lineHeight: 1.7, marginBottom: 12 }}>
        目標とする投資指標から、この条件で購入できる上限価格を逆算します。
      </div>
      <div style={{ display: "flex", border: `1px solid ${T.line}`, borderRadius: 8,
        overflow: "hidden", width: "fit-content", marginBottom: 14 }}>
        {[["normal", "通常物件の指値"], ["auction", "競売の入札上限"]].map(([key, label]) => (
          <button key={key} type="button" aria-pressed={mode === key}
            onClick={() => switchMode(key)}
            style={{ padding: "8px 16px", border: "none", cursor: "pointer",
              fontSize: 12.5, fontWeight: 700,
              background: mode === key ? T.grad : "#FFF",
              color: mode === key ? "#FFF" : T.ink }}>
            {label}
          </button>
        ))}
      </div>
      <div style={{ display: "grid", gap: 12,
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <Select label="目標" value={targetType} onChange={setTargetType}
          options={targetOptions} />
        <Field label="目標値" value={targetValue} onChange={setTargetValue}
          unit={targetUnit} step={targetStep} />
      </div>
      {mode === "auction" && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px dashed ${T.line}` }}>
          <div style={{ display: "grid", gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <Field label="立退き・占有対応費" value={evictionCost}
              onChange={setEvictionCost} unit="円" step={10000} min={0} />
            <Field label="滞納管理費等の引受" value={arrearsCost}
              onChange={setArrearsCost} unit="円" step={10000} min={0} />
            <Field label="取得後修繕費" value={repairCost}
              onChange={setRepairCost} unit="円" step={10000} min={0} />
            <Field label="その他（登録免許税等）" value={otherCost}
              onChange={setOtherCost} unit="円" step={10000} min={0} />
          </div>
          <div style={{ fontSize: 11.5, color: T.sub, lineHeight: 1.7, marginTop: 9 }}>
            競売は仲介手数料が不要な一方、これらの競売特有コストを価格に織り込みます
          </div>
        </div>
      )}
      <div style={{ marginTop: 16, padding: 16, borderRadius: 12,
        background: "linear-gradient(135deg,rgba(45,125,210,.08),rgba(43,184,163,.10))",
        border: `1px solid ${T.line}` }}>
        {result ? (<>
          <div style={{ fontSize: 11.5, color: T.sub }}>逆算上限価格</div>
          <div style={{ fontSize: 30, fontWeight: 800, color: T.navy,
            fontVariantNumeric: "tabular-nums", lineHeight: 1.35 }}>
            {result.price.toLocaleString()}万円
          </div>
          <div style={{ fontSize: 12.5, color: gapPct >= 0 ? T.good : T.real, marginTop: 2 }}>
            現在の売出価格 {p.price.toLocaleString()}万円との差 {gapPct >= 0 ? "+" : ""}{pct(gapPct)}
          </div>
          {mode === "auction" && (
            <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8,
              background: "#FFF", color: T.navy, fontSize: 13, fontWeight: 700 }}>
              入札額の目安: {bidGuide.toLocaleString()}万円
              <span style={{ fontSize: 11, color: T.sub, fontWeight: 400 }}>（10万円単位で切り捨て）</span>
            </div>
          )}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 12,
            paddingTop: 10, borderTop: `1px solid ${T.line}` }}>
            <span style={{ fontSize: 12, color: T.sub }}>
              IRR <strong style={{ color: T.ink }}>{pct(result.metrics.irr)}</strong>
            </span>
            <span style={{ fontSize: 12, color: T.sub }}>
              月次CF <strong style={{ color: T.ink }}>{money(result.metrics.real[0].cf / 12)}</strong>
            </span>
            <span style={{ fontSize: 12, color: T.sub }}>
              DSCR <strong style={{ color: T.ink }}>{ratio(result.metrics.dscr)}</strong>
            </span>
          </div>
        </>) : (
          <div style={{ fontSize: 13, color: T.real, lineHeight: 1.7 }}>
            現在の探索範囲では、指定した目標を満たす価格を算出できません。
          </div>
        )}
      </div>
      <div style={{ fontSize: 11, color: T.sub, marginTop: 10 }}>
        逆算値は現在のパラメータ前提に基づく参考値です
      </div>
    </section>
  );

  return isPro ? content : (
    <LockCard onUpgrade={onUpgrade} label="指値・入札上限逆算機">
      {content}
    </LockCard>
  );
}
