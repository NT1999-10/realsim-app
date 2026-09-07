import React, { useState } from "react";
import { T } from "./theme.js";
import { Icon } from "./icons.jsx";

// ---------- UI pieces ----------
export function Field({ label, value, onChange, unit, step = 1, min, hint, help }) {
  const [showHelp, setShowHelp] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <label style={{ display: "block" }}>
      <span style={{ fontSize: 13.5, fontWeight: 700, color: T.ink, display: "flex",
        alignItems: "center", gap: 5, marginBottom: 6 }}>
        {label}
        {help && (
          <button type="button"
            onClick={(e) => { e.preventDefault(); setShowHelp(!showHelp); }}
            style={{ width: 18, height: 18, borderRadius: T.pill, border: `1px solid ${T.gold}`,
              background: showHelp ? T.gold : "transparent", color: showHelp ? "#FFF" : T.gold,
              fontSize: 11, lineHeight: "15px", cursor: "pointer", padding: 0, flexShrink: 0 }}>
            ?</button>
        )}
      </span>
      <span style={{ display: "flex", alignItems: "center", background: "#FFF",
        border: `1.5px solid ${focused ? T.teal : T.line2}`, borderRadius: T.rS,
        padding: "0 14px", boxShadow: focused ? "0 0 0 4px rgba(74,116,171,.14)" : "none",
        transition: "border-color .18s, box-shadow .18s" }}>
        <input type="number" value={value} step={step} min={min}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          style={{ flex: 1, width: "100%", minWidth: 0, padding: "11px 0", border: "none",
            outline: "none", fontFamily: T.mono, fontSize: 19, fontWeight: 700,
            textAlign: "right", color: T.ink, background: "transparent",
            fontVariantNumeric: "tabular-nums" }} />
        {unit && (
          <span style={{ fontSize: 13, fontWeight: 700, color: T.faint,
            marginLeft: 8, whiteSpace: "nowrap" }}>{unit}</span>
        )}
      </span>
      {help && showHelp && (
        <span style={{ fontSize: 12, color: T.aiInk, display: "block", marginTop: 6,
          lineHeight: 1.65, background: T.goldSoft, borderRadius: T.rS,
          padding: "7px 10px" }}>{help}</span>
      )}
      {hint && (
        <span style={{ fontSize: 12, color: T.faint, display: "block", marginTop: 4 }}>
          {hint}
        </span>
      )}
    </label>
  );
}

export function Select({ label, value, onChange, options }) {
  const [focused, setFocused] = useState(false);
  return (
    <label style={{ display: "block" }}>
      <span style={{ fontSize: 13.5, fontWeight: 700, color: T.ink,
        display: "block", marginBottom: 6 }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={{ width: "100%", padding: "11px 14px",
          border: `1.5px solid ${focused ? T.teal : T.line2}`,
          borderRadius: T.rS, fontSize: 15, fontFamily: T.sans, color: T.ink,
          background: "#FFF", outline: "none",
          boxShadow: focused ? "0 0 0 4px rgba(74,116,171,.14)" : "none",
          transition: "border-color .18s, box-shadow .18s" }}>
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
  );
}

export function Kpi({ label, value, color, sub }) {
  const isEnglishLabel = typeof label === "string" && /^[\x00-\x7F]+$/.test(label);
  return (
    <div style={{ background: T.card, borderRadius: T.rS, border: `1px solid ${T.line}`,
      boxShadow: T.sh1, padding: "14px 16px", flex: "1 1 145px" }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: T.faint,
        letterSpacing: ".04em", marginBottom: 4,
        fontFamily: isEnglishLabel ? T.mono : T.sans }}>{label}</div>
      <div style={{ fontFamily: T.mono, fontSize: 26, fontWeight: 700,
        fontVariantNumeric: "tabular-nums", color: color || T.ink, lineHeight: 1.2 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 12, color: T.faint, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export const cardSt = {
  background: T.card, borderRadius: T.r, boxShadow: T.sh1,
  padding: 22, border: `1px solid ${T.line}`, marginBottom: 14,
};

// 見出し: 青の下線3pxをやめ、明朝 + 細い罫線 + 山吹の短いバーへ
export const h2St = {
  fontSize: 17, fontWeight: 700, fontFamily: T.serif, color: T.navy,
  margin: "0 0 16px", letterSpacing: "0.01em",
  borderBottom: `1px solid ${T.line}`, paddingBottom: 10,
  display: "flex", alignItems: "center", gap: 10,
};

export const btnSt = (bg) => ({
  padding: "11px 20px",
  background: bg === T.blue || bg === T.navy ? T.grad : bg === T.gold ? T.gradGold : bg,
  color: "#FFF", border: "none", borderRadius: T.rS,
  fontSize: 14.5, fontWeight: 700, cursor: "pointer",
  boxShadow: T.sh1, transition: "transform .18s cubic-bezier(.2,.8,.3,1), box-shadow .18s",
});

export function LockCard({ onUpgrade, label, children }) {
  return (
    <div style={{ position: "relative" }}>
      <div style={{ filter: "blur(5px)", pointerEvents: "none", userSelect: "none",
        opacity: 0.65 }}>{children}</div>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6,
          fontSize: 13.5, fontWeight: 700, color: T.navy,
          background: "rgba(255,255,255,.92)", padding: "6px 16px", borderRadius: T.rS }}>
          <Icon name="shield" size={16} color={T.navy} />
          <span>{label}はProプランの機能です</span>
        </div>
        <button onClick={onUpgrade} style={btnSt(T.navy)}>Proで開放する</button>
      </div>
    </div>
  );
}
