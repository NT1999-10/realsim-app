import React, { useState } from "react";
import { T } from "./theme.js";

// ---------- UI pieces ----------
export function Field({ label, value, onChange, unit, step = 1, min, hint, help }) {
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

export function Select({ label, value, onChange, options }) {
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

export function Kpi({ label, value, color, sub }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 14, boxShadow: "0 10px 28px rgba(31,58,82,.06)",
      padding: "12px 14px", flex: "1 1 145px" }}>
      <div style={{ fontSize: 11, color: T.sub, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 700, color: color || T.ink,
        fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: T.sub, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

export const cardSt = { background: T.card, borderRadius: 14, boxShadow: "0 10px 28px rgba(31,58,82,.06)", padding: 16,
  border: `1px solid ${T.line}`, marginBottom: 12 };
const h2St = { fontSize: 13, fontWeight: 700, color: T.navy, margin: "0 0 12px",
  letterSpacing: "0.06em", borderBottom: `3px solid ${T.blue}`, paddingBottom: 6 };
const btnSt = (bg) => ({ padding: "8px 16px", background: bg, color: "#FFF",
  border: "none", borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: "pointer" });

export function LockCard({ onUpgrade, label, children }) {
  return (
    <div style={{ position: "relative" }}>
      <div style={{ filter: "blur(5px)", pointerEvents: "none", userSelect: "none",
        opacity: 0.65 }}>{children}</div>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 10 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: T.navy,
          background: "rgba(255,255,255,.85)", padding: "6px 16px", borderRadius: 10 }}>
          🔒 {label}はProプランの機能です</div>
        <button onClick={onUpgrade} style={{ padding: "9px 22px", background: T.grad,
          color: "#FFF", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700,
          cursor: "pointer" }}>Proで開放する</button>
      </div>
    </div>
  );
}
