import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  ComposedChart, Line, Area, Bar, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ReferenceLine, ResponsiveContainer,
} from "recharts";
import { PLANS, PURCHASE_URL, verifyLicense, loadPlan, savePlan, aiQuota } from "./plan.js";
import { supabase, authEnabled } from "./auth.js";

// ---------- design tokens ----------
const T = {
  bg: "#EDF0F3", card: "#FFFFFF", ink: "#16222E", sub: "#5B6B7A",
  line: "#D7DDE3", navy: "#1F3A52",
  real: "#B3402E", realSoft: "rgba(179,64,46,0.10)", opt: "#7FA6B8",
  good: "#2E7D6E", warnBg: "#FBF3E6", warnInk: "#8A5A12",
  aiBg: "#EEF4F2", aiInk: "#1E5C50",
};

const fmtMan = (yen) => {
  const man = yen / 10000;
  if (Math.abs(man) >= 10000) return (man / 10000).toFixed(2) + "億円";
  return Math.round(man).toLocaleString() + "万円";
};

// ---------- simulation ----------
function simulate(p, realistic) {
  let balance = Math.max(p.price * 10000 - p.downPayment * 10000, 0);
  const loan0 = balance;
  const totalM = p.loanYears * 12;
  let remain = totalM;
  let occupied = true;
  let stateLeft = Math.max(1, Math.round(p.stayYears * 12));
  let tenancyM = 0; // 入居継続月数(更新料用)
  let accumDep = 0;
  const depAnnual = (p.price * 10000 * p.bldgRatio / 100) / Math.max(1, p.depYears);
  const years = [];
  let cum = 0;

  for (let y = 1; y <= p.simYears; y++) {
    const rate = realistic
      ? Math.min(p.rate0 + p.rateSlope * (y - 1), p.rateCap)
      : p.rate0;
    const mr = rate / 100 / 12;
    let pay = 0;
    if (balance > 0 && remain > 0 && p.repayMethod === "annuity") {
      pay = mr === 0 ? balance / remain
        : (balance * mr) / (1 - Math.pow(1 + mr, -remain));
    }
    const rent = realistic ? p.rent * Math.pow(1 - p.rentDecline / 100, y - 1) : p.rent;
    const repairY = realistic ? p.repairBase * Math.pow(1 + p.repairInfl / 100, y - 1) : p.repairBase;
    const bldgFeeM = realistic ? p.bldgFee * Math.pow(1 + p.bldgFeeInfl / 100, y - 1) : p.bldgFee;

    let income = 0, expense = 0, loanPaid = 0, interestPaid = 0;

    for (let m = 0; m < 12; m++) {
      if (realistic) {
        if (stateLeft <= 0) {
          if (occupied) {
            occupied = false; tenancyM = 0;
            stateLeft = Math.max(0, Math.round(p.vacancyMonths));
            expense += p.restorationCost;
            if (stateLeft === 0) {
              occupied = true;
              stateLeft = Math.max(1, Math.round(p.stayYears * 12));
              expense += rent * p.adMonths;
              income += rent * p.reikinMonths;
            }
          } else {
            occupied = true;
            stateLeft = Math.max(1, Math.round(p.stayYears * 12));
            expense += rent * p.adMonths;
            income += rent * p.reikinMonths;
          }
        }
      } else occupied = true;

      if (occupied) {
        income += rent;
        expense += rent * (p.mgmtPct / 100);
        tenancyM += 1;
        // 更新料(貸主受取分)
        if (realistic && p.renewalEveryYears > 0 && tenancyM > 0 &&
            tenancyM % Math.round(p.renewalEveryYears * 12) === 0) {
          income += rent * p.renewalOwnerMonths;
        }
      }
      stateLeft -= 1;

      expense += bldgFeeM;
      expense += (p.tax + p.insurance + p.otherAnnual) / 12;
      expense += repairY / 12;

      if (balance > 0 && remain > 0) {
        const interest = balance * mr;
        let principal;
        if (p.repayMethod === "annuity") principal = Math.min(pay - interest, balance);
        else principal = Math.min(loan0 / totalM, balance); // 元金均等
        balance -= principal;
        loanPaid += interest + principal;
        interestPaid += interest;
        remain -= 1;
      }
    }

    // 設備交換・大規模修繕(現実のみ)
    let capexCost = 0;
    if (realistic) {
      for (const eq of p.equipment) {
        if (eq.on && eq.cycle > 0 && y % eq.cycle === 0) capexCost += eq.cost * 10000;
      }
      if (p.bigRepairCycle > 0 && y % p.bigRepairCycle === 0) capexCost += p.bigRepairCost * 10000;
    }
    expense += capexCost;

    // 減価償却・税(簡易)
    let dep = 0, taxPaid = 0;
    if (y <= p.depYears) { dep = depAnnual; accumDep += dep; }
    if (p.taxOn && realistic) {
      const taxable = income - (expense - 0) - interestPaid - dep; // 元金は損金不算入
      taxPaid = p.lossOffset
        ? taxable * (p.taxRate / 100)               // 損益通算(赤字なら還付)
        : Math.max(0, taxable) * (p.taxRate / 100);
    }

    const cf = income - expense - loanPaid - taxPaid;
    cum += cf;
    years.push({
      year: y, income, expense, loanPaid, interestPaid, dep, taxPaid,
      cf, cum, balance, rate, rentMonthly: rent, accumDep,
    });
  }
  return years;
}

function saleAnalysis(p, real) {
  const last = real[real.length - 1];
  let salePrice;
  if (p.saleMode === "yield") {
    salePrice = (last.rentMonthly * 12) / Math.max(0.1, p.exitYieldPct / 100);
  } else {
    salePrice = p.price * 10000 * Math.pow(1 + p.priceTrendPct / 100, p.simYears);
  }
  const sellCost = salePrice * (p.sellCostPct / 100);
  const book = p.price * 10000 - last.accumDep;
  const gain = salePrice - sellCost - book;
  const capTax = p.capGainTaxOn ? Math.max(0, gain) * 0.20315 : 0;
  const netSale = salePrice - sellCost - last.balance - capTax;
  const initialEquity = (p.downPayment + p.price * (p.costsPct / 100)) * 10000;
  return { salePrice, sellCost, capTax, netSale, initialEquity,
           total: last.cum + netSale - initialEquity };
}

// ---------- 投資指標 ----------
function irrOf(flows) {
  const npv = (r) => flows.reduce((s, c, i) => s + c / Math.pow(1 + r, i), 0);
  let lo = -0.95, hi = 2.0;
  if (npv(lo) * npv(hi) > 0) return null; // 解なし(全期間赤字など)
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (npv(mid) > 0) lo = mid; else hi = mid;
  }
  return ((lo + hi) / 2) * 100;
}

function computeMetrics(q) {
  const real = simulate(q, true);
  const sale = saleAnalysis(q, real);
  const y1 = real[0];
  const flows = [-sale.initialEquity,
    ...real.map((r, i) => r.cf + (i === real.length - 1 ? sale.netSale : 0))];
  const irr = irrOf(flows);
  const ccr = sale.initialEquity > 0 ? (y1.cf / sale.initialEquity) * 100 : null;
  const noi1 = y1.income - y1.expense; // 営業純収益(初年度)
  const dscr = y1.loanPaid > 0 ? noi1 / y1.loanPaid : null;
  const firstDef = real.find((r) => r.cf < 0);
  return {
    irr, ccr, dscr,
    firstDeficitYear: firstDef ? firstDef.year : null,
    cumFinal: real[real.length - 1].cum,
    total: sale.total, sale, real,
  };
}

// 売却年を総当たりして「何年目に売るのが最適か」を算出
function exitCurve(q) {
  const real = simulate(q, true);
  const initialEquity = (q.downPayment + q.price * (q.costsPct / 100)) * 10000;
  const pts = [];
  for (let y = 3; y <= q.simYears; y++) {
    const r = real[y - 1];
    const salePrice = q.saleMode === "yield"
      ? (r.rentMonthly * 12) / Math.max(0.1, q.exitYieldPct / 100)
      : q.price * 10000 * Math.pow(1 + q.priceTrendPct / 100, y);
    const sellCost = salePrice * (q.sellCostPct / 100);
    const book = q.price * 10000 - r.accumDep;
    const capTax = q.capGainTaxOn
      ? Math.max(0, salePrice - sellCost - book) * 0.20315 : 0;
    const net = salePrice - sellCost - r.balance - capTax;
    pts.push({ year: y, 総合損益: Math.round((r.cum + net - initialEquity) / 10000) });
  }
  return pts;
}

// ---------- UI pieces ----------
function Field({ label, value, onChange, unit, step = 1, min, hint, help }) {
  const [showHelp, setShowHelp] = useState(false);
  return (
    <label style={{ display: "block" }}>
      <span style={{ fontSize: 12, color: T.sub, display: "flex", alignItems: "center",
        gap: 5, marginBottom: 3 }}>
        {label}
        {help && (
          <button type="button"
            onClick={(e) => { e.preventDefault(); setShowHelp(!showHelp); }}
            style={{ width: 16, height: 16, borderRadius: 8, border: `1px solid ${T.opt}`,
              background: showHelp ? T.opt : "transparent", color: showHelp ? "#FFF" : T.opt,
              fontSize: 10, lineHeight: "13px", cursor: "pointer", padding: 0, flexShrink: 0 }}>
            ?</button>
        )}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input type="number" value={value} step={step} min={min}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          style={{ width: "100%", padding: "8px 10px", border: `1px solid ${T.line}`,
            borderRadius: 6, fontSize: 15, color: T.ink, background: "#FBFCFD",
            fontVariantNumeric: "tabular-nums" }} />
        <span style={{ fontSize: 12, color: T.sub, whiteSpace: "nowrap" }}>{unit}</span>
      </span>
      {help && showHelp && (
        <span style={{ fontSize: 11, color: T.aiInk, display: "block", marginTop: 4,
          lineHeight: 1.65, background: T.aiBg, borderRadius: 6, padding: "6px 9px" }}>{help}</span>
      )}
      {hint && <span style={{ fontSize: 11, color: T.sub, display: "block", marginTop: 2 }}>{hint}</span>}
    </label>
  );
}

function Check({ label, checked, onChange }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13,
      padding: "8px 0", cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ fontSize: 12, color: T.sub, display: "block", marginBottom: 3 }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", padding: "8px 10px", border: `1px solid ${T.line}`,
          borderRadius: 6, fontSize: 14, color: T.ink, background: "#FBFCFD" }}>
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
  );
}

function Section({ no, title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section style={{ background: T.card, borderRadius: 10, padding: 16,
      border: `1px solid ${T.line}`, marginBottom: 12 }}>
      <h2 onClick={() => setOpen(!open)} style={{
        fontSize: 13, fontWeight: 700, color: T.navy, margin: 0,
        letterSpacing: "0.06em", borderBottom: open ? `2px solid ${T.navy}` : "none",
        paddingBottom: open ? 6 : 0, marginBottom: open ? 12 : 0,
        display: "flex", justifyContent: "space-between", cursor: "pointer" }}>
        <span>{title}</span>
        <span style={{ color: T.sub, fontWeight: 400 }}>{no} {open ? "−" : "+"}</span>
      </h2>
      {open && <div style={{ display: "grid", gap: 12,
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>{children}</div>}
    </section>
  );
}

function Kpi({ label, value, color, sub }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 10,
      padding: "12px 14px", flex: "1 1 145px" }}>
      <div style={{ fontSize: 11, color: T.sub, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 700, color: color || T.ink,
        fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: T.sub, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// ---------- 永続ストレージ(汎用) ----------
const KEY_RESEARCH = "market-research-records";
const KEY_PROPS = "saved-properties";
const KEY_ACTUALS = "ops-actuals";
const memStore = {}; // window.storage非対応環境(ローカル等)向けフォールバック

function localLoad(key, fallback) {
  try {
    const r = localStorage.getItem("rs-" + key);
    return r ? JSON.parse(r) : fallback;
  } catch { return key in memStore ? memStore[key] : fallback; }
}
function localSave(key, v) {
  try { localStorage.setItem("rs-" + key, JSON.stringify(v)); }
  catch (e) { memStore[key] = v; }
}
async function cloudSession() {
  if (!authEnabled) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session || null;
  } catch { return null; }
}

async function loadKey(key, fallback) {
  // ログイン中はアカウント(Supabase)が正。未ログイン時は端末ローカル保存
  const session = await cloudSession();
  if (session) {
    try {
      const { data, error } = await supabase.from("user_data")
        .select("value").eq("key", key).maybeSingle();
      if (!error && data && data.value != null) return data.value;
      // クラウド未保存なら、端末に残っている既存データを初回移行
      // (別ユーザーの控えデータを取り込まないよう所有者を確認)
      const owner = localLoad("owner", null);
      const local = localLoad(key, undefined);
      if (local !== undefined && (!owner || owner === session.user.id)) {
        await supabase.from("user_data").upsert(
          { user_id: session.user.id, key, value: local },
          { onConflict: "user_id,key" });
        return local;
      }
      return fallback;
    } catch (e) { /* 通信断などはローカルへフォールバック */ }
  }
  if (typeof window !== "undefined" && window.storage) {
    try {
      const r = await window.storage.get(key);
      return r && r.value ? JSON.parse(r.value) : fallback;
    } catch { return fallback; }
  }
  return localLoad(key, fallback);
}

const SYNCED_KEYS = [KEY_RESEARCH, KEY_PROPS, KEY_ACTUALS, "ui-mode"];
function purgeLocalMirror() {
  try {
    for (const k of SYNCED_KEYS) localStorage.removeItem("rs-" + k);
    localStorage.removeItem("rs-owner");
  } catch (e) { /* noop */ }
  for (const k of SYNCED_KEYS) delete memStore[k];
}

async function saveKey(key, value, cap) {
  const v = cap && Array.isArray(value) ? value.slice(0, cap) : value;
  const session = await cloudSession();
  if (session) {
    try {
      await supabase.from("user_data").upsert(
        { user_id: session.user.id, key, value: v,
          updated_at: new Date().toISOString() },
        { onConflict: "user_id,key" });
    } catch (e) { console.error(e); }
    localSave(key, v); // 通信断に備えた端末側の控え
    localSave("owner", session.user.id);
    return v;
  }
  if (typeof window !== "undefined" && window.storage) {
    try { await window.storage.set(key, JSON.stringify(v)); } catch (e) { console.error(e); }
  } else {
    localSave(key, v);
  }
  return v;
}

// ---------- AI market data(サーバープロキシ経由) ----------
async function fetchMarketData(area, ptype, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch("/api/research", {
    method: "POST",
    headers,
    body: JSON.stringify({ area, ptype }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.error) {
    throw new Error((data && data.error) || `サーバーエラー(${res.status})`);
  }
  return data;
}

// ---------- タブ: 物件比較 ----------
const cardSt = { background: T.card, borderRadius: 10, padding: 16,
  border: `1px solid ${T.line}`, marginBottom: 12 };
const h2St = { fontSize: 13, fontWeight: 700, color: T.navy, margin: "0 0 12px",
  letterSpacing: "0.06em", borderBottom: `2px solid ${T.navy}`, paddingBottom: 6 };
const btnSt = (bg) => ({ padding: "8px 16px", background: bg, color: "#FFF",
  border: "none", borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: "pointer" });

function CompareTab({ properties, current, plan, onUpgrade, onSave, onLoad, onDelete, onReport }) {
  const locked = plan !== "pro";
  const [name, setName] = useState("");
  const rows = useMemo(
    () => properties.map((pr) => ({ pr, m: computeMetrics(pr.params) })),
    [properties]);
  const cur = useMemo(() => computeMetrics(current), [current]);
  const bestIrr = rows.length
    ? Math.max(...rows.map((r) => (r.m.irr == null ? -1e9 : r.m.irr))) : null;
  const pct = (v, d = 1) => (v == null || !isFinite(v) ? "—" : v.toFixed(d) + "%");
  const cell = { padding: "7px 9px", textAlign: "right", whiteSpace: "nowrap" };
  return (
    <div>
      <section style={cardSt}>
        <h2 style={h2St}>現在の設定を物件として保存</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="物件名(例: 文京区A 中古区分)"
            style={{ flex: "1 1 220px", padding: "8px 10px", border: `1px solid ${T.line}`,
              borderRadius: 6, fontSize: 14, background: "#FBFCFD" }} />
          <button onClick={() => { onSave(name); setName(""); }} style={btnSt(T.navy)}>
            保存して比較対象に追加
          </button>
        </div>
        <div style={{ fontSize: 12, color: T.sub, marginTop: 8 }}>
          現在の設定: 総合損益 {fmtMan(cur.total)}
          {locked
            ? <> ／ IRR・DSCRは <button onClick={onUpgrade} style={{ background: "none",
                border: "none", color: T.real, fontWeight: 700, cursor: "pointer",
                textDecoration: "underline", padding: 0, fontSize: 12 }}>Pro</button> で開放</>
            : <> ／ IRR {pct(cur.irr)} ／ DSCR {cur.dscr == null ? "—" : cur.dscr.toFixed(2)}</>}
        </div>
      </section>

      <section style={cardSt}>
        <h2 style={h2St}>保存済み物件の横並び比較({rows.length}件)</h2>
        {rows.length > 0 && (
          <div style={{ margin: "0 0 14px" }}>
            <button onClick={() => (locked ? onUpgrade() : onReport(rows))} style={btnSt(T.navy)}>
              📄 比較レポートを出力(PDF){locked ? " — Pro" : ""}</button>
          </div>
        )}
        {rows.length === 0 ? (
          <div style={{ fontSize: 12.5, color: T.sub }}>
            まだ保存された物件がありません。シミュレーションタブで条件を作り、上のフォームで保存すると比較表に並びます。
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%",
              fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${T.navy}`, color: T.navy }}>
                  {["物件名", "価格", "表面", "IRR", "CCR", "DSCR", "初赤字", "累積CF", "総合損益", "保存日", ""].map((h) => (
                    <th key={h} style={{ ...cell, textAlign: h === "物件名" ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ pr, m }) => {
                  const gross = (pr.params.rent * 12) / (pr.params.price * 10000) * 100;
                  const isBest = m.irr != null && m.irr === bestIrr && rows.length > 1;
                  return (
                    <tr key={pr.id} style={{ borderBottom: `1px solid ${T.line}`,
                      background: isBest ? "rgba(46,125,110,0.08)" : "transparent" }}>
                      <td style={{ ...cell, textAlign: "left", fontWeight: 700 }}>
                        {isBest && <span style={{ color: T.good }}>★ </span>}{pr.name}
                      </td>
                      <td style={cell}>{pr.params.price.toLocaleString()}万</td>
                      <td style={cell}>{pct(gross, 2)}</td>
                      <td style={{ ...cell, fontWeight: 700,
                        color: locked ? T.sub : m.irr == null ? T.sub : m.irr >= 0 ? T.good : T.real }}>
                        {locked ? "\uD83D\uDD12" : pct(m.irr)}</td>
                      <td style={cell}>{locked ? "\uD83D\uDD12" : pct(m.ccr)}</td>
                      <td style={{ ...cell,
                        color: locked ? T.sub : m.dscr == null ? T.sub : m.dscr >= 1.2 ? T.good : T.real }}>
                        {locked ? "\uD83D\uDD12" : m.dscr == null ? "—" : m.dscr.toFixed(2)}</td>
                      <td style={cell}>{m.firstDeficitYear ? m.firstDeficitYear + "年目" : "なし"}</td>
                      <td style={cell}>{fmtMan(m.cumFinal)}</td>
                      <td style={{ ...cell, fontWeight: 700,
                        color: m.total < 0 ? T.real : T.good }}>{fmtMan(m.total)}</td>
                      <td style={{ ...cell, color: T.sub }}>{pr.savedAt.slice(0, 10)}</td>
                      <td style={cell}>
                        <button onClick={() => onLoad(pr)} style={{ ...btnSt(T.navy),
                          padding: "5px 10px", fontSize: 11, marginRight: 6 }}>読込</button>
                        <button onClick={() => onDelete(pr.id)} style={{ padding: "5px 10px",
                          background: "none", color: T.real, border: `1px solid ${T.line}`,
                          borderRadius: 6, fontSize: 11, cursor: "pointer" }}>削除</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ fontSize: 11, color: T.sub, marginTop: 10, lineHeight: 1.7 }}>
          IRR: 自己資金に対する内部収益率(売却込み・税引前ベース)。CCR: 初年度CF÷初期自己資金。
          DSCR: 初年度の営業純収益÷年間返済額で、金融機関は1.2〜1.3以上を目安に見ることが多い指標です。
        </div>
      </section>
    </div>
  );
}

// ---------- タブ: 分析(感度・ストレス・出口) ----------
function AnalysisTab({ p }) {
  const base = useMemo(() => computeMetrics(p), [p]);

  const sens = useMemo(() => {
    const items = [
      { label: "家賃 ±10%", lo: (q) => ({ ...q, rent: q.rent * 0.9 }), hi: (q) => ({ ...q, rent: q.rent * 1.1 }) },
      { label: "家賃下落率 ±0.5pt", lo: (q) => ({ ...q, rentDecline: q.rentDecline + 0.5 }), hi: (q) => ({ ...q, rentDecline: Math.max(0, q.rentDecline - 0.5) }) },
      { label: "当初金利 ±0.5pt", lo: (q) => ({ ...q, rate0: q.rate0 + 0.5 }), hi: (q) => ({ ...q, rate0: Math.max(0, q.rate0 - 0.5) }) },
      { label: "金利上昇ペース 2倍/ゼロ", lo: (q) => ({ ...q, rateSlope: q.rateSlope * 2 }), hi: (q) => ({ ...q, rateSlope: 0 }) },
      { label: "空室期間 ±1ヶ月", lo: (q) => ({ ...q, vacancyMonths: q.vacancyMonths + 1 }), hi: (q) => ({ ...q, vacancyMonths: Math.max(0, q.vacancyMonths - 1) }) },
      { label: "入居期間 ±1年", lo: (q) => ({ ...q, stayYears: Math.max(0.5, q.stayYears - 1) }), hi: (q) => ({ ...q, stayYears: q.stayYears + 1 }) },
      { label: "原状回復費 ±50%", lo: (q) => ({ ...q, restorationCost: q.restorationCost * 1.5 }), hi: (q) => ({ ...q, restorationCost: q.restorationCost * 0.5 }) },
      { label: "売却利回り ±1pt", lo: (q) => ({ ...q, exitYieldPct: q.exitYieldPct + 1 }), hi: (q) => ({ ...q, exitYieldPct: Math.max(1, q.exitYieldPct - 1) }) },
    ];
    const out = items.map((it) => {
      const a = computeMetrics(it.lo(p)).total / 10000;
      const b = computeMetrics(it.hi(p)).total / 10000;
      return { label: it.label, lo: Math.min(a, b), hi: Math.max(a, b) };
    }).sort((x, y) => (y.hi - y.lo) - (x.hi - x.lo));
    const minV = Math.min(...out.map((o) => o.lo), base.total / 10000);
    const shift = -minV + 10;
    return {
      shift,
      data: out.map((o) => ({ label: o.label, offset: o.lo + shift, span: o.hi - o.lo,
        loV: Math.round(o.lo), hiV: Math.round(o.hi) })),
    };
  }, [p, base]);

  const stress = useMemo(() => {
    const presets = [
      { name: "ベース", desc: "現在の設定", mod: (q) => q },
      { name: "中度ストレス", desc: "金利+1%pt・空室1.5倍・下落+0.5pt・修繕インフレ+1pt",
        mod: (q) => ({ ...q, rate0: q.rate0 + 1, vacancyMonths: q.vacancyMonths * 1.5,
          rentDecline: q.rentDecline + 0.5, repairInfl: q.repairInfl + 1 }) },
      { name: "重度ストレス", desc: "金利+2%pt・空室2倍・下落+1pt・原状回復1.5倍・売却利回り+1pt",
        mod: (q) => ({ ...q, rate0: q.rate0 + 2, vacancyMonths: q.vacancyMonths * 2,
          rentDecline: q.rentDecline + 1, restorationCost: q.restorationCost * 1.5,
          exitYieldPct: q.exitYieldPct + 1 }) },
    ];
    return presets.map((s) => ({ ...s, m: computeMetrics(s.mod(p)) }));
  }, [p]);

  const exit = useMemo(() => exitCurve(p), [p]);
  const bestExit = exit.reduce((a, b) => (b.総合損益 > a.総合損益 ? b : a), exit[0]);

  return (
    <div>
      <section style={cardSt}>
        <h2 style={h2St}>ストレステスト — 悪条件が重なっても耐えるか</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {stress.map((s) => (
            <div key={s.name} style={{ flex: "1 1 200px", borderRadius: 8, padding: "12px 14px",
              border: `1px solid ${s.m.total >= 0 ? T.line : T.real}`,
              background: s.m.total >= 0 ? "#FBFCFD" : "rgba(179,64,46,0.06)" }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{s.name}</div>
              <div style={{ fontSize: 10.5, color: T.sub, margin: "2px 0 8px", lineHeight: 1.5 }}>{s.desc}</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.9, fontVariantNumeric: "tabular-nums" }}>
                総合損益: <b style={{ color: s.m.total < 0 ? T.real : T.good }}>{fmtMan(s.m.total)}</b><br />
                IRR: <b>{s.m.irr == null ? "—" : s.m.irr.toFixed(1) + "%"}</b><br />
                初赤字: <b>{s.m.firstDeficitYear ? s.m.firstDeficitYear + "年目" : "なし"}</b>
              </div>
              <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700,
                color: s.m.total >= 0 ? T.good : T.real }}>
                {s.m.total >= 0 ? "✓ 耐える" : "✗ 損失で終わる"}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ ...cardSt, padding: "14px 8px 4px" }}>
        <h2 style={{ ...h2St, margin: "0 8px 8px" }}>感度分析 — どの前提が結果を最も動かすか(総合損益・万円)</h2>
        <ResponsiveContainer width="100%" height={Math.max(240, sens.data.length * 38)}>
          <ComposedChart data={sens.data} layout="vertical"
            margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid stroke={T.line} strokeDasharray="2 4" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: T.sub }}
              tickFormatter={(v) => Math.round(v - sens.shift).toLocaleString()} />
            <YAxis type="category" dataKey="label" width={138}
              tick={{ fontSize: 11, fill: T.ink }} />
            <Tooltip formatter={(v, n, pr) =>
              [`${pr.payload.loV.toLocaleString()} 〜 ${pr.payload.hiV.toLocaleString()}万円`, "総合損益の振れ幅"]}
              labelStyle={{ fontSize: 12 }} />
            <Bar dataKey="offset" stackId="t" fill="transparent" legendType="none" tooltipType="none" />
            <Bar dataKey="span" stackId="t" fill={T.navy} radius={[0, 3, 3, 0]} barSize={16} />
            <ReferenceLine x={base.total / 10000 + sens.shift} stroke={T.real} strokeWidth={2}
              label={{ value: "現状", fontSize: 11, fill: T.real, position: "top" }} />
          </ComposedChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 11, color: T.sub, margin: "4px 8px 10px", lineHeight: 1.6 }}>
          バーが長い項目ほど結果への影響が大きい=その前提の見極めに時間を使うべき、という読み方をします。
        </div>
      </section>

      <section style={{ ...cardSt, padding: "14px 8px 4px" }}>
        <h2 style={{ ...h2St, margin: "0 8px 8px" }}>出口タイミング最適化 — 何年目に売るのが最も得か(万円)</h2>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={exit} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={T.line} strokeDasharray="2 4" />
            <XAxis dataKey="year" tick={{ fontSize: 11, fill: T.sub }} unit="年" />
            <YAxis tick={{ fontSize: 11, fill: T.sub }} width={56} />
            <Tooltip formatter={(v) => v.toLocaleString() + "万円"} labelFormatter={(l) => l + "年目に売却した場合"} />
            <ReferenceLine y={0} stroke={T.ink} strokeWidth={1} />
            <Line type="monotone" dataKey="総合損益" stroke={T.navy} strokeWidth={2.5} dot={false} />
            {bestExit && (
              <ReferenceLine x={bestExit.year} stroke={T.good} strokeDasharray="4 3"
                label={{ value: `最適: ${bestExit.year}年目 ${bestExit.総合損益.toLocaleString()}万`,
                  fontSize: 11, fill: T.good, position: "top" }} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 11, color: T.sub, margin: "4px 8px 10px", lineHeight: 1.6 }}>
          各年に売却した場合の「累積CF+売却手取−残債−譲渡税−初期自己資金」。残債の減りと家賃・建物の劣化のバランスで山ができます。
        </div>
      </section>
    </div>
  );
}

// ---------- タブ: 運用管理(設備台帳・予実・申告集計) ----------
const INCOME_CATS = ["家賃収入", "更新料", "礼金", "その他収入"];
const EXPENSE_CATS = ["管理委託料", "建物管理費・修繕積立金", "修繕費", "原状回復費",
  "広告料(AD)", "租税公課", "損害保険料", "支払利息", "通信費・雑費"];

function OpsTab({ p, setP, actuals, persist }) {
  const nowY = new Date().getFullYear();
  const setEq = (i, k, v) => setP((s) => ({
    ...s, equipment: s.equipment.map((e, j) => (j === i ? { ...e, [k]: v } : e)) }));

  const ledger = p.equipment.map((e, i) => {
    let next = (e.installYear || nowY) + e.cycle;
    while (next < nowY) next += e.cycle;
    return { ...e, i, next, remain: next - nowY };
  }).sort((a, b) => a.remain - b.remain);

  const [form, setForm] = useState({
    month: `${nowY}-${String(new Date().getMonth() + 1).padStart(2, "0")}`,
    kind: "income", category: "家賃収入", amount: "", memo: "" });
  const addItem = () => {
    const amt = Number(form.amount);
    if (!amt) return;
    persist({ ...actuals, items: [{ id: Date.now(), ...form, amount: amt }, ...actuals.items] });
    setForm({ ...form, amount: "", memo: "" });
  };
  const delItem = (id) => persist({ ...actuals, items: actuals.items.filter((x) => x.id !== id) });

  const plan = useMemo(() => simulate(p, true), [p]);
  const chart = useMemo(() => {
    if (!actuals.items.length) return [];
    const months = [...new Set(actuals.items.map((x) => x.month))].sort();
    const [y0, m0] = months[0].split("-").map(Number);
    const [y1, m1] = months[months.length - 1].split("-").map(Number);
    const out = []; let cumA = 0, cumP = 0;
    for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1);) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      const a = actuals.items.filter((x) => x.month === key)
        .reduce((s, x) => s + (x.kind === "income" ? x.amount : -x.amount), 0);
      const yi = y - actuals.startYear;
      const pm = yi >= 0 && yi < plan.length ? plan[yi].cf / 12 : 0;
      cumA += a; cumP += pm;
      out.push({ label: key, 実績累積: Math.round(cumA / 10000), 計画累積: Math.round(cumP / 10000) });
      m++; if (m > 12) { m = 1; y++; }
    }
    return out;
  }, [actuals, plan]);

  const yearsAvail = [...new Set(actuals.items.map((x) => x.month.slice(0, 4)))].sort().reverse();
  const [taxYearSel, setTaxYearSel] = useState("");
  const ty = taxYearSel || yearsAvail[0] || String(nowY);
  const sums = useMemo(() => {
    const it = actuals.items.filter((x) => x.month.startsWith(ty));
    const by = {};
    it.forEach((x) => {
      const k = (x.kind === "income" ? "収入" : "支出") + "|" + x.category;
      by[k] = (by[k] || 0) + x.amount;
    });
    const inc = it.filter((x) => x.kind === "income").reduce((s, x) => s + x.amount, 0);
    const exp = it.filter((x) => x.kind === "expense").reduce((s, x) => s + x.amount, 0);
    return { by, inc, exp, items: it };
  }, [actuals, ty]);

  const dlCsv = (rows, fname) => {
    const csv = "\uFEFF" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = fname; a.click();
    URL.revokeObjectURL(url);
  };

  const inSt = { padding: "8px 10px", border: `1px solid ${T.line}`, borderRadius: 6,
    fontSize: 14, background: "#FBFCFD", color: T.ink };
  const cell = { padding: "6px 9px", textAlign: "right", whiteSpace: "nowrap" };

  return (
    <div>
      {/* 設備台帳 */}
      <section style={cardSt}>
        <h2 style={h2St}>設備台帳 — 次の交換時期と想定費用</h2>
        {ledger.map((e) => (
          <div key={e.i} style={{ display: "grid",
            gridTemplateColumns: "minmax(90px,1.3fr) 1fr 1fr auto", gap: 10, alignItems: "end",
            padding: "8px 0", borderBottom: `1px dashed ${T.line}` }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, paddingBottom: 9 }}>{e.name}
              <span style={{ fontWeight: 400, color: T.sub, fontSize: 11 }}> (周期{e.cycle}年・{e.cost}万円)</span>
            </div>
            <Field label="設置年" value={e.installYear || nowY} unit="年" step={1} min={1980}
              onChange={(v) => setEq(e.i, "installYear", v)} />
            <div style={{ paddingBottom: 6, fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
              次回交換: <b>{e.next}年</b>
            </div>
            <div style={{ paddingBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 12,
                background: e.remain <= 2 ? "rgba(179,64,46,0.12)" : e.remain <= 5 ? T.warnBg : "rgba(46,125,110,0.10)",
                color: e.remain <= 2 ? T.real : e.remain <= 5 ? T.warnInk : T.good }}>
                あと{e.remain}年
              </span>
            </div>
          </div>
        ))}
        <div style={{ fontSize: 11, color: T.sub, marginTop: 8 }}>
          周期・費用の編集はシミュレーションタブの「設備交換サイクル」と共通です。直近2年以内は赤、5年以内は黄で警告します。
        </div>
      </section>

      {/* 予実管理 */}
      <section style={cardSt}>
        <h2 style={h2St}>予実管理 — 計画CFと実績の乖離を月次で追う</h2>
        <div style={{ display: "grid", gap: 10, marginBottom: 10,
          gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
          <Field label="運用開始年(計画1年目)" value={actuals.startYear} unit="年" step={1} min={2000}
            onChange={(v) => persist({ ...actuals, startYear: v })} />
          <label style={{ display: "block" }}>
            <span style={{ fontSize: 12, color: T.sub, display: "block", marginBottom: 3 }}>年月</span>
            <input type="month" value={form.month} style={{ ...inSt, width: "100%" }}
              onChange={(e) => setForm({ ...form, month: e.target.value })} />
          </label>
          <label style={{ display: "block" }}>
            <span style={{ fontSize: 12, color: T.sub, display: "block", marginBottom: 3 }}>区分</span>
            <select value={form.kind} style={{ ...inSt, width: "100%" }}
              onChange={(e) => setForm({ ...form, kind: e.target.value,
                category: e.target.value === "income" ? INCOME_CATS[0] : EXPENSE_CATS[0] })}>
              <option value="income">収入</option><option value="expense">支出</option>
            </select>
          </label>
          <label style={{ display: "block" }}>
            <span style={{ fontSize: 12, color: T.sub, display: "block", marginBottom: 3 }}>科目</span>
            <select value={form.category} style={{ ...inSt, width: "100%" }}
              onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {(form.kind === "income" ? INCOME_CATS : EXPENSE_CATS)
                .map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label style={{ display: "block" }}>
            <span style={{ fontSize: 12, color: T.sub, display: "block", marginBottom: 3 }}>金額(円)</span>
            <input type="number" value={form.amount} placeholder="85000"
              style={{ ...inSt, width: "100%" }}
              onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </label>
          <label style={{ display: "block" }}>
            <span style={{ fontSize: 12, color: T.sub, display: "block", marginBottom: 3 }}>メモ</span>
            <input value={form.memo} placeholder="任意" style={{ ...inSt, width: "100%" }}
              onChange={(e) => setForm({ ...form, memo: e.target.value })} />
          </label>
        </div>
        <button onClick={addItem} style={btnSt(T.navy)}>記録を追加</button>

        {chart.length > 0 && (
          <ResponsiveContainer width="100%" height={220} style={{ marginTop: 14 }}>
            <ComposedChart data={chart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={T.line} strokeDasharray="2 4" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: T.sub }} />
              <YAxis tick={{ fontSize: 11, fill: T.sub }} width={48} />
              <Tooltip formatter={(v) => v.toLocaleString() + "万円"} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine y={0} stroke={T.ink} strokeWidth={1} />
              <Line type="monotone" dataKey="計画累積" stroke={T.opt} strokeWidth={2}
                strokeDasharray="6 4" dot={false} />
              <Line type="monotone" dataKey="実績累積" stroke={T.real} strokeWidth={2.5} dot />
            </ComposedChart>
          </ResponsiveContainer>
        )}

        {actuals.items.length > 0 && (
          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%",
              fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${T.navy}`, color: T.navy }}>
                  {["年月", "区分", "科目", "金額", "メモ", ""].map((h) => (
                    <th key={h} style={{ ...cell, textAlign: "left" }}>{h}</th>))}
                </tr>
              </thead>
              <tbody>
                {actuals.items.slice(0, 60).map((x) => (
                  <tr key={x.id} style={{ borderBottom: `1px solid ${T.line}` }}>
                    <td style={{ ...cell, textAlign: "left" }}>{x.month}</td>
                    <td style={{ ...cell, textAlign: "left",
                      color: x.kind === "income" ? T.good : T.real }}>
                      {x.kind === "income" ? "収入" : "支出"}</td>
                    <td style={{ ...cell, textAlign: "left" }}>{x.category}</td>
                    <td style={cell}>{x.amount.toLocaleString()}円</td>
                    <td style={{ ...cell, textAlign: "left", color: T.sub }}>{x.memo}</td>
                    <td style={cell}>
                      <button onClick={() => delItem(x.id)} style={{ padding: "3px 9px",
                        background: "none", color: T.real, border: `1px solid ${T.line}`,
                        borderRadius: 6, fontSize: 11, cursor: "pointer" }}>削除</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 申告集計 */}
      <section style={cardSt}>
        <h2 style={h2St}>確定申告用 科目別集計</h2>
        {yearsAvail.length === 0 ? (
          <div style={{ fontSize: 12.5, color: T.sub }}>予実管理に実績を記録すると、ここに年別・科目別の集計が表示されます。</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: T.sub }}>対象年:</span>
              <select value={ty} onChange={(e) => setTaxYearSel(e.target.value)} style={inSt}>
                {yearsAvail.map((y) => <option key={y} value={y}>{y}年</option>)}
              </select>
            </div>
            <table style={{ borderCollapse: "collapse", fontSize: 12.5, width: "100%",
              maxWidth: 460, fontVariantNumeric: "tabular-nums" }}>
              <tbody>
                {Object.entries(sums.by).map(([k, v]) => {
                  const [kind, cat] = k.split("|");
                  return (
                    <tr key={k} style={{ borderBottom: `1px solid ${T.line}` }}>
                      <td style={{ padding: "6px 9px", color: kind === "収入" ? T.good : T.real }}>{kind}</td>
                      <td style={{ padding: "6px 9px" }}>{cat}</td>
                      <td style={{ ...cell, fontWeight: 700 }}>{v.toLocaleString()}円</td>
                    </tr>
                  );
                })}
                <tr style={{ borderTop: `2px solid ${T.navy}` }}>
                  <td colSpan={2} style={{ padding: "8px 9px", fontWeight: 700 }}>差引(収入−支出)</td>
                  <td style={{ ...cell, fontWeight: 700,
                    color: sums.inc - sums.exp < 0 ? T.real : T.good }}>
                    {(sums.inc - sums.exp).toLocaleString()}円</td>
                </tr>
              </tbody>
            </table>
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button style={btnSt(T.navy)} onClick={() => dlCsv(
                [["科目区分", "科目", "金額(円)"],
                 ...Object.entries(sums.by).map(([k, v]) => [...k.split("|"), v]),
                 ["差引", "", sums.inc - sums.exp]],
                `収支集計_${ty}.csv`)}>科目別集計CSV</button>
              <button style={btnSt(T.sub)} onClick={() => dlCsv(
                [["年月", "区分", "科目", "金額(円)", "メモ"],
                 ...sums.items.map((x) => [x.month, x.kind === "income" ? "収入" : "支出",
                   x.category, x.amount, x.memo || ""])],
                `収支明細_${ty}.csv`)}>明細CSV</button>
            </div>
            <div style={{ fontSize: 11, color: T.sub, marginTop: 10, lineHeight: 1.6 }}>
              減価償却費は現金支出を伴わないためここには含まれません。申告時はシミュレーションタブの償却設定(建物割合×価格÷償却年数)を別途計上してください。
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// ---------- プリセットシナリオ ----------
const PRESETS = [
  { key: "urban", name: "都心中古区分", desc: "駅近ワンルーム・流動性重視の標準形",
    patch: { price: 2000, rent: 85000, downPayment: 300, costsPct: 7, bldgRatio: 40, depYears: 27,
      rentDecline: 1.0, renewalEveryYears: 2, renewalOwnerMonths: 0.5, reikinMonths: 0,
      stayYears: 4, vacancyMonths: 2, restorationCost: 150000, adMonths: 1,
      loanYears: 35, rate0: 1.8, rateSlope: 0.05, rateCap: 4.0,
      mgmtPct: 5, bldgFee: 12000, bldgFeeInfl: 1, tax: 70000, insurance: 15000,
      repairBase: 30000, repairInfl: 2, bigRepairCycle: 0,
      exitYieldPct: 7, priceTrendPct: -1, sellCostPct: 4 } },
  { key: "rural", name: "地方中古戸建て", desc: "高利回り・短期ローン・修繕は全部自分持ち",
    patch: { price: 600, rent: 55000, downPayment: 300, costsPct: 8, bldgRatio: 50, depYears: 6,
      rentDecline: 1.5, renewalEveryYears: 2, renewalOwnerMonths: 0, reikinMonths: 0,
      stayYears: 6, vacancyMonths: 4, restorationCost: 250000, adMonths: 2,
      loanYears: 15, rate0: 2.5, rateSlope: 0.05, rateCap: 4.5,
      mgmtPct: 5, bldgFee: 0, bldgFeeInfl: 0, tax: 40000, insurance: 25000,
      repairBase: 80000, repairInfl: 2, bigRepairCycle: 15, bigRepairCost: 150,
      exitYieldPct: 13, priceTrendPct: -2, sellCostPct: 5 } },
  { key: "apart", name: "一棟アパート(木造8戸)", desc: "8戸を1ユニットに集約した近似モデル",
    patch: { price: 8000, rent: 400000, downPayment: 1600, costsPct: 7, bldgRatio: 60, depYears: 22,
      rentDecline: 1.2, renewalEveryYears: 2, renewalOwnerMonths: 0.5, reikinMonths: 0.5,
      stayYears: 4, vacancyMonths: 2, restorationCost: 1200000, adMonths: 1,
      loanYears: 25, rate0: 2.2, rateSlope: 0.05, rateCap: 4.5,
      mgmtPct: 5, bldgFee: 0, bldgFeeInfl: 0, tax: 300000, insurance: 80000,
      repairBase: 300000, repairInfl: 2, bigRepairCycle: 12, bigRepairCost: 400,
      exitYieldPct: 9, priceTrendPct: -1.5, sellCostPct: 4 } },
  { key: "shinchiku", name: "新築ワンルーム検証", desc: "業者提案の数字を入れて持ち出しの実態を確認", danger: true,
    patch: { price: 3200, rent: 95000, downPayment: 10, costsPct: 5, bldgRatio: 60, depYears: 47,
      rentDecline: 1.5, renewalEveryYears: 2, renewalOwnerMonths: 0, reikinMonths: 0,
      stayYears: 4, vacancyMonths: 2, restorationCost: 100000, adMonths: 1,
      loanYears: 35, rate0: 2.0, rateSlope: 0.05, rateCap: 4.5,
      mgmtPct: 5, bldgFee: 15000, bldgFeeInfl: 1.5, tax: 90000, insurance: 12000,
      repairBase: 10000, repairInfl: 2, bigRepairCycle: 0,
      exitYieldPct: 5.5, priceTrendPct: -1.5, sellCostPct: 4 } },
];

// ---------- 信号機診断 ----------
function diagnose(q, m) {
  const real = m.real, sale = m.sale;
  const gross = ((q.rent * 12) / (q.price * 10000)) * 100;
  const monthly1 = real[0].cf / 12;
  const worst = Math.min(...real.map((r) => r.cf)) / 12;
  const payback = real.find((r) => r.cum >= sale.initialEquity);
  const dangers = [], warns = [], optimistic = [];

  // 総合成績:最終損益プラス かつ IRR>=5% を「健全ライン」の下地に置き、
  // これを満たす場合は単一指標の弱さだけでは「危険」に格上げしないポリシー
  const goodOverall = m.total > 0 && m.irr != null && m.irr >= 5;

  if (monthly1 < 0)
    dangers.push(`初年度から毎月約${Math.round(-monthly1).toLocaleString()}円の持ち出しが発生します`);
  if (m.dscr != null) {
    if (m.dscr < 1.1) {
      // DSCR低位でも総合成績が良い物件は「注意喚起」に留める
      if (goodOverall)
        warns.push(`初年度DSCR ${m.dscr.toFixed(2)} — 返済余裕は薄いものの、総合損益・IRRは良好。頭金の積み増しで安全性を高める余地があります`);
      else
        dangers.push(`初年度DSCR ${m.dscr.toFixed(2)} — 返済余裕がほぼなく、金融機関の融資基準(目安1.2以上)を下回ります`);
    } else if (m.dscr < 1.3) {
      warns.push(`初年度DSCR ${m.dscr.toFixed(2)} — 返済余裕が薄め。空室や金利上昇への耐性が限られます`);
    }
  }
  if (q.downPayment < q.price * 0.1 && gross < 5 && !goodOverall)
    dangers.push(`ほぼフルローン × 表面利回り${gross.toFixed(1)}% — 収支が構造的に苦しい組み合わせです`);
  if (m.total < 0)
    dangers.push(`${q.simYears}年保有して売却しても約${fmtMan(-m.total)}の損失で終わる試算です`);
  if (m.irr != null && m.irr < 0)
    dangers.push("IRRがマイナス — 自己資金を投じる経済合理性がありません");
  else if (m.irr != null && m.irr < 2)
    warns.push(`IRR ${m.irr.toFixed(1)}% — インデックス投資等と比べ、手間とリスクに見合わない水準かもしれません`);
  // 初赤字転換は「早期(5年目以内)」かつ「総合成績も振るわない」ときのみ注意喚起
  // 長期投資では後半に単年赤字が混じるのは通常であり、それだけで警告するのは過剰
  if (m.firstDeficitYear && m.firstDeficitYear <= 5 && monthly1 >= 0 && !goodOverall)
    warns.push(`${m.firstDeficitYear}年目という早期に単年赤字へ転落します。運営初期段階での持ち出しに備える必要があります`);

  if (q.vacancyMonths < 1) optimistic.push("空室期間1ヶ月未満は楽観的です(一般に1〜3ヶ月)");
  if (q.rentDecline < 0.5) optimistic.push("家賃下落率0.5%未満は楽観的です(築古化は避けられません)");
  if (q.mgmtPct < 3) optimistic.push("管理委託料3%未満は相場(3〜5%)より低い前提です");
  if (q.restorationCost < 50000) optimistic.push("原状回復費5万円未満は単身物件でも楽観的です");
  if (q.rateSlope <= 0) optimistic.push("金利上昇を見込んでいません。変動金利なら上昇シナリオの確認を");
  if (q.stayYears > 8) optimistic.push("平均入居8年超はファミリー向けでも長めの前提です");
  if (q.repairBase < 10000) optimistic.push("経常修繕費が年1万円未満 — 築年が進むと現実的ではありません");

  const level = dangers.length ? "danger"
    : (warns.length || optimistic.length >= 2) ? "warn" : "ok";

  const summary = [];
  summary.push(`${q.simYears}年間保有して売却した場合、自己資金約${fmtMan(sale.initialEquity)}に対し最終損益は約${fmtMan(Math.abs(m.total))}の${m.total >= 0 ? "プラス" : "マイナス"}です${m.irr != null ? `(IRR ${m.irr.toFixed(1)}%)` : ""}。`);
  if (m.firstDeficitYear) {
    const isLate = m.firstDeficitYear > 15;
    summary.push(`${m.firstDeficitYear}年目に単年収支が赤字化${isLate ? "しますが、これは金利上昇と家賃下落が積み重なる長期投資では通常の推移です" : "し、最悪期には月あたり約" + Math.round(Math.max(0, -worst)).toLocaleString() + "円の持ち出しが見込まれます"}。`);
  } else summary.push("保有期間を通じて単年黒字を維持する試算です。");
  summary.push(payback
    ? `投下した自己資金は家賃収入だけで${payback.year}年目に回収できます。`
    : "家賃収入だけでは自己資金を回収できず、売却益頼みの構造です。");

  return { level, summary, dangers, warns, optimistic };
}

function DiagnosisCard({ diag }) {
  const conf = {
    ok: { color: T.good, bg: "rgba(46,125,110,0.07)", label: "健全" },
    warn: { color: T.warnInk, bg: T.warnBg, label: "要注意" },
    danger: { color: T.real, bg: "rgba(179,64,46,0.07)", label: "危険" },
  }[diag.level];
  return (
    <section style={{ ...cardSt, borderLeft: `5px solid ${conf.color}`, background: conf.bg }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ width: 12, height: 12, borderRadius: 6, background: conf.color,
          display: "inline-block" }} />
        <span style={{ fontSize: 15, fontWeight: 800, color: conf.color }}>診断: {conf.label}</span>
      </div>
      <p style={{ fontSize: 13, lineHeight: 1.85, margin: "0 0 8px", color: T.ink }}>
        {diag.summary.join(" ")}</p>
      {diag.dangers.map((d, i) => (
        <div key={"d" + i} style={{ fontSize: 12.5, color: T.real, lineHeight: 1.8 }}>⛔ {d}</div>))}
      {diag.warns.map((d, i) => (
        <div key={"w" + i} style={{ fontSize: 12.5, color: T.warnInk, lineHeight: 1.8 }}>⚠ {d}</div>))}
      {diag.optimistic.length > 0 && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px dashed ${T.line}` }}>
          {diag.optimistic.map((d, i) => (
            <div key={"o" + i} style={{ fontSize: 12, color: T.sub, lineHeight: 1.8 }}>
              前提チェック: {d}</div>))}
        </div>
      )}
    </section>
  );
}

// ---------- レポート出力(テンプレート型・AI不使用) ----------
const REPORT_DISCLAIMER = "本レポートはユーザーが設定した前提に基づく試算であり、将来の収支を保証するものではありません。投資助言・税務相談に該当するものではなく、最終的な投資判断は一次資料の確認のうえご自身の責任で行ってください。";

const REPORT_CSS = `
  .rp-overlay{position:fixed;inset:0;z-index:200;background:#4A5158;overflow:auto;padding:20px 12px 60px}
  .rp-bar{position:sticky;top:0;z-index:210;display:flex;gap:10px;align-items:center;justify-content:center;
    flex-wrap:wrap;padding:10px;background:rgba(22,34,46,.94);border-radius:12px;max-width:1122px;margin:0 auto 18px}
  .rp-bar input{padding:9px 14px;border-radius:8px;border:none;font-size:14px;width:300px;font-family:inherit}
  .rp-bar button{padding:9px 20px;border:none;border-radius:8px;font-size:13.5px;font-weight:700;cursor:pointer}
  .sheet{width:1122px;height:793px;background:#fff;margin:0 auto 20px;padding:50px 56px;
    box-shadow:0 10px 34px rgba(0,0,0,.45);position:relative;overflow:hidden;color:#16222E;
    font-family:"Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic",sans-serif}
  .sheet h1{font-size:34px;margin:0 0 6px;color:#1F3A52;line-height:1.4}
  .sheet h2{font-size:21px;margin:0 0 16px;color:#1F3A52;border-bottom:3px solid #1F3A52;padding-bottom:8px}
  .sheet h3{font-size:15px;margin:0 0 8px;color:#1F3A52}
  .sheet .brand{font-size:13px;font-weight:700;letter-spacing:.2em;color:#B3402E;margin-bottom:14px}
  .sheet .foot{position:absolute;left:56px;right:56px;bottom:22px;display:flex;justify-content:space-between;
    font-size:11px;color:#8A97A3;border-top:1px solid #E2E8EF;padding-top:8px}
  .sheet table.pt{border-collapse:collapse;width:100%;font-size:12.5px}
  .sheet table.pt td{padding:6px 10px;border-bottom:1px solid #E9EDF1}
  .sheet table.pt td:first-child{color:#5B6B7A;width:47%}
  .sheet table.pt td:last-child{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
  .sheet table.dt{border-collapse:collapse;width:100%;font-size:12.5px;font-variant-numeric:tabular-nums;white-space:nowrap}
  .sheet table.dt th{padding:8px 10px;border-bottom:2px solid #1F3A52;color:#1F3A52;text-align:right}
  .sheet table.dt th:first-child{text-align:left}
  .sheet table.dt td{padding:7px 10px;border-bottom:1px solid #E9EDF1;text-align:right}
  .sheet table.dt td:first-child{text-align:left;font-weight:700}
  .sheet .para{font-size:13.5px;line-height:2;text-align:justify}
  .sheet .kpi3{display:flex;gap:16px;margin:24px 0}
  .sheet .kpi3>div{flex:1;border:1px solid #E2E8EF;border-radius:12px;padding:15px 18px}
  .sheet .kpi3 .l{font-size:12px;color:#5B6B7A}
  .sheet .kpi3 .v{font-size:25px;font-weight:800;font-variant-numeric:tabular-nums;margin-top:2px}
  .sheet .flagline{font-size:13px;line-height:2}
  .sheet .verdict-badge{display:inline-flex;align-items:center;gap:10px;border-radius:14px;
    padding:10px 22px;font-size:19px;font-weight:800}
  @media print{
    @page{size:A4 landscape;margin:0}
    body *{visibility:hidden}
    .rp-overlay{position:absolute;inset:auto;top:0;left:0;right:0;padding:0;background:#fff;overflow:visible}
    .rp-overlay,.rp-overlay *{visibility:visible}
    .rp-bar{display:none}
    .sheet{margin:0;box-shadow:none;page-break-after:always;width:1122px;height:792px}
  }
`;

// 診断結果からレポート文章をルールベースで組み立てる(パターン分岐、AI不使用)
function buildNarrative(p, m, diag, exit, optLast) {
  const gap = optLast.cum - m.cumFinal;
  const best = exit.reduce((a, b) => (b.総合損益 > a.総合損益 ? b : a), exit[0]);
  const n = {};
  n.overall =
    diag.level === "ok"
      ? `本物件は、金利上昇・家賃下落・空室損・修繕費増を織り込んだ保守的な前提の下でも、${p.simYears}年間の保有と売却を通じて約${fmtMan(m.total)}の最終黒字が見込まれる、健全性の高い収支構造と評価できる。`
      : diag.level === "warn"
      ? `本物件は、保守的な前提の下で最終損益が約${fmtMan(Math.abs(m.total))}の${m.total >= 0 ? "黒字" : "赤字"}と試算されるものの、注意を要する指標が存在する。前提条件の妥当性確認と、後述するリスク項目への対応策の検討を推奨する。`
      : `本物件は、保守的な前提の下で約${fmtMan(Math.abs(m.total))}の最終${m.total >= 0 ? "黒字にとどまり" : "赤字となり"}、重大な危険シグナルが検出されている。現条件での取得判断は推奨されず、価格・融資条件・賃料想定の見直し、または見送りの検討が妥当である。`;
  n.funding =
    m.dscr == null ? "借入がなく全額自己資金による取得のため、返済リスクは存在しない。"
    : m.dscr >= 1.3 ? `初年度DSCR(返済余裕率)は${m.dscr.toFixed(2)}であり、金融機関が目安とする1.2〜1.3を上回る。空室や金利上昇に対して一定の緩衝を備えた資金計画である。`
    : m.dscr >= 1.1 ? `初年度DSCRは${m.dscr.toFixed(2)}と、金融機関の目安である1.2〜1.3をやや下回る。自己資金の積み増しや融資条件の改善により、返済余裕を厚くすることが望ましい。`
    : `初年度DSCRは${m.dscr.toFixed(2)}にとどまり、返済余裕がほとんどない。わずかな空室や金利上昇で持ち出しに転じる構造であり、資金計画の抜本的な見直しが必要である。`;
  n.trajectory =
    (m.firstDeficitYear
      ? `単年キャッシュフローは${m.firstDeficitYear}年目に赤字へ転換する試算である。家賃の経年下落・金利上昇・修繕費の増加が複合的に累積するためであり、当該期以降は手元資金による補填を想定しておく必要がある。`
      : `単年キャッシュフローは全保有期間を通じて黒字を維持する試算であり、運営費・返済・税負担を賃料収入で吸収できる収益構造である。`) +
    (gap >= 0
      ? ` なお、満室・金利固定を仮定した楽観シナリオとの累積差額は${p.simYears}年間で約${fmtMan(gap)}にのぼり、簡易シミュレーションのみに依拠した判断には注意を要する。`
      : ` 更新料・礼金収入の寄与により、現実シナリオが楽観シナリオを約${fmtMan(-gap)}上回る点は、本物件の収益構造上の強みといえる。`);
  const pay = m.real.find((r) => r.cum >= m.sale.initialEquity);
  n.payback = pay
    ? `投下自己資金約${fmtMan(m.sale.initialEquity)}は、賃料収入のみで${pay.year}年目に回収される見込みである。`
    : `投下自己資金は賃料収入のみでは回収されず、売却益に依存する回収構造である点に留意が必要である。`;
  n.exit = `売却時期の総当たり分析によれば、${best.year}年目の売却が最終損益約${best.総合損益.toLocaleString()}万円で最適となる。残債の逓減と建物劣化・賃料下落のバランスにより最適点が形成されるため、満期まで保有し続けることが必ずしも最適とは限らない。`;
  n.bestExit = best;
  return n;
}

function SheetFoot({ page, total, title }) {
  return (
    <div className="foot">
      <span>現実派 — 不動産収支シミュレーター ／ {title}</span>
      <span>{page} / {total}</span>
    </div>
  );
}

function ReportView({ p, initialTitle, onClose }) {
  const [title, setTitle] = useState(initialTitle || "検討物件 収支分析レポート");
  const m = useMemo(() => computeMetrics(p), [p]);
  const opt = useMemo(() => simulate(p, false), [p]);
  const diag = useMemo(() => diagnose(p, m), [p, m]);
  const exit = useMemo(() => exitCurve(p), [p]);
  const n = useMemo(() => buildNarrative(p, m, diag, exit, opt[opt.length - 1]), [p, m, diag, exit, opt]);
  const stress = useMemo(() => {
    const presets = [
      { name: "ベース", mod: (q) => q },
      { name: "中度ストレス", mod: (q) => ({ ...q, rate0: q.rate0 + 1, vacancyMonths: q.vacancyMonths * 1.5, rentDecline: q.rentDecline + 0.5, repairInfl: q.repairInfl + 1 }) },
      { name: "重度ストレス", mod: (q) => ({ ...q, rate0: q.rate0 + 2, vacancyMonths: q.vacancyMonths * 2, rentDecline: q.rentDecline + 1, restorationCost: q.restorationCost * 1.5, exitYieldPct: q.exitYieldPct + 1 }) },
    ];
    return presets.map((s) => ({ ...s, m: computeMetrics(s.mod(p)) }));
  }, [p]);

  const chartData = m.real.map((r, i) => ({
    year: r.year,
    現実: Math.round(r.cum / 10000),
    楽観: Math.round(opt[i].cum / 10000),
    単年CF: Math.round(r.cf / 10000),
    残債: Math.round(r.balance / 10000),
  }));
  const excerptYears = [...new Set([1, 3, 5, 10, 15, 20, 25, 30, p.simYears])]
    .filter((y) => y <= p.simYears).sort((a, b) => a - b);
  const dt = new Date().toLocaleDateString("ja-JP");
  const vconf = { ok: ["健全", T.good], warn: ["要注意", "#B07A1A"], danger: ["危険", T.real] }[diag.level];
  const gross = ((p.rent * 12) / (p.price * 10000)) * 100;
  const loan = Math.max(p.price - p.downPayment, 0);

  const rowsL = [
    ["物件価格", p.price.toLocaleString() + " 万円"],
    ["購入諸費用率", p.costsPct + " %"],
    ["表面利回り", gross.toFixed(2) + " %"],
    ["月額家賃(初年度)", p.rent.toLocaleString() + " 円"],
    ["家賃下落率", p.rentDecline + " %/年"],
    ["平均入居期間 / 空室期間", p.stayYears + "年 / " + p.vacancyMonths + "ヶ月"],
    ["原状回復費(退去毎)", p.restorationCost.toLocaleString() + " 円"],
    ["募集広告料(AD)", p.adMonths + " ヶ月分"],
  ];
  const rowsR = [
    ["自己資金 / 借入", p.downPayment.toLocaleString() + "万円 / " + loan.toLocaleString() + "万円"],
    ["返済期間 / 方式", p.loanYears + "年 / " + (p.repayMethod === "annuity" ? "元利均等" : "元金均等")],
    ["金利(当初+上昇)", p.rate0 + "% +" + p.rateSlope + "pt/年 (上限" + p.rateCap + "%)"],
    ["管理委託 / 建物管理費", p.mgmtPct + "% / 月" + p.bldgFee.toLocaleString() + "円"],
    ["経常修繕費(初年度)", p.repairBase.toLocaleString() + " 円/年"],
    ["税の考慮", p.taxOn ? "限界税率" + p.taxRate + "%(損益通算" + (p.lossOffset ? "あり" : "なし") + ")" : "税引前"],
    ["売却想定", p.saleMode === "yield" ? "売却時利回り " + p.exitYieldPct + "%" : "価格変動 " + p.priceTrendPct + "%/年"],
    ["分析期間", p.simYears + " 年"],
  ];
  const TOTAL = 7;

  return (
    <div className="rp-overlay">
      <style>{REPORT_CSS}</style>
      <div className="rp-bar">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="レポートのタイトル" />
        <button style={{ background: T.real, color: "#fff" }} onClick={() => window.print()}>
          印刷 / PDFとして保存</button>
        <button style={{ background: "#fff", color: T.ink }} onClick={onClose}>閉じる</button>
        <span style={{ fontSize: 11.5, color: "rgba(255,255,255,.7)" }}>
          印刷ダイアログで「PDFに保存」・用紙A4・横向き・余白なしを選択してください</span>
      </div>

      {/* 1. 表紙 */}
      <div className="sheet">
        <div className="brand">現実派 ｜ REAL ESTATE REALITY REPORT</div>
        <h1>{title}</h1>
        <div style={{ fontSize: 14, color: "#5B6B7A" }}>作成日: {dt} ／ 分析期間: {p.simYears}年(月次計算)</div>
        <div style={{ marginTop: 40 }}>
          <span className="verdict-badge" style={{ background: vconf[1] + "18", color: vconf[1], border: "2px solid " + vconf[1] }}>
            <span style={{ width: 14, height: 14, borderRadius: 7, background: vconf[1], display: "inline-block" }} />
            総合診断: {vconf[0]}
          </span>
        </div>
        <div className="kpi3">
          <div><div className="l">最終損益(売却込み・{p.simYears}年)</div>
            <div className="v" style={{ color: m.total < 0 ? T.real : T.good }}>{fmtMan(m.total)}</div></div>
          <div><div className="l">IRR(内部収益率)</div>
            <div className="v">{m.irr == null ? "—" : m.irr.toFixed(1) + "%"}</div></div>
          <div><div className="l">DSCR(初年度返済余裕率)</div>
            <div className="v" style={{ color: m.dscr != null && m.dscr < 1.2 ? T.real : T.ink }}>
              {m.dscr == null ? "—" : m.dscr.toFixed(2)}</div></div>
        </div>
        <p className="para" style={{ maxWidth: 900 }}>{n.overall}</p>
        <SheetFoot page={1} total={TOTAL} title={title} />
      </div>

      {/* 2. 前提条件 */}
      <div className="sheet">
        <h2>1. 分析の前提条件</h2>
        <div style={{ display: "flex", gap: 36 }}>
          <table className="pt" style={{ flex: 1 }}><tbody>
            {rowsL.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody></table>
          <table className="pt" style={{ flex: 1 }}><tbody>
            {rowsR.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody></table>
        </div>
        <h3 style={{ marginTop: 26 }}>資金計画の評価</h3>
        <p className="para">{n.funding} {n.payback}</p>
        <SheetFoot page={2} total={TOTAL} title={title} />
      </div>

      {/* 3. 累積キャッシュフロー */}
      <div className="sheet">
        <h2>2. 累積キャッシュフロー — 楽観シナリオとの比較(万円)</h2>
        <ComposedChart width={1010} height={430} data={chartData}
          margin={{ top: 10, right: 20, left: 0, bottom: 4 }}>
          <CartesianGrid stroke="#E9EDF1" strokeDasharray="2 4" />
          <XAxis dataKey="year" tick={{ fontSize: 12 }} unit="年" />
          <YAxis tick={{ fontSize: 12 }} width={64} />
          <Legend wrapperStyle={{ fontSize: 13 }} />
          <ReferenceLine y={0} stroke="#16222E" />
          <Line type="monotone" dataKey="楽観" stroke={T.opt} strokeWidth={2.5} strokeDasharray="7 5" dot={false} />
          <Line type="monotone" dataKey="現実" stroke={T.real} strokeWidth={3} dot={false} />
        </ComposedChart>
        <p className="para" style={{ marginTop: 10 }}>{n.trajectory}</p>
        <SheetFoot page={3} total={TOTAL} title={title} />
      </div>

      {/* 4. 単年CFと年次明細 */}
      <div className="sheet">
        <h2>3. 単年キャッシュフローと年次明細(抜粋)</h2>
        <ComposedChart width={1010} height={300} data={chartData}
          margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#E9EDF1" strokeDasharray="2 4" />
          <XAxis dataKey="year" tick={{ fontSize: 12 }} unit="年" />
          <YAxis yAxisId="cf" tick={{ fontSize: 12 }} width={56} />
          <YAxis yAxisId="bal" orientation="right" tick={{ fontSize: 12 }} width={64} />
          <Legend wrapperStyle={{ fontSize: 13 }} />
          <ReferenceLine yAxisId="cf" y={0} stroke="#16222E" />
          <Bar yAxisId="cf" dataKey="単年CF" radius={[2, 2, 0, 0]}>
            {chartData.map((d, i) => <Cell key={i} fill={d["単年CF"] < 0 ? T.real : T.navy} />)}
          </Bar>
          <Line yAxisId="bal" type="monotone" dataKey="残債" stroke={T.sub} strokeWidth={2} dot={false} />
        </ComposedChart>
        <table className="dt" style={{ marginTop: 16 }}>
          <thead><tr>{["年", "収入", "経費", "返済", "単年CF", "累積CF", "残債"].map((h) =>
            <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {excerptYears.map((y) => { const r = m.real[y - 1]; return (
              <tr key={y}>
                <td>{y}年目</td><td>{fmtMan(r.income)}</td><td>{fmtMan(r.expense)}</td>
                <td>{fmtMan(r.loanPaid)}</td>
                <td style={{ color: r.cf < 0 ? T.real : T.ink, fontWeight: 700 }}>{fmtMan(r.cf)}</td>
                <td>{fmtMan(r.cum)}</td><td>{fmtMan(r.balance)}</td>
              </tr>); })}
          </tbody>
        </table>
        <SheetFoot page={4} total={TOTAL} title={title} />
      </div>

      {/* 5. リスク分析 */}
      <div className="sheet">
        <h2>4. リスク分析 — 検出されたシグナルと前提の点検</h2>
        {diag.dangers.length === 0 && diag.warns.length === 0 && (
          <p className="para">本試算の前提において、重大な危険シグナルは検出されていない。</p>)}
        {diag.dangers.map((d, i) => (
          <div key={"d" + i} className="flagline" style={{ color: T.real }}>⛔ {d}</div>))}
        {diag.warns.map((d, i) => (
          <div key={"w" + i} className="flagline" style={{ color: "#8A5A12" }}>⚠ {d}</div>))}
        {diag.optimistic.length > 0 && (<>
          <h3 style={{ marginTop: 22 }}>前提の点検(楽観側に寄っている可能性のある入力)</h3>
          {diag.optimistic.map((d, i) => (
            <div key={"o" + i} className="flagline" style={{ color: "#5B6B7A" }}>・{d}</div>))}
        </>)}
        <h3 style={{ marginTop: 22 }}>ストレステスト — 悪条件の複合に対する耐久性</h3>
        <div style={{ display: "flex", gap: 14 }}>
          {stress.map((s) => (
            <div key={s.name} style={{ flex: 1, border: "1px solid " + (s.m.total >= 0 ? "#E2E8EF" : T.real),
              borderRadius: 12, padding: "13px 16px",
              background: s.m.total >= 0 ? "#FBFCFD" : "rgba(179,64,46,.05)" }}>
              <div style={{ fontSize: 14, fontWeight: 800 }}>{s.name}</div>
              <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.9 }} className="num">
                最終損益: <b style={{ color: s.m.total < 0 ? T.real : T.good }}>{fmtMan(s.m.total)}</b><br />
                IRR: <b>{s.m.irr == null ? "—" : s.m.irr.toFixed(1) + "%"}</b> ／
                初赤字: <b>{s.m.firstDeficitYear ? s.m.firstDeficitYear + "年目" : "なし"}</b>
              </div>
              <div style={{ marginTop: 6, fontSize: 13, fontWeight: 800,
                color: s.m.total >= 0 ? T.good : T.real }}>
                {s.m.total >= 0 ? "✓ 耐える" : "✗ 損失で終わる"}</div>
            </div>))}
        </div>
        <SheetFoot page={5} total={TOTAL} title={title} />
      </div>

      {/* 6. 出口戦略 */}
      <div className="sheet">
        <h2>5. 出口戦略 — 売却タイミングの最適化(万円)</h2>
        <ComposedChart width={1010} height={400} data={exit}
          margin={{ top: 22, right: 20, left: 0, bottom: 4 }}>
          <CartesianGrid stroke="#E9EDF1" strokeDasharray="2 4" />
          <XAxis dataKey="year" tick={{ fontSize: 12 }} unit="年" />
          <YAxis tick={{ fontSize: 12 }} width={64} />
          <ReferenceLine y={0} stroke="#16222E" />
          <Line type="monotone" dataKey="総合損益" stroke={T.navy} strokeWidth={3} dot={false} />
          {n.bestExit && <ReferenceLine x={n.bestExit.year} stroke={T.good} strokeDasharray="5 4"
            label={{ value: "最適: " + n.bestExit.year + "年目", fontSize: 13, fill: T.good, position: "top" }} />}
        </ComposedChart>
        <p className="para" style={{ marginTop: 10 }}>{n.exit}</p>
        <SheetFoot page={6} total={TOTAL} title={title} />
      </div>

      {/* 7. 計算方法・免責 */}
      <div className="sheet">
        <h2>6. 計算方法と免責事項</h2>
        <h3>計算方法の概要</h3>
        <p className="para">
          本レポートの試算は、分析期間{p.simYears}年を月次({p.simYears * 12}ヶ月)に分解した逐次計算による。
          各月において賃料収入(経年下落・更新料・礼金を含む)、運営経費(管理費・税・保険・修繕)、
          借入返済(金利の年次上昇を反映した再計算)を計上し、入退去サイクルに応じて空室損・原状回復費・
          募集広告料を、設備の交換周期に応じて資本的支出を反映している。
          税額は建物部分の減価償却と支払利息を控除した不動産所得に対する限界税率による簡易計算であり、
          最終損益は「累積キャッシュフロー+売却手取(諸費用・譲渡税・残債控除後)−初期自己資金」として算定した。
          「楽観シナリオ」は満室・金利固定・家賃一定・退去/設備コストなしの一般的な簡易シミュレーションを再現したものである。
        </p>
        <h3 style={{ marginTop: 20 }}>免責事項</h3>
        <p className="para">{REPORT_DISCLAIMER}</p>
        <SheetFoot page={7} total={TOTAL} title={title} />
      </div>
    </div>
  );
}

// ---------- 比較レポート ----------
function CompareReportView({ rows, onClose }) {
  const dt = new Date().toLocaleDateString("ja-JP");
  const pct = (v, d = 1) => (v == null || !isFinite(v) ? "—" : v.toFixed(d) + "%");
  const bestI = rows.reduce((a, b) => ((b.m.irr ?? -1e9) > (a.m.irr ?? -1e9) ? b : a), rows[0]);
  const bestD = rows.reduce((a, b) => ((b.m.dscr ?? -1e9) > (a.m.dscr ?? -1e9) ? b : a), rows[0]);
  const rec =
    `IRR(投資効率)基準では「${bestI.pr.name}」(${bestI.m.irr == null ? "—" : bestI.m.irr.toFixed(1) + "%"})が最も優位であり、` +
    `DSCR(返済余裕)基準では「${bestD.pr.name}」(${bestD.m.dscr == null ? "—" : bestD.m.dscr.toFixed(2)})が最も安全性が高い。` +
    (bestI.pr.id === bestD.pr.id
      ? "両基準で同一物件が優位であり、比較対象の中では有力候補と評価できる。"
      : "効率と安全性で優位な物件が分かれるため、投資方針(拡大重視か安定重視か)に応じた選択が求められる。");
  const cautions = rows.filter((r) => r.m.dscr != null && r.m.dscr < 1.1)
    .map((r) => `「${r.pr.name}」はDSCR ${r.m.dscr.toFixed(2)}と返済余裕が乏しく、融資審査・運営の両面で注意を要する。`);
  const barData = rows.map((r) => ({
    name: r.pr.name.length > 9 ? r.pr.name.slice(0, 9) + "…" : r.pr.name,
    総合損益: Math.round(r.m.total / 10000),
    IRR: r.m.irr == null ? 0 : +r.m.irr.toFixed(1),
  }));
  const TOTAL = 3;
  const title = "物件比較レポート(" + rows.length + "件)";
  return (
    <div className="rp-overlay">
      <style>{REPORT_CSS}</style>
      <div className="rp-bar">
        <button style={{ background: T.real, color: "#fff" }} onClick={() => window.print()}>
          印刷 / PDFとして保存</button>
        <button style={{ background: "#fff", color: T.ink }} onClick={onClose}>閉じる</button>
        <span style={{ fontSize: 11.5, color: "rgba(255,255,255,.7)" }}>
          印刷ダイアログで「PDFに保存」・用紙A4・横向き・余白なしを選択してください</span>
      </div>

      <div className="sheet">
        <div className="brand">現実派 ｜ REAL ESTATE REALITY REPORT</div>
        <h1>{title}</h1>
        <div style={{ fontSize: 14, color: "#5B6B7A" }}>作成日: {dt} ／ 現実シナリオ(売却込み)ベースの比較</div>
        <h3 style={{ marginTop: 34 }}>比較対象</h3>
        {rows.map((r, i) => (
          <div key={r.pr.id} style={{ fontSize: 15, padding: "8px 0", borderBottom: "1px dashed #E2E8EF" }}>
            {i + 1}. <b>{r.pr.name}</b>
            <span style={{ color: "#5B6B7A", fontSize: 13 }}>
              (価格 {r.pr.params.price.toLocaleString()}万円 ／ 保存日 {r.pr.savedAt.slice(0, 10)})</span>
          </div>))}
        <SheetFoot page={1} total={TOTAL} title={title} />
      </div>

      <div className="sheet">
        <h2>1. 指標の横並び比較</h2>
        <table className="dt">
          <thead><tr>{["物件名", "価格", "表面", "IRR", "CCR", "DSCR", "初赤字", "累積CF", "最終損益"].map((h) =>
            <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map(({ pr, m }) => {
              const gross = (pr.params.rent * 12) / (pr.params.price * 10000) * 100;
              return (
                <tr key={pr.id} style={{ background: pr.id === bestI.pr.id ? "rgba(46,125,110,.07)" : "transparent" }}>
                  <td>{pr.id === bestI.pr.id ? "★ " : ""}{pr.name}</td>
                  <td>{pr.params.price.toLocaleString()}万</td>
                  <td>{pct(gross, 2)}</td>
                  <td style={{ fontWeight: 700 }}>{pct(m.irr)}</td>
                  <td>{pct(m.ccr)}</td>
                  <td style={{ color: m.dscr != null && m.dscr < 1.2 ? T.real : T.ink }}>
                    {m.dscr == null ? "—" : m.dscr.toFixed(2)}</td>
                  <td>{m.firstDeficitYear ? m.firstDeficitYear + "年目" : "なし"}</td>
                  <td>{fmtMan(m.cumFinal)}</td>
                  <td style={{ fontWeight: 700, color: m.total < 0 ? T.real : T.good }}>{fmtMan(m.total)}</td>
                </tr>);
            })}
          </tbody>
        </table>
        <h3 style={{ marginTop: 24 }}>総評</h3>
        <p className="para">{rec}</p>
        {cautions.map((c, i) => (
          <div key={i} className="flagline" style={{ color: T.real }}>⚠ {c}</div>))}
        <SheetFoot page={2} total={TOTAL} title={title} />
      </div>

      <div className="sheet">
        <h2>2. 最終損益とIRRの比較</h2>
        <div style={{ display: "flex", gap: 24 }}>
          <div>
            <h3>最終損益(売却込み・万円)</h3>
            <ComposedChart width={492} height={380} data={barData}
              margin={{ top: 10, right: 10, left: 0, bottom: 30 }}>
              <CartesianGrid stroke="#E9EDF1" strokeDasharray="2 4" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-18} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 12 }} width={64} />
              <ReferenceLine y={0} stroke="#16222E" />
              <Bar dataKey="総合損益" radius={[3, 3, 0, 0]}>
                {barData.map((d, i) => <Cell key={i} fill={d.総合損益 < 0 ? T.real : T.navy} />)}
              </Bar>
            </ComposedChart>
          </div>
          <div>
            <h3>IRR(%)</h3>
            <ComposedChart width={492} height={380} data={barData}
              margin={{ top: 10, right: 10, left: 0, bottom: 30 }}>
              <CartesianGrid stroke="#E9EDF1" strokeDasharray="2 4" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-18} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 12 }} width={48} />
              <ReferenceLine y={0} stroke="#16222E" />
              <Bar dataKey="IRR" radius={[3, 3, 0, 0]} fill={T.good} />
            </ComposedChart>
          </div>
        </div>
        <p className="para" style={{ marginTop: 8, fontSize: 12 }}>{REPORT_DISCLAIMER}</p>
        <SheetFoot page={3} total={TOTAL} title={title} />
      </div>
    </div>
  );
}

// ---------- アカウント設定モーダル ----------
function AccountModal({ open, onClose, user, profile }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [delConfirm, setDelConfirm] = useState("");
  const downOnBg = useRef(false);
  if (!open || !user) return null;

  const rules = [
    { ok: pw.length >= 8, label: "8文字以上" },
    { ok: /[a-z]/.test(pw), label: "小文字を含む" },
    { ok: /[A-Z]/.test(pw), label: "大文字を含む" },
    { ok: /[0-9]/.test(pw), label: "数字を含む" },
    { ok: /[^A-Za-z0-9]/.test(pw), label: "記号(!?/#など)を含む" },
  ];
  const pwStrong = rules.every((r) => r.ok);

  const token = async () => {
    const { data } = await supabase.auth.getSession();
    return data.session ? data.session.access_token : null;
  };

  const changePw = async () => {
    if (!pwStrong) { setMsg("新しいパスワードが強度条件を満たしていません"); return; }
    if (pw !== pw2) { setMsg("確認用パスワードが一致しません"); return; }
    setBusy("pw"); setMsg("");
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy("");
    if (error) setMsg("変更に失敗しました: " + error.message);
    else { setMsg("パスワードを変更しました"); setPw(""); setPw2(""); }
  };

  const openPortal = async () => {
    setBusy("portal"); setMsg("");
    try {
      const t = await token();
      const r = await fetch("/api/billing-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + t },
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || "エラーが発生しました");
      window.location.href = d.url; // Stripeポータルへ(解約・支払い方法の変更/削除)
    } catch (e) { setMsg(String(e.message || e)); setBusy(""); }
  };

  const deleteAccount = async () => {
    if (delConfirm !== "削除") { setMsg("確認のため、入力欄に「削除」と入力してください"); return; }
    setBusy("del"); setMsg("");
    try {
      const t = await token();
      const r = await fetch("/api/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + t },
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || "削除に失敗しました");
      await supabase.auth.signOut();
      onClose();
      window.alert("アカウントを削除しました。ご利用ありがとうございました。");
      window.location.reload();
    } catch (e) { setMsg(String(e.message || e)); setBusy(""); }
  };

  const inSt = { width: "100%", padding: "10px 12px", border: `1px solid ${T.line}`,
    borderRadius: 8, fontSize: 14, marginBottom: 10, fontFamily: "inherit" };
  const secH = { fontSize: 13, fontWeight: 700, color: T.navy,
    borderBottom: `1px solid ${T.line}`, paddingBottom: 6, margin: "18px 0 10px" };

  return (
    <div
      onMouseDown={(e) => { downOnBg.current = e.target === e.currentTarget; }}
      onMouseUp={(e) => {
        if (downOnBg.current && e.target === e.currentTarget) onClose();
        downOnBg.current = false;
      }}
      style={{ position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(22,34,46,0.55)", display: "flex", alignItems: "center",
        justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#FFF", borderRadius: 12, padding: 24, maxWidth: 440,
        width: "100%", maxHeight: "90vh", overflowY: "auto",
        boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
        <h3 style={{ fontSize: 18, fontWeight: 800, color: T.navy, margin: 0 }}>アカウント設定</h3>
        <div style={{ fontSize: 12.5, color: T.sub, marginTop: 4 }}>
          {user.email} ／ 現在のプラン: <b>{profile && profile.plan === "pro" ? "Pro" : "Free"}</b>
        </div>

        <div style={secH}>パスワードの変更</div>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)}
          placeholder="新しいパスワード" autoComplete="new-password" style={inSt} />
        <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)}
          placeholder="新しいパスワード(確認)" autoComplete="new-password"
          style={{ ...inSt, borderColor: pw2.length === 0 ? T.line : pw === pw2 ? T.good : T.real }} />
        {pw.length > 0 && (
          <div style={{ fontSize: 11.5, lineHeight: 1.8, background: "#F6F8FA",
            borderRadius: 8, padding: "6px 12px", marginBottom: 10 }}>
            {rules.map((r) => (
              <span key={r.label} style={{ color: r.ok ? T.good : T.sub, marginRight: 10 }}>
                {r.ok ? "✓" : "・"}{r.label}</span>))}
          </div>
        )}
        <button onClick={changePw} disabled={busy === "pw"}
          style={{ padding: "9px 16px", background: T.navy, color: "#FFF", border: "none",
            borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
            opacity: busy === "pw" ? 0.6 : 1 }}>
          {busy === "pw" ? "変更中…" : "パスワードを変更する"}</button>

        <div style={secH}>支払い・サブスクリプション管理</div>
        <p style={{ fontSize: 12, color: T.sub, lineHeight: 1.7, margin: "0 0 10px" }}>
          Stripeの安全な管理画面で、サブスクリプションの解約、支払い方法(カード情報)の変更・削除、
          請求履歴の確認ができます。解約後も現在の請求期間の終了まではProをご利用いただけます。
        </p>
        <button onClick={openPortal} disabled={busy === "portal"}
          style={{ padding: "9px 16px", background: T.navy, color: "#FFF", border: "none",
            borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
            opacity: busy === "portal" ? 0.6 : 1 }}>
          {busy === "portal" ? "接続中…" : "管理画面を開く(解約・カード変更/削除)"}</button>

        <div style={{ ...secH, color: T.real, borderBottomColor: "rgba(179,64,46,0.3)" }}>
          アカウントの削除</div>
        <p style={{ fontSize: 12, color: T.sub, lineHeight: 1.7, margin: "0 0 10px" }}>
          保存した物件・リサーチ・予実データを含むすべての情報が完全に削除され、元に戻せません。
          有効なサブスクリプションは自動的に解約されます。
        </p>
        <input value={delConfirm} onChange={(e) => setDelConfirm(e.target.value)}
          placeholder="確認のため「削除」と入力" style={inSt} autoComplete="off" />
        <button onClick={deleteAccount} disabled={busy === "del" || delConfirm !== "削除"}
          style={{ padding: "9px 16px", background: T.real, color: "#FFF", border: "none",
            borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
            opacity: busy === "del" || delConfirm !== "削除" ? 0.5 : 1 }}>
          {busy === "del" ? "削除中…" : "アカウントを完全に削除する"}</button>

        {msg && <div style={{ fontSize: 12, color: T.warnInk, marginTop: 12,
          lineHeight: 1.7, background: T.warnBg, borderRadius: 8, padding: "8px 10px" }}>{msg}</div>}
        <div><button onClick={onClose} style={{ marginTop: 14, background: "none", border: "none",
          color: T.sub, fontSize: 12.5, cursor: "pointer", textDecoration: "underline",
          padding: 0 }}>閉じる</button></div>
      </div>
    </div>
  );
}

// ---------- 認証モーダル ----------
function AuthModal({ open, onClose }) {
  const [tab, setTab] = useState("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const downOnBg = useRef(false);
  if (!open) return null;

  const rules = [
    { ok: pw.length >= 8, label: "8文字以上" },
    { ok: /[a-z]/.test(pw), label: "小文字を含む" },
    { ok: /[A-Z]/.test(pw), label: "大文字を含む" },
    { ok: /[0-9]/.test(pw), label: "数字を含む" },
    { ok: /[^A-Za-z0-9]/.test(pw), label: "記号(!?/#など)を含む" },
  ];
  const pwStrong = rules.every((r) => r.ok);
  const pwMatch = pw === pw2;

  const go = async () => {
    if (!email) { setMsg("メールアドレスを入力してください"); return; }
    if (tab === "signup") {
      if (!pwStrong) { setMsg("パスワードが条件を満たしていません。下のチェックリストをご確認ください"); return; }
      if (!pwMatch) { setMsg("確認用パスワードが一致しません"); return; }
    } else if (!pw) { setMsg("パスワードを入力してください"); return; }
    setBusy(true); setMsg("");
    try {
      if (tab === "signup") {
        const { error } = await supabase.auth.signUp({ email, password: pw });
        if (error) throw error;
        setMsg("確認メールを送信しました。メール内のリンクをクリックすると登録が完了します。完了後、ログインしてください。");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
        if (error) throw error;
        onClose();
      }
    } catch (e) {
      const t = String((e && e.message) || e);
      setMsg(t.includes("Invalid login") ? "メールアドレスまたはパスワードが正しくありません"
        : t.includes("already registered") ? "このメールアドレスは登録済みです。ログインしてください"
        : t);
    }
    setBusy(false);
  };

  const inSt = { width: "100%", padding: "10px 12px", border: `1px solid ${T.line}`,
    borderRadius: 8, fontSize: 14, marginBottom: 10, fontFamily: "inherit" };
  return (
    <div
      onMouseDown={(e) => { downOnBg.current = e.target === e.currentTarget; }}
      onMouseUp={(e) => {
        if (downOnBg.current && e.target === e.currentTarget) onClose();
        downOnBg.current = false;
      }}
      style={{ position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(22,34,46,0.55)", display: "flex", alignItems: "center",
        justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#FFF", borderRadius: 12,
        padding: 24, maxWidth: 400, width: "100%", maxHeight: "90vh", overflowY: "auto",
        boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
        <div style={{ display: "flex", gap: 0, marginBottom: 16, border: `1px solid ${T.line}`,
          borderRadius: 8, overflow: "hidden" }}>
          {[["login", "ログイン"], ["signup", "新規登録"]].map(([k, l]) => (
            <button key={k} onClick={() => { setTab(k); setMsg(""); setPw2(""); }}
              style={{ flex: 1, padding: "9px", border: "none", cursor: "pointer",
                fontSize: 13, fontWeight: 700,
                background: tab === k ? T.navy : "#FFF",
                color: tab === k ? "#FFF" : T.ink }}>{l}</button>
          ))}
        </div>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="メールアドレス" style={inSt} autoComplete="email" />
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)}
          placeholder="パスワード" style={inSt}
          autoComplete={tab === "signup" ? "new-password" : "current-password"}
          onKeyDown={(e) => tab === "login" && e.key === "Enter" && go()} />
        {tab === "signup" && (
          <>
            <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)}
              placeholder="パスワード(確認のためもう一度)"
              autoComplete="new-password"
              style={{ ...inSt,
                borderColor: pw2.length === 0 ? T.line : pwMatch ? T.good : T.real }}
              onKeyDown={(e) => e.key === "Enter" && go()} />
            {pw2.length > 0 && !pwMatch && (
              <div style={{ fontSize: 11.5, color: T.real, margin: "-4px 0 8px" }}>
                パスワードが一致していません</div>
            )}
            <div style={{ fontSize: 11.5, lineHeight: 1.9, background: "#F6F8FA",
              borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
              {rules.map((r) => (
                <div key={r.label} style={{ color: r.ok ? T.good : T.sub }}>
                  {r.ok ? "✓" : "・"} {r.label}</div>
              ))}
            </div>
          </>
        )}
        <button onClick={go}
          disabled={busy || (tab === "signup" && (!pwStrong || !pwMatch || pw2.length === 0))}
          style={{ width: "100%", padding: "11px",
            background: T.real, color: "#FFF", border: "none", borderRadius: 8,
            fontSize: 14, fontWeight: 700, cursor: "pointer",
            opacity: busy || (tab === "signup" && (!pwStrong || !pwMatch || pw2.length === 0)) ? 0.5 : 1 }}>
          {busy ? "処理中…" : tab === "signup" ? "アカウントを作成する" : "ログインする"}</button>
        {msg && <div style={{ fontSize: 12, color: T.warnInk, marginTop: 10,
          lineHeight: 1.7, background: T.warnBg, borderRadius: 8, padding: "8px 10px" }}>{msg}</div>}
        <div style={{ fontSize: 11, color: T.sub, marginTop: 12, lineHeight: 1.7 }}>
          保存した物件・リサーチ・プラン状態がアカウントに紐づき、どの端末からでも同じ環境で使えるようになります。
        </div>
        <button onClick={onClose} style={{ marginTop: 12, background: "none", border: "none",
          color: T.sub, fontSize: 12.5, cursor: "pointer", textDecoration: "underline",
          padding: 0 }}>閉じる</button>
      </div>
    </div>
  );
}

// ---------- アップグレードモーダル ----------
function UpgradeModal({ open, onClose, onUnlocked, authed, email, onRefresh }) {
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState("");
  const [checking, setChecking] = useState(false);
  const downOnBg = useRef(false);
  if (!open) return null;

  const tryKey = async () => {
    if (await verifyLicense(key)) {
      savePlan("pro"); setMsg(""); onUnlocked();
    } else {
      setMsg("ライセンスキーが正しくありません。形式: RP-XXXX-XXXX-XXXXXX");
    }
  };
  const purchaseHref = PURCHASE_URL
    ? PURCHASE_URL + (email
        ? (PURCHASE_URL.includes("?") ? "&" : "?") + "prefilled_email=" + encodeURIComponent(email)
        : "")
    : "";
  const checkNow = async () => {
    setChecking(true); setMsg("");
    await onRefresh();
    setChecking(false);
    setMsg("最新のプラン状態を取得しました。まだ開放されていない場合は、決済処理の反映まで1〜2分待って再度お試しください。");
  };

  const linkBtn = { display: "block", textAlign: "center", padding: "11px",
    background: T.real, color: "#FFF", borderRadius: 8, fontWeight: 700,
    fontSize: 14, textDecoration: "none", marginBottom: 14 };

  return (
    <div
      onMouseDown={(e) => { downOnBg.current = e.target === e.currentTarget; }}
      onMouseUp={(e) => {
        if (downOnBg.current && e.target === e.currentTarget) onClose();
        downOnBg.current = false;
      }}
      style={{ position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(22,34,46,0.55)", display: "flex", alignItems: "center",
      justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#FFF", borderRadius: 12,
        padding: 24, maxWidth: 440, width: "100%", maxHeight: "90vh", overflowY: "auto",
        boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
        <h3 style={{ fontSize: 18, fontWeight: 800, color: T.navy, margin: "0 0 4px" }}>
          Proプランで全機能を開放</h3>
        <p style={{ fontSize: 12.5, color: T.sub, margin: "0 0 12px", lineHeight: 1.7 }}>
          詳細モード(全パラメータ) ／ 分析タブ(感度・ストレス・出口) ／ 運用管理 ／
          AI市場調査 月10回 ／ 物件保存 無制限 ／ IRR・CCR・DSCR比較 ／ レポート出力(PDF)
        </p>

        {authed !== null ? (
          <>
            {PURCHASE_URL ? (
              <a href={purchaseHref} target="_blank" rel="noreferrer" style={linkBtn}>
                購入ページへ(¥1,480/月)</a>
            ) : (
              <div style={{ fontSize: 11.5, color: T.warnInk, background: T.warnBg,
                borderRadius: 8, padding: "8px 10px", marginBottom: 14, lineHeight: 1.6 }}>
                (開発メモ)購入リンクが未設定です。src/plan.js の PURCHASE_URL に
                StripeのPayment Link URLを設定してください。</div>
            )}
            <p style={{ fontSize: 12, color: T.sub, lineHeight: 1.8, margin: "0 0 10px" }}>
              登録メールアドレス(<b>{email}</b>)のまま決済してください。
              決済が完了すると、自動的にProプランへ切り替わります。
            </p>
            <button onClick={checkNow} disabled={checking} style={{ padding: "9px 16px",
              background: T.navy, color: "#FFF", border: "none", borderRadius: 8,
              fontSize: 13, fontWeight: 700, cursor: "pointer",
              opacity: checking ? 0.6 : 1 }}>
              {checking ? "確認中…" : "決済後、反映を確認する"}</button>
          </>
        ) : (
          <>
            {PURCHASE_URL ? (
              <a href={PURCHASE_URL} target="_blank" rel="noreferrer" style={linkBtn}>
                購入ページへ(¥1,480/月)</a>
            ) : (
              <div style={{ fontSize: 11.5, color: T.warnInk, background: T.warnBg,
                borderRadius: 8, padding: "8px 10px", marginBottom: 14, lineHeight: 1.6 }}>
                (開発メモ)購入リンクが未設定です。src/plan.js の PURCHASE_URL に
                Stripe Payment Link 等のURLを設定してください。</div>
            )}
            <div style={{ fontSize: 12, color: T.sub, marginBottom: 6 }}>
              購入後に届くライセンスキーを入力:</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={key} onChange={(e) => setKey(e.target.value)}
                placeholder="RP-XXXX-XXXX-XXXXXX"
                style={{ flex: 1, padding: "9px 11px", border: `1px solid ${T.line}`,
                  borderRadius: 8, fontSize: 14, fontFamily: "inherit",
                  textTransform: "uppercase" }} />
              <button onClick={tryKey} style={{ padding: "9px 16px", background: T.navy,
                color: "#FFF", border: "none", borderRadius: 8, fontSize: 13,
                fontWeight: 700, cursor: "pointer" }}>認証する</button>
            </div>
          </>
        )}
        {msg && <div style={{ fontSize: 12, color: authed !== null ? T.sub : T.real,
          marginTop: 10, lineHeight: 1.7 }}>{msg}</div>}
        <button onClick={onClose} style={{ marginTop: 16, background: "none", border: "none",
          color: T.sub, fontSize: 12.5, cursor: "pointer", textDecoration: "underline",
          padding: 0 }}>Freeのまま続ける</button>
      </div>
    </div>
  );
}

// ---------- main ----------
export default function App() {
  const [p, setP] = useState({
    // 物件
    price: 2000, costsPct: 7, bldgRatio: 40, depYears: 27,
    // 収入
    rent: 85000, rentDecline: 1.0, renewalEveryYears: 2, renewalOwnerMonths: 0.5,
    reikinMonths: 0,
    // 空室・退去
    stayYears: 4, vacancyMonths: 2, restorationCost: 150000, adMonths: 1,
    // 融資
    downPayment: 300, loanYears: 35, rate0: 1.8, rateSlope: 0.05, rateCap: 4.0,
    repayMethod: "annuity",
    // 経費
    mgmtPct: 5, bldgFee: 12000, bldgFeeInfl: 1.0, tax: 70000, insurance: 15000,
    otherAnnual: 0,
    // 修繕
    repairBase: 30000, repairInfl: 2.0, bigRepairCycle: 0, bigRepairCost: 100,
    // 税
    taxOn: false, taxRate: 30, lossOffset: true,
    // 売却
    saleOn: true, saleMode: "yield", exitYieldPct: 7, priceTrendPct: -1.0,
    sellCostPct: 4, capGainTaxOn: true,
    simYears: 35,
    equipment: [
      { name: "エアコン", cycle: 15, cost: 12, on: true, installYear: 2018 },
      { name: "給湯器", cycle: 12, cost: 18, on: true, installYear: 2016 },
      { name: "ガスコンロ", cycle: 15, cost: 6, on: true, installYear: 2018 },
      { name: "壁紙・床全面張替", cycle: 12, cost: 25, on: false, installYear: 2020 },
    ],
  });
  const set = (k) => (v) => setP((s) => ({ ...s, [k]: v }));
  const setEq = (i, k, v) => setP((s) => ({
    ...s, equipment: s.equipment.map((e, j) => (j === i ? { ...e, [k]: v } : e)),
  }));
  const addEq = () => setP((s) => ({
    ...s, equipment: [...s.equipment, { name: "新規設備", cycle: 10, cost: 10, on: true, installYear: new Date().getFullYear() }],
  }));
  const delEq = (i) => setP((s) => ({
    ...s, equipment: s.equipment.filter((_, j) => j !== i),
  }));

  // AI market data state
  const [area, setArea] = useState("東京都文京区");
  const [ptype, setPtype] = useState("中古区分マンション(ワンルーム〜1LDK)");
  const [aiState, setAiState] = useState({ status: "idle", data: null, error: null });

  // タブ・リサーチ・物件・予実(すべて永続保存)
  const [tab, setTab] = useState("sim");
  const [mode, setMode] = useState("easy"); // かんたん/詳細
  const [activePreset, setActivePreset] = useState(null);
  // プラン(フリーミアム) + アカウント認証
  const [localPlan, setLocalPlan] = useState(loadPlan()); // 認証未設定時のフォールバック
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [cmpReport, setCmpReport] = useState(null); // 比較レポート用の行データ
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [aiTick, setAiTick] = useState(0);

  useEffect(() => {
    if (!authEnabled) return;
    supabase.auth.getSession().then(({ data }) => setUser((data.session && data.session.user) || null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      const u = (session && session.user) || null;
      setUser(u);
      if (!u) purgeLocalMirror(); // ログアウト時: 端末に残る控えデータを消去
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const refreshProfile = async () => {
    if (!authEnabled || !user) { setProfile(null); return; }
    const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
    setProfile(data || null);
  };
  useEffect(() => { refreshProfile(); }, [user]);

  const plan = authEnabled
    ? (profile && profile.plan === "pro" ? "pro" : "free")
    : localPlan;
  const quotaLeft = useMemo(() => {
    if (authEnabled) {
      if (!profile || profile.plan !== "pro") return 0;
      const ym = new Date().toISOString().slice(0, 7);
      return Math.max(0, 10 - (profile.ai_month === ym ? profile.ai_used : 0));
    }
    return plan === "pro" ? aiQuota(plan).left : 0;
  }, [plan, aiTick, profile]);
  const isPro = plan === "pro";

  // ログアウトやプラン降格を検知したら、Pro限定のタブ・モードから退出する
  useEffect(() => {
    const settled = !authEnabled || !user || profile !== null; // プラン確定を待つ
    if (settled && !isPro) {
      if (tab === "ana" || tab === "ops") setTab("sim");
      if (mode === "pro") setMode("easy");
    }
  }, [isPro, user, profile, tab, mode]);
  const [records, setRecords] = useState([]);
  const [properties, setProperties] = useState([]);
  const [actuals, setActuals] = useState({ startYear: new Date().getFullYear(), items: [] });
  const [storageNote, setStorageNote] = useState("");
  useEffect(() => {
    loadKey(KEY_RESEARCH, []).then(setRecords);
    loadKey(KEY_PROPS, []).then(setProperties);
    loadKey(KEY_ACTUALS, null).then((a) =>
      setActuals(a || { startYear: new Date().getFullYear(), items: [] }));
    loadKey("ui-mode", "easy").then(setMode);
    setStorageNote(authEnabled && !user
      ? "ログインすると、保存データ(リサーチ・物件・予実)がアカウントに保存され、他の端末からも利用できます"
      : "");
  }, [user]);
  const switchMode = (k) => {
    if (k === "pro" && !isPro) { setUpgradeOpen(true); return; }
    setMode(k); saveKey("ui-mode", k);
  };
  const applyPreset = (ps) => { setP((s) => ({ ...s, ...ps.patch })); setActivePreset(ps.key); };

  const persistActuals = async (next) => { setActuals(next); await saveKey(KEY_ACTUALS, next); };
  const saveCurrentProperty = async (name) => {
    if (properties.length >= PLANS[plan].maxProperties) { setUpgradeOpen(true); return; }
    const rec = { id: Date.now(), name: name || `物件${properties.length + 1}`,
      savedAt: new Date().toISOString(),
      params: { ...p, equipment: p.equipment.map((e) => ({ ...e })) } };
    setProperties(await saveKey(KEY_PROPS, [rec, ...properties], 30));
  };
  const loadProperty = (rec) => {
    setP({ ...rec.params, equipment: rec.params.equipment.map((e) => ({ ...e })) });
    setTab("sim");
  };
  const deleteProperty = async (id) =>
    setProperties(await saveKey(KEY_PROPS, properties.filter((r) => r.id !== id)));

  const runFetch = async () => {
    if (authEnabled && !user) { setAuthOpen(true); return; }
    if (!isPro) { setUpgradeOpen(true); return; }
    if (quotaLeft <= 0) {
      setAiState({ status: "error", data: null,
        error: "今月のAI調査回数(10回)を使い切りました。翌月1日にリセットされます" });
      return;
    }
    setAiState({ status: "loading", data: null, error: null });
    try {
      let token = null;
      if (authEnabled) {
        const { data } = await supabase.auth.getSession();
        token = data.session ? data.session.access_token : null;
      }
      const d = await fetchMarketData(area, ptype, token);
      setAiState({ status: "done", data: d, error: null });
      // 成功したら自動でライブラリへ保存(エリア・物件タイプ・パラメータ・日時)
      const rec = {
        id: Date.now(),
        area, ptype,
        fetchedAt: new Date().toISOString(),
        data: d,
      };
      const next = await saveKey(KEY_RESEARCH, [rec, ...records], 50);
      setRecords(next);
      if (authEnabled) refreshProfile(); else aiQuota(plan).inc();
      setAiTick((t) => t + 1);
    } catch (e) {
      setAiState({ status: "error", data: null, error: String(e.message || e) });
    }
  };

  const applyData = (d) => {
    if (!d) return;
    setP((s) => ({
      ...s,
      rentDecline: typeof d.rentDeclinePct === "number" ? d.rentDeclinePct : s.rentDecline,
      stayYears: typeof d.stayYears === "number" ? d.stayYears : s.stayYears,
      vacancyMonths: typeof d.vacancyMonths === "number" ? d.vacancyMonths : s.vacancyMonths,
      rateSlope: typeof d.rateSlopePctPerYear === "number" ? d.rateSlopePctPerYear : s.rateSlope,
      priceTrendPct: typeof d.priceTrendPct === "number" ? d.priceTrendPct : s.priceTrendPct,
    }));
  };
  const applyAi = () => applyData(aiState.data);

  const [appliedId, setAppliedId] = useState(null);
  const applyRecord = (rec) => { applyData(rec.data); setAppliedId(rec.id); };
  const deleteRecord = async (id) => {
    const next = await saveKey(KEY_RESEARCH, records.filter((r) => r.id !== id), 50);
    setRecords(next);
    if (appliedId === id) setAppliedId(null);
  };

  const fmtDate = (iso) => {
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const real = useMemo(() => simulate(p, true), [p]);
  const opt = useMemo(() => simulate(p, false), [p]);
  const sale = useMemo(() => saleAnalysis(p, real), [p, real]);
  const metricsAll = useMemo(() => computeMetrics(p), [p]);
  const diag = useMemo(() => diagnose(p, metricsAll), [p, metricsAll]);

  const chartData = real.map((r, i) => ({
    year: r.year,
    現実累積: Math.round(r.cum / 10000),
    楽観累積: Math.round(opt[i].cum / 10000),
    単年CF: Math.round(r.cf / 10000),
    残債: Math.round(r.balance / 10000),
  }));

  const last = real[real.length - 1];
  const lastOpt = opt[opt.length - 1];
  const gap = lastOpt.cum - last.cum;
  const firstDeficit = real.find((r) => r.cf < 0);
  const grossYield = ((p.rent * 12) / (p.price * 10000)) * 100;
  const payback = real.find((r) => r.cum >= sale.initialEquity);
  const [showTable, setShowTable] = useState(false);

  const inputStyle = { padding: "8px 10px", border: `1px solid ${T.line}`,
    borderRadius: 6, fontSize: 14, background: "#FFF", color: T.ink };

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.ink,
      fontFamily: '"Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic",sans-serif',
      padding: "16px 12px 40px" }}>
      <div style={{ maxWidth: 880, margin: "0 auto" }}>

        <header style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.18em", color: T.real, fontWeight: 700 }}>
            悲観こそ事業計画の友
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: "4px 0 2px", color: T.navy }}>
            現実派 不動産収支シミュレーター v4
          </h1>
          <p style={{ fontSize: 12.5, color: T.sub, margin: 0, lineHeight: 1.6 }}>
            取得検討から運用・申告まで。AIによる地域市場データの自動反映に対応。
          </p>
          <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center",
            flexWrap: "wrap" }}>
            {authEnabled && (user
              ? <span style={{ fontSize: 11, color: T.sub }}>{user.email}
                  <button onClick={() => setAccountOpen(true)}
                    style={{ marginLeft: 8, background: "none", border: "none",
                      color: T.navy, textDecoration: "underline", cursor: "pointer",
                      fontSize: 11, padding: 0, fontWeight: 700 }}>設定</button>
                  <button onClick={() => supabase.auth.signOut()}
                    style={{ marginLeft: 8, background: "none", border: "none",
                      color: T.sub, textDecoration: "underline", cursor: "pointer",
                      fontSize: 11, padding: 0 }}>ログアウト</button></span>
              : <button onClick={() => setAuthOpen(true)}
                  style={{ padding: "4px 14px", background: T.navy, color: "#FFF",
                    border: "none", borderRadius: 12, fontSize: 11, fontWeight: 700,
                    cursor: "pointer" }}>ログイン / 新規登録</button>)}
            <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 14px",
              borderRadius: 12, border: `1px solid ${T.navy}`,
              background: isPro ? T.navy : "#FFF",
              color: isPro ? "#FFF" : T.navy }}>{PLANS[plan].label}プラン</span>
            {isPro
              ? <span style={{ fontSize: 11, color: T.sub }}>AI市場調査 今月あと{quotaLeft}回</span>
              : <button onClick={() => (authEnabled && !user ? setAuthOpen(true) : setUpgradeOpen(true))}
                  style={{ padding: "4px 14px",
                  background: T.real, color: "#FFF", border: "none", borderRadius: 12,
                  fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                  Proにアップグレード</button>}
          </div>
        </header>

        {upgradeOpen && <UpgradeModal open onClose={() => setUpgradeOpen(false)}
          authed={authEnabled ? !!user : null}
          email={user ? user.email : ""}
          onRefresh={refreshProfile}
          onUnlocked={() => { setLocalPlan("pro"); setUpgradeOpen(false); }} />}
        {authOpen && <AuthModal open onClose={() => setAuthOpen(false)} />}
        {accountOpen && <AccountModal open onClose={() => setAccountOpen(false)}
          user={user} profile={profile} />}
        {reportOpen && isPro && (
          <ReportView p={p}
            initialTitle={(PRESETS.find((x) => x.key === activePreset) || {}).name
              ? (PRESETS.find((x) => x.key === activePreset).name + " 収支分析レポート")
              : "検討物件 収支分析レポート"}
            onClose={() => setReportOpen(false)} />
        )}
        {cmpReport && <CompareReportView rows={cmpReport} onClose={() => setCmpReport(null)} />}

        <nav style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
          {[["sim", "シミュレーション", true], ["cmp", "物件比較", true],
            ["ana", "分析", isPro], ["ops", "運用管理", isPro]]
            .map(([k, l, ok]) => (
            <button key={k} onClick={() => (ok ? setTab(k) : setUpgradeOpen(true))} style={{
              padding: "8px 16px", borderRadius: 18, fontSize: 13, fontWeight: 700,
              cursor: "pointer",
              border: `1px solid ${tab === k ? T.navy : T.line}`,
              background: tab === k ? T.navy : T.card,
              color: tab === k ? "#FFF" : ok ? T.ink : T.sub }}>{ok ? l : "\uD83D\uDD12 " + l}</button>
          ))}
        </nav>

        {tab === "sim" && (<>

        {/* モード切替 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12,
          flexWrap: "wrap" }}>
          <div style={{ display: "flex", border: `1px solid ${T.line}`, borderRadius: 8,
            overflow: "hidden" }}>
            {[["easy", "かんたん"], ["pro", "詳細"]].map(([k, l]) => (
              <button key={k} onClick={() => switchMode(k)} style={{ padding: "7px 18px",
                fontSize: 12.5, fontWeight: 700, border: "none", cursor: "pointer",
                background: mode === k ? T.navy : "#FFF",
                color: mode === k ? "#FFF" : T.ink }}>{l}</button>
            ))}
          </div>
          <span style={{ fontSize: 11, color: T.sub }}>
            {mode === "easy"
              ? "3項目+プリセット+AI調査だけで診断できます。残りは保守的な値で自動設定済み"
              : "全パラメータを編集できます"}
          </span>
        </div>

        {/* プリセット */}
        <section style={cardSt}>
          <h2 style={h2St}>プリセット — 典型シナリオをワンタップ投入</h2>
          <div style={{ display: "grid", gap: 8,
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
            {PRESETS.map((ps) => (
              <button key={ps.key} onClick={() => applyPreset(ps)} style={{
                textAlign: "left", padding: "10px 12px", borderRadius: 8, cursor: "pointer",
                border: `1px solid ${activePreset === ps.key ? T.navy : T.line}`,
                background: activePreset === ps.key ? "rgba(31,58,82,0.07)" : "#FBFCFD" }}>
                <div style={{ fontSize: 13, fontWeight: 700,
                  color: ps.danger ? T.real : T.ink }}>
                  {ps.danger ? "⚠ " : ""}{ps.name}</div>
                <div style={{ fontSize: 11, color: T.sub, lineHeight: 1.5, marginTop: 2 }}>{ps.desc}</div>
              </button>
            ))}
          </div>
        </section>

        {/* 信号機診断 */}
        <DiagnosisCard diag={diag} />

        {/* かんたん入力 */}
        {mode === "easy" && (
          <section style={cardSt}>
            <h2 style={h2St}>かんたん入力 — まずはこの3つだけ</h2>
            <div style={{ display: "grid", gap: 12,
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
              <Field label="物件価格" value={p.price} onChange={set("price")} unit="万円" step={50} min={0}
                help="販売図面や業者提案書の物件価格をそのまま入力します。" />
              <Field label="月額家賃" value={p.rent} onChange={set("rent")} unit="円" step={1000} min={0}
                help="想定賃料。業者の提示額は強気なことが多いので、同じ建物・近隣の募集事例をポータルサイトで確認するのが安全です。" />
              <Field label="自己資金(頭金)" value={p.downPayment} onChange={set("downPayment")} unit="万円" step={50} min={0}
                help="物件価格に充当する手元資金。少ないほどレバレッジが効きますが返済余裕(DSCR)が悪化します。別途、価格の約7%の諸費用も現金で必要です。" />
            </div>
            <div style={{ fontSize: 11.5, color: T.sub, marginTop: 10, lineHeight: 1.7 }}>
              空室・金利・修繕などの前提はプリセットとAI市場調査の値で自動設定されています。
              数字の根拠を確認・変更したくなったら「詳細」モードへ — それが次のステップです。
            </div>
          </section>
        )}

        {/* AI market data */}
        <section style={{ background: T.aiBg, border: `1px solid #CBDDD8`, borderRadius: 10,
          padding: 16, marginBottom: 12 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: T.aiInk, margin: "0 0 10px" }}>
            AI市場データ取得(ウェブ検索) — 地域の実勢をパラメータへ自動反映
            <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, padding: "1px 9px",
              borderRadius: 10, background: isPro ? "transparent" : T.real,
              border: isPro ? `1px solid ${T.aiInk}` : "none",
              color: isPro ? T.aiInk : "#FFF" }}>
              {isPro ? `今月あと${quotaLeft}回` : "Pro限定"}</span>
          </h2>
          <div style={{ display: "grid", gap: 10,
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 12, color: T.sub }}>対象エリア</span>
              <input value={area} onChange={(e) => setArea(e.target.value)}
                placeholder="例: 東京都文京区 / 大阪市北区"
                style={{ ...inputStyle, width: "100%", marginTop: 3 }} />
            </label>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 12, color: T.sub }}>物件タイプ</span>
              <input value={ptype} onChange={(e) => setPtype(e.target.value)}
                style={{ ...inputStyle, width: "100%", marginTop: 3 }} />
            </label>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button onClick={runFetch} disabled={aiState.status === "loading"}
              style={{ padding: "9px 18px", background: T.aiInk, color: "#FFF", border: "none",
                borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: "pointer",
                opacity: aiState.status === "loading" ? 0.6 : 1 }}>
              {aiState.status === "loading" ? "調査中(数十秒かかります)…" : "市場データを調査する"}
            </button>
            {aiState.status === "done" && (
              <button onClick={applyAi}
                style={{ padding: "9px 18px", background: T.navy, color: "#FFF", border: "none",
                  borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                推定値をシミュレーションへ反映
              </button>
            )}
          </div>
          {aiState.status === "error" && (
            <div style={{ marginTop: 10, fontSize: 12, color: T.real }}>
              取得に失敗しました({aiState.error})。時間をおいて再実行するか、手動でパラメータを設定してください。
            </div>
          )}
          {aiState.status === "done" && aiState.data && (
            <div style={{ marginTop: 12, fontSize: 12.5, lineHeight: 1.7, color: T.ink,
              background: "#FFF", borderRadius: 8, padding: 12, border: `1px solid ${T.line}` }}>
              <div style={{ display: "grid", gap: 4,
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                fontVariantNumeric: "tabular-nums", marginBottom: 8 }}>
                <span>家賃変動: <b>{aiState.data.rentDeclinePct}%/年(下落)</b></span>
                <span>平均入居: <b>{aiState.data.stayYears}年</b></span>
                <span>空室期間: <b>{aiState.data.vacancyMonths}ヶ月</b></span>
                <span>金利上昇: <b>{aiState.data.rateSlopePctPerYear}%pt/年</b></span>
                <span>物件価格: <b>{aiState.data.priceTrendPct}%/年</b></span>
              </div>
              <div style={{ color: T.sub }}>{aiState.data.summary}</div>
              {Array.isArray(aiState.data.sources) && aiState.data.sources.length > 0 && (
                <div style={{ color: T.sub, marginTop: 4 }}>
                  参照: {aiState.data.sources.join(" / ")}
                </div>
              )}
            </div>
          )}
        </section>

        {/* 保存済みリサーチライブラリ */}
        <section style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 10,
          padding: 16, marginBottom: 12 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: T.navy, margin: "0 0 4px",
            display: "flex", justifyContent: "space-between" }}>
            <span>保存済みリサーチ({records.length}件)</span>
            <span style={{ color: T.sub, fontWeight: 400, fontSize: 11 }}>呼び出しは利用枠を消費しません</span>
          </h2>
          {storageNote && (
            <div style={{ fontSize: 11, color: T.warnInk, marginBottom: 6 }}>{storageNote}</div>
          )}
          {records.length === 0 ? (
            <div style={{ fontSize: 12.5, color: T.sub, padding: "8px 0" }}>
              まだ保存されたリサーチはありません。上のパネルで調査を実行すると、結果が自動でここに蓄積されます。
            </div>
          ) : (
            records.map((rec) => (
              <div key={rec.id} style={{
                border: `1px solid ${appliedId === rec.id ? T.aiInk : T.line}`,
                background: appliedId === rec.id ? T.aiBg : "#FBFCFD",
                borderRadius: 8, padding: "10px 12px", marginTop: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between",
                  flexWrap: "wrap", gap: 6, alignItems: "baseline" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                    {rec.area}
                    <span style={{ fontWeight: 400, color: T.sub, fontSize: 12 }}> ／ {rec.ptype}</span>
                  </div>
                  <div style={{ fontSize: 11, color: T.sub, fontVariantNumeric: "tabular-nums" }}>
                    リサーチ日時: {fmtDate(rec.fetchedAt)}
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px",
                  fontSize: 12, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>
                  <span>家賃変動 <b>{rec.data.rentDeclinePct}%/年</b></span>
                  <span>入居 <b>{rec.data.stayYears}年</b></span>
                  <span>空室 <b>{rec.data.vacancyMonths}ヶ月</b></span>
                  <span>金利 <b>+{rec.data.rateSlopePctPerYear}%pt/年</b></span>
                  <span>価格 <b>{rec.data.priceTrendPct}%/年</b></span>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button onClick={() => applyRecord(rec)}
                    style={{ padding: "6px 14px", background: appliedId === rec.id ? T.aiInk : T.navy,
                      color: "#FFF", border: "none", borderRadius: 6, fontSize: 12,
                      fontWeight: 700, cursor: "pointer" }}>
                    {appliedId === rec.id ? "反映中 ✓" : "このパラメータを反映"}
                  </button>
                  <button onClick={() => deleteRecord(rec.id)}
                    style={{ padding: "6px 12px", background: "none", color: T.real,
                      border: `1px solid ${T.line}`, borderRadius: 6, fontSize: 12,
                      cursor: "pointer" }}>削除</button>
                </div>
              </div>
            ))
          )}
        </section>

        {/* レポート出力 */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <button onClick={() => (isPro ? setReportOpen(true) : setUpgradeOpen(true))}
            style={{ padding: "8px 18px", background: "#FFF", color: T.navy,
              border: `1.5px solid ${T.navy}`, borderRadius: 8, fontSize: 12.5,
              fontWeight: 700, cursor: "pointer" }}>
            📄 レポート出力(PDF){!isPro && " — Pro"}</button>
        </div>

        {/* KPI */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          <Kpi label={`累積CF ${p.simYears}年(現実${p.taxOn ? "・税引後" : ""})`}
               value={fmtMan(last.cum)} color={last.cum < 0 ? T.real : T.good} />
          <Kpi label={`累積CF ${p.simYears}年(楽観)`} value={fmtMan(lastOpt.cum)} color={T.opt} />
          <Kpi label="楽観とのギャップ"
               value={gap >= 0 ? "−" + fmtMan(gap) : "+" + fmtMan(-gap)}
               color={gap >= 0 ? T.real : T.good}
               sub={gap >= 0 ? "楽観シミュが見落とす金額" : "更新料・礼金収入の計上で現実が上回る試算"} />
          <Kpi label="単年CF初赤字" value={firstDeficit ? `${firstDeficit.year}年目` : "なし"}
               color={firstDeficit ? T.warnInk : T.good} />
          {p.saleOn && (
            <Kpi label={`売却込み総合損益(${p.simYears}年目売却)`}
                 value={fmtMan(sale.total)} color={sale.total < 0 ? T.real : T.good}
                 sub={`売却想定 ${fmtMan(sale.salePrice)} − 残債 ${fmtMan(last.balance)} − 初期自己資金 ${fmtMan(sale.initialEquity)}`} />
          )}
          <Kpi label="表面利回り / 自己資金回収"
               value={grossYield.toFixed(2) + "%"}
               sub={payback ? `CFのみで回収 ${payback.year}年目` : "CFのみでは回収不能"} />
        </div>

        {/* charts */}
        <section style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 10,
          padding: "14px 8px 4px", marginBottom: 12 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: T.navy, margin: "0 8px 8px" }}>
            累積キャッシュフロー — 楽観と現実のギャップ(万円)
          </h2>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={T.line} strokeDasharray="2 4" />
              <XAxis dataKey="year" tick={{ fontSize: 11, fill: T.sub }} unit="年" />
              <YAxis tick={{ fontSize: 11, fill: T.sub }} width={52} />
              <Tooltip formatter={(v) => v.toLocaleString() + "万円"} labelFormatter={(l) => l + "年目"} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine y={0} stroke={T.ink} strokeWidth={1} />
              <Area type="monotone" dataKey="楽観累積" stroke="none" fill={T.realSoft}
                    activeDot={false} legendType="none" tooltipType="none" />
              <Line type="monotone" dataKey="楽観累積" stroke={T.opt} strokeWidth={2}
                    strokeDasharray="6 4" dot={false} />
              <Line type="monotone" dataKey="現実累積" stroke={T.real} strokeWidth={2.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </section>

        <section style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 10,
          padding: "14px 8px 4px", marginBottom: 16 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: T.navy, margin: "0 8px 8px" }}>
            単年キャッシュフロー(現実)とローン残債(万円)
          </h2>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={T.line} strokeDasharray="2 4" />
              <XAxis dataKey="year" tick={{ fontSize: 11, fill: T.sub }} unit="年" />
              <YAxis yAxisId="cf" tick={{ fontSize: 11, fill: T.sub }} width={52} />
              <YAxis yAxisId="bal" orientation="right" tick={{ fontSize: 11, fill: T.sub }} width={56} />
              <Tooltip formatter={(v) => v.toLocaleString() + "万円"} labelFormatter={(l) => l + "年目"} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine yAxisId="cf" y={0} stroke={T.ink} strokeWidth={1} />
              <Bar yAxisId="cf" dataKey="単年CF" radius={[2, 2, 0, 0]}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d["単年CF"] < 0 ? T.real : T.navy} />
                ))}
              </Bar>
              <Line yAxisId="bal" type="monotone" dataKey="残債" stroke={T.sub}
                    strokeWidth={1.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </section>

        {/* 詳細モード限定: 年次明細・全パラメータ */}
        {mode === "pro" && (<>
        {/* yearly table */}
        <section style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 10,
          padding: 16, marginBottom: 16 }}>
          <h2 onClick={() => setShowTable(!showTable)} style={{ fontSize: 13, fontWeight: 700,
            color: T.navy, margin: 0, cursor: "pointer",
            display: "flex", justifyContent: "space-between" }}>
            <span>年次明細表(現実シナリオ)</span><span style={{ color: T.sub }}>{showTable ? "−" : "+"}</span>
          </h2>
          {showTable && (
            <div style={{ overflowX: "auto", marginTop: 10 }}>
              <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%",
                fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${T.navy}`, color: T.navy }}>
                    {["年", "金利", "収入", "経費", "返済", p.taxOn ? "税" : null, "単年CF", "累積CF", "残債"]
                      .filter(Boolean).map((h) => (
                      <th key={h} style={{ padding: "6px 8px", textAlign: "right" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {real.map((r) => (
                    <tr key={r.year} style={{ borderBottom: `1px solid ${T.line}`,
                      color: r.cf < 0 ? T.real : T.ink }}>
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{r.year}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{r.rate.toFixed(2)}%</td>
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{fmtMan(r.income)}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{fmtMan(r.expense)}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{fmtMan(r.loanPaid)}</td>
                      {p.taxOn && <td style={{ padding: "5px 8px", textAlign: "right" }}>{fmtMan(r.taxPaid)}</td>}
                      <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 700 }}>{fmtMan(r.cf)}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{fmtMan(r.cum)}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{fmtMan(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* parameter sections */}
        <Section no="01" title="物件・取得コスト">
          <Field label="物件価格" value={p.price} onChange={set("price")} unit="万円" step={50} min={0} />
          <Field label="購入諸費用率" value={p.costsPct} onChange={set("costsPct")} unit="%" step={0.5} min={0}
                 hint="仲介・登記・取得税等(現金)" />
          <Field label="建物割合" help="物件価格のうち建物部分の比率。土地は減価償却できないため、この割合が節税効果(償却費)の大きさを決めます。" value={p.bldgRatio} onChange={set("bldgRatio")} unit="%" step={5} min={0}
                 hint="減価償却の対象(残りは土地)" />
          <Field label="残存償却年数" help="減価償却を計上できる残り年数。切れた年から帳簿上の利益が急増して税負担が跳ね上がる「デッドクロス」の引き金になります。" value={p.depYears} onChange={set("depYears")} unit="年" step={1} min={1}
                 hint="RC47年/木造22年から築年数を控除" />
        </Section>

        <Section no="02" title="収入(家賃・更新料・礼金)">
          <Field label="月額家賃(初年度)" value={p.rent} onChange={set("rent")} unit="円" step={1000} min={0} />
          <Field label="家賃下落率" help="築年数が進むと募集賃料は下がります。都心で年0.5〜1%、郊外で1〜2%が目安。長期CFに複利で効くため、感度分析でも最上位に来やすい重要前提です。" value={p.rentDecline} onChange={set("rentDecline")} unit="%/年" step={0.1} />
          <Field label="更新周期" value={p.renewalEveryYears} onChange={set("renewalEveryYears")} unit="年" step={1} min={0}
                 hint="0で更新料なし" />
          <Field label="更新料(貸主受取)" value={p.renewalOwnerMonths} onChange={set("renewalOwnerMonths")} unit="ヶ月分" step={0.25} min={0} />
          <Field label="礼金(貸主受取)" value={p.reikinMonths} onChange={set("reikinMonths")} unit="ヶ月分" step={0.5} min={0} />
        </Section>

        <Section no="03" title="退去・空室・原状回復">
          <Field label="平均入居期間" help="単身向けで2〜4年、ファミリー向けで5年超が目安。短いほど原状回復・広告料・空室が頻発し、収益を蝕みます。" value={p.stayYears} onChange={set("stayYears")} unit="年" step={0.5} min={0.5} />
          <Field label="退去後の空室期間" help="退去から次の入居までの無収入期間。その間も経費とローン返済は止まらないため、1ヶ月延びるだけで実質利回りが大きく削られます。" value={p.vacancyMonths} onChange={set("vacancyMonths")} unit="ヶ月" step={1} min={0}
                 hint="家賃ゼロ・経費は発生" />
          <Field label="原状回復費(大家負担)" help="経年劣化や通常使用による損耗(壁紙の日焼け等)の補修は、国交省ガイドライン上も貸主負担が原則。退去のたびに必ず発生する費用です。" value={p.restorationCost} onChange={set("restorationCost")} unit="円/退去" step={10000} min={0}
                 hint="経年劣化・通常損耗は貸主負担" />
          <Field label="募集広告料(AD)" help="入居者を決めてくれた仲介会社への成功報酬。賃貸需要が弱いエリアほど高く、2〜3ヶ月分必要な地域もあります。" value={p.adMonths} onChange={set("adMonths")} unit="ヶ月分" step={0.5} min={0} />
        </Section>

        <Section no="04" title="融資・金利上昇">
          <Field label="自己資金(頭金)" help="少ないほどレバレッジが効きますが、返済比率が上がりDSCR(返済余裕)が悪化します。フルローンは金融機関からも危険信号と見られます。" value={p.downPayment} onChange={set("downPayment")} unit="万円" step={50} min={0} />
          <Field label="返済期間" value={p.loanYears} onChange={set("loanYears")} unit="年" step={1} min={1} />
          <Select label="返済方式" value={p.repayMethod} onChange={set("repayMethod")}
                  options={[{ v: "annuity", l: "元利均等" }, { v: "principal", l: "元金均等" }]} />
          <Field label="当初金利" help="属性(年収・勤続)と金融機関で1%台〜4%台まで幅があります。0.5%の差が35年返済では数百万円の差になります。" value={p.rate0} onChange={set("rate0")} unit="%/年" step={0.05} min={0} />
          <Field label="金利上昇ペース" help="変動金利は日銀の政策次第で上がります。返済額が増えても家賃にはすぐ転嫁できないため、上昇局面ではCFが直接削られます。" value={p.rateSlope} onChange={set("rateSlope")} unit="%pt/年" step={0.01} min={0}
                 hint="毎年この幅で上昇(現実のみ)" />
          <Field label="金利上限" value={p.rateCap} onChange={set("rateCap")} unit="%" step={0.1} min={0} />
        </Section>

        <Section no="05" title="運営経費">
          <Field label="賃貸管理委託料" help="入居者対応・集金・クレーム処理を管理会社へ委託する費用で、相場は家賃の3〜5%。安すぎる会社は客付け力が弱いこともあります。" value={p.mgmtPct} onChange={set("mgmtPct")} unit="%(家賃比)" step={0.5} min={0} />
          <Field label="建物管理費・修繕積立金" help="区分マンション特有の固定費。空室でも毎月発生し、築年の経過とともに段階的に値上がりするのが通例です。" value={p.bldgFee} onChange={set("bldgFee")} unit="円/月" step={1000} min={0} />
          <Field label="積立金の増額率" value={p.bldgFeeInfl} onChange={set("bldgFeeInfl")} unit="%/年" step={0.5} min={0}
                 hint="段階増額方式を近似" />
          <Field label="固定資産税・都市計画税" value={p.tax} onChange={set("tax")} unit="円/年" step={5000} min={0} />
          <Field label="火災・地震保険" value={p.insurance} onChange={set("insurance")} unit="円/年" step={1000} min={0} />
          <Field label="その他経費(税理士等)" value={p.otherAnnual} onChange={set("otherAnnual")} unit="円/年" step={10000} min={0} />
        </Section>

        <Section no="06" title="修繕・大規模修繕">
          <Field label="経常修繕費(初年度)" help="水栓・換気扇など毎年コンスタントに発生する小修繕。築古ほど増え、職人単価のインフレで単価も上がります。" value={p.repairBase} onChange={set("repairBase")} unit="円/年" step={5000} min={0} />
          <Field label="修繕費上昇率" value={p.repairInfl} onChange={set("repairInfl")} unit="%/年" step={0.5} min={0} />
          <Field label="大規模修繕の周期" value={p.bigRepairCycle} onChange={set("bigRepairCycle")} unit="年" step={1} min={0}
                 hint="0でなし(一棟・戸建て向け)" />
          <Field label="大規模修繕の費用" value={p.bigRepairCost} onChange={set("bigRepairCost")} unit="万円/回" step={10} min={0} />
        </Section>

        <section style={{ background: T.card, borderRadius: 10, padding: 16,
          border: `1px solid ${T.line}`, marginBottom: 12 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: T.navy, margin: "0 0 12px",
            letterSpacing: "0.06em", borderBottom: `2px solid ${T.navy}`, paddingBottom: 6,
            display: "flex", justifyContent: "space-between" }}>
            <span>設備交換サイクル(大家負担)</span><span style={{ color: T.sub, fontWeight: 400 }}>07</span>
          </h2>
          {p.equipment.map((eq, i) => (
            <div key={i} style={{ display: "grid",
              gridTemplateColumns: "auto minmax(90px,1.2fr) 1fr 1fr auto", gap: 8,
              alignItems: "end", padding: "8px 0",
              borderBottom: `1px dashed ${T.line}` }}>
              <input type="checkbox" checked={eq.on} style={{ marginBottom: 12 }}
                     onChange={(e) => setEq(i, "on", e.target.checked)} />
              <label style={{ display: "block" }}>
                <span style={{ fontSize: 12, color: T.sub, display: "block", marginBottom: 3 }}>設備名</span>
                <input value={eq.name} onChange={(e) => setEq(i, "name", e.target.value)}
                       style={{ ...inputStyle, width: "100%" }} />
              </label>
              <Field label="周期" value={eq.cycle} unit="年" step={1} min={1}
                     onChange={(v) => setEq(i, "cycle", v)} />
              <Field label="費用" value={eq.cost} unit="万円" step={1} min={0}
                     onChange={(v) => setEq(i, "cost", v)} />
              <button onClick={() => delEq(i)} title="削除"
                style={{ background: "none", border: `1px solid ${T.line}`, borderRadius: 6,
                  color: T.real, cursor: "pointer", padding: "8px 10px", marginBottom: 1 }}>×</button>
            </div>
          ))}
          <button onClick={addEq}
            style={{ marginTop: 10, padding: "8px 16px", background: "none",
              border: `1px dashed ${T.navy}`, borderRadius: 6, color: T.navy,
              fontSize: 13, cursor: "pointer" }}>+ 設備を追加</button>
        </section>

        <Section no="08" title="税金(簡易・現実シナリオのみ)">
          <Check label="不動産所得への課税を考慮する" checked={p.taxOn} onChange={set("taxOn")} />
          <Field label="限界税率(所得税+住民税)" value={p.taxRate} onChange={set("taxRate")} unit="%" step={1} min={0}
                 hint="給与と合算した場合の適用税率" />
          <Check label="損益通算(赤字時は給与税の還付)" checked={p.lossOffset} onChange={set("lossOffset")} />
        </Section>

        <Section no="09" title="売却出口">
          <Check label="売却出口を総合損益に含める" checked={p.saleOn} onChange={set("saleOn")} />
          <Select label="売却価格の算定方式" value={p.saleMode} onChange={set("saleMode")}
                  options={[{ v: "yield", l: "売却時利回り基準" }, { v: "trend", l: "価格変動率基準" }]} />
          <Field label="売却時の表面利回り" help="出口で買い手が要求する利回り。築古になるほど高い利回り(=安い価格)でないと売れなくなります。購入時より2〜3pt高く見るのが保守的です。" value={p.exitYieldPct} onChange={set("exitYieldPct")} unit="%" step={0.5} min={1}
                 hint="利回り基準のとき使用" />
          <Field label="物件価格の変動率" value={p.priceTrendPct} onChange={set("priceTrendPct")} unit="%/年" step={0.5}
                 hint="変動率基準のとき使用(AI反映対象)" />
          <Field label="売却諸費用" value={p.sellCostPct} onChange={set("sellCostPct")} unit="%" step={0.5} min={0} />
          <Check label="譲渡所得税(長期20.315%)を考慮" checked={p.capGainTaxOn} onChange={set("capGainTaxOn")} />
          <Field label="シミュレーション期間" value={p.simYears} onChange={set("simYears")} unit="年" step={1} min={5} />
        </Section>
        </>)}

        </>)}

        {tab === "cmp" && (
          <CompareTab properties={properties} current={p} plan={plan}
            onUpgrade={() => setUpgradeOpen(true)}
            onReport={(rows) => setCmpReport(rows)}
            onSave={saveCurrentProperty} onLoad={loadProperty} onDelete={deleteProperty} />
        )}
        {tab === "ana" && isPro && <AnalysisTab p={p} />}
        {tab === "ops" && isPro && (
          <OpsTab p={p} setP={setP} actuals={actuals} persist={persistActuals} />
        )}

        <footer style={{ background: T.warnBg, border: `1px solid #E8D9BC`, borderRadius: 10,
          padding: "12px 14px", fontSize: 12, color: T.warnInk, lineHeight: 1.7 }}>
          注意:税計算は限界税率による簡易計算で、累進・各種控除・建物附属設備の償却区分・資本的支出の資産計上は簡略化しています。
          AI取得データはウェブ検索に基づく推定値であり、最終判断には自身でのレントロール・登記・管理規約等の一次資料確認が必要です。
          「楽観」は満室・金利固定・家賃一定・退去/設備/税コストなしの前提を再現したものです。
        </footer>
      </div>
    </div>
  );
}
