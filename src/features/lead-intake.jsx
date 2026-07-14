import React, { useRef, useState } from "react";
import { T } from "../theme.js";
import { btnSt } from "../ui.jsx";

export function decodeLeadPayload(encoded) {
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const data = JSON.parse(new TextDecoder().decode(bytes));
  const numberOrZero = (value) => {
    if (value == null || value === "") return 0;
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  };
  return {
    name: typeof data.n === "string" && data.n.trim() ? data.n.trim() : "取り込み物件",
    url: typeof data.u === "string" ? data.u : "",
    price: numberOrZero(data.p),
    rent: numberOrZero(data.r),
    memo: "",
  };
}

export function extractLeadFromText(text) {
  const source = String(text || "");
  const firstLine = source.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  const priceMatch = source.match(/([0-9,][0-9,.]*)\s*万円/);
  const rentMatch = source.match(/(?:賃料|家賃|想定賃料)[^0-9]{0,10}([0-9,]+)\s*円/);
  const toNumber = (match) => match ? Number(match[1].replace(/,/g, "")) : null;
  return {
    name: firstLine.slice(0, 60),
    price: toNumber(priceMatch),
    rent: toNumber(rentMatch),
    url: "",
  };
}

export default function LeadIntake({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [pageText, setPageText] = useState("");
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState(null);
  const [highlightPaste, setHighlightPaste] = useState(false);
  const pasteRef = useRef(null);
  const fetchControllerRef = useRef(null);
  const downOnBg = useRef(false);

  const resetIntake = () => {
    const controller = fetchControllerRef.current;
    fetchControllerRef.current = null;
    controller?.abort();
    setUrl("");
    setPageText("");
    setPreview(null);
    setError("");
    setLoading(false);
    setMessage(null);
    setHighlightPaste(false);
    downOnBg.current = false;
  };

  const openIntake = () => {
    resetIntake();
    setOpen(true);
  };

  const closeIntake = () => {
    resetIntake();
    setOpen(false);
  };

  const guideToPaste = (reason = "") => {
    const prefix = reason ? reason + "。 " : "";
    setError(prefix + "自動取得できませんでした。下の欄にページの文章を貼り付けてください");
    setHighlightPaste(true);
    window.setTimeout(() => pasteRef.current?.scrollIntoView(
      { behavior: "smooth", block: "center" }), 0);
  };

  const fetchPreview = async () => {
    if (!url.trim()) { guideToPaste("URLを入力してください"); return; }
    setLoading(true); setError(""); setMessage(null);
    fetchControllerRef.current?.abort();
    const controller = new AbortController();
    fetchControllerRef.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch("/api/lead-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || !data.ok) {
        guideToPaste(data && data.error ? data.error : "");
        return;
      }
      setPreview({
        name: data.name || "",
        price: data.price,
        rent: data.rent,
        url: url.trim(),
      });
      setHighlightPaste(false);
    } catch {
      if (fetchControllerRef.current === controller) guideToPaste("");
    } finally {
      window.clearTimeout(timer);
      if (fetchControllerRef.current === controller) {
        fetchControllerRef.current = null;
        setLoading(false);
      }
    }
  };

  const extractText = () => {
    const extracted = extractLeadFromText(pageText);
    setPreview({ ...extracted, url: preview?.url || url.trim() });
    setError("");
    setMessage(null);
    setHighlightPaste(false);
  };

  const add = async () => {
    if (!preview || !String(preview.name || "").trim()) {
      setMessage({ ok: false, text: "物件名を入力してください" });
      return;
    }
    const result = await onAdd({
      name: String(preview.name).trim(),
      url: String(preview.url || "").trim(),
      price: Math.max(0, Number(preview.price) || 0),
      rent: Math.max(0, Number(preview.rent) || 0),
      memo: "",
    });
    if (result.ok) {
      closeIntake();
      return;
    }
    setMessage({ ok: false, text: result.msg });
  };

  const inputStyle = { width: "100%", padding: "8px 10px",
    border: "1px solid " + T.line, borderRadius: 8, fontSize: 13,
    background: "#FBFCFD", color: T.ink };

  return (<>
    <button type="button" onClick={openIntake}
      style={{ ...btnSt(T.teal), marginBottom: 12 }}>
      📥 ページから取り込み
    </button>

    {open && (
      <div
        onMouseDown={(e) => { downOnBg.current = e.target === e.currentTarget; }}
        onMouseUp={(e) => {
          if (downOnBg.current && e.target === e.currentTarget) closeIntake();
          downOnBg.current = false;
        }}
        style={{ position: "fixed", inset: 0, background: "rgba(16,32,46,.48)",
          zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center",
          padding: 16 }}>
        <div onMouseDown={(e) => e.stopPropagation()}
          style={{ width: "min(660px,100%)", maxHeight: "90vh", overflowY: "auto",
            background: "#FFF", borderRadius: 16, padding: 20,
            boxShadow: "0 22px 60px rgba(16,32,46,.24)" }}>
          <div style={{ display: "flex", justifyContent: "space-between",
            alignItems: "center", gap: 12, marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 16, color: T.navy }}>ページから取り込み</h3>
            <button type="button" onClick={closeIntake} aria-label="閉じる"
              style={{ border: "none", background: "none", color: T.sub,
                fontSize: 22, cursor: "pointer" }}>×</button>
          </div>

          <section style={{ padding: 14, border: "1px solid " + T.line,
            borderRadius: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: T.navy, marginBottom: 8 }}>
              1. URLで取り込み（推奨）
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input value={url} onChange={(e) => setUrl(e.target.value)}
                placeholder="物件ページのURLを貼り付け" style={{ ...inputStyle, flex: 1 }} />
              <button type="button" onClick={fetchPreview} disabled={loading}
                style={{ ...btnSt(T.blue), opacity: loading ? 0.6 : 1,
                  whiteSpace: "nowrap" }}>
                {loading ? "取得中…" : "取得する"}
              </button>
            </div>
            {error && <div style={{ marginTop: 8, color: T.real,
              fontSize: 12, lineHeight: 1.7 }}>{error}</div>}
          </section>

          <section ref={pasteRef} style={{ padding: 14,
            border: "2px solid " + (highlightPaste ? T.real : T.line),
            background: highlightPaste ? T.realSoft : "#FFF",
            borderRadius: 12, marginBottom: 12, transition: "all .2s" }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: T.navy, marginBottom: 5 }}>
              2. ページの文章で取り込み（確実な方法）
            </div>
            <div style={{ fontSize: 12, color: T.sub, lineHeight: 1.7, marginBottom: 8 }}>
              物件ページで Ctrl+A → Ctrl+C し、ここに貼り付けてください（スマホは共有→コピー）
            </div>
            <textarea value={pageText} onChange={(e) => setPageText(e.target.value)}
              placeholder="物件ページの文章を貼り付け"
              style={{ ...inputStyle, minHeight: 120, resize: "vertical", lineHeight: 1.6 }} />
            <button type="button" onClick={extractText}
              style={{ ...btnSt(T.navy), marginTop: 8 }}>抽出する</button>
          </section>

          {preview && (
            <section style={{ padding: 14, border: "1px solid " + T.teal,
              background: T.aiBg, borderRadius: 12 }}>
              <div style={{ fontSize: 13.5, fontWeight: 800,
                color: T.aiInk, marginBottom: 9 }}>取り込み内容を確認・修正</div>
              <div style={{ display: "grid", gap: 9,
                gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
                <label style={{ fontSize: 11.5, color: T.sub }}>物件名
                  <input value={preview.name || ""}
                    onChange={(e) => setPreview({ ...preview, name: e.target.value })}
                    style={inputStyle} /></label>
                <label style={{ fontSize: 11.5, color: T.sub }}>価格（万円）
                  <input type="number" min={0} value={preview.price ?? ""}
                    onChange={(e) => setPreview({ ...preview, price: e.target.value })}
                    style={inputStyle} /></label>
                <label style={{ fontSize: 11.5, color: T.sub }}>家賃（円）
                  <input type="number" min={0} value={preview.rent ?? ""}
                    onChange={(e) => setPreview({ ...preview, rent: e.target.value })}
                    style={inputStyle} /></label>
                <label style={{ fontSize: 11.5, color: T.sub }}>元URL（任意）
                  <input value={preview.url || ""}
                    onChange={(e) => setPreview({ ...preview, url: e.target.value })}
                    style={inputStyle} /></label>
              </div>
              <button type="button" onClick={add}
                style={{ ...btnSt(T.teal), marginTop: 10 }}>トレイに追加</button>
              {message && <div style={{ marginTop: 7,
                color: message.ok ? T.good : T.real, fontSize: 12,
                fontWeight: 700 }}>{message.text}</div>}
            </section>
          )}

          <div style={{ marginTop: 12, fontSize: 10.5, color: T.sub, lineHeight: 1.7 }}>
            取り込みは、あなたが閲覧中のページをあなたの操作で1件ずつ保存する機能です。
            サイトの一括取得は行いません。取得内容は必ず元ページで確認してください。
          </div>
        </div>
      </div>
    )}
  </>);
}
