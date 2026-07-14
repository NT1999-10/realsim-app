import React, { useRef, useState } from "react";
import { T } from "../theme.js";
import { btnSt } from "../ui.jsx";

export const BOOKMARKLET_CODE = "javascript:(function(){var t=document.title.slice(0,60);var body=document.body.innerText;function yen(re){var m=body.match(re);return m?m[1].replace(/,/g,''):null;}var price=yen(/([0-9,]+(?:\\.[0-9]+)?)\\s*万円/);var rent=yen(/(?:賃料|家賃|想定賃料)[^0-9]{0,10}([0-9,]+)\\s*円/);var d={n:t,u:location.href,p:price?parseFloat(price):null,r:rent?parseInt(rent):null};location.href='https://realsim-app.vercel.app/?lead='+encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(d)))));})();";

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

export default function BookmarkletSetup() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const textRef = useRef(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(BOOKMARKLET_CODE);
      setCopied(true);
    } catch {
      textRef.current?.select();
      document.execCommand("copy");
      setCopied(true);
    }
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (<>
    <button type="button" onClick={() => setOpen(true)}
      style={{ ...btnSt(T.teal), marginBottom: 12 }}>
      🔖 ブックマークレットを入手
    </button>

    {open && (
      <div onClick={() => setOpen(false)}
        style={{ position: "fixed", inset: 0, background: "rgba(16,32,46,.48)",
          zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center",
          padding: 16 }}>
        <div onClick={(e) => e.stopPropagation()}
          style={{ width: "min(620px,100%)", maxHeight: "90vh", overflowY: "auto",
            background: "#FFF", borderRadius: 16, padding: 20,
            boxShadow: "0 22px 60px rgba(16,32,46,.24)" }}>
          <div style={{ display: "flex", justifyContent: "space-between",
            alignItems: "center", gap: 12, marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 16, color: T.navy }}>
              ブックマークレットを登録
            </h3>
            <button type="button" onClick={() => setOpen(false)}
              aria-label="閉じる"
              style={{ border: "none", background: "none", color: T.sub,
                fontSize: 22, cursor: "pointer" }}>×</button>
          </div>

          <div style={{ fontSize: 12.5, color: T.sub, lineHeight: 1.8, marginBottom: 12 }}>
            下のボタンをブックマークバーへドラッグしてください。
          </div>
          <a href={BOOKMARKLET_CODE}
            style={{ display: "inline-block", padding: "10px 20px", borderRadius: 10,
              background: T.grad, color: "#FFF", textDecoration: "none",
              fontSize: 13.5, fontWeight: 800, marginBottom: 14 }}>
            現実派に保存
          </a>

          <label style={{ display: "block", fontSize: 11.5, color: T.sub }}>
            コピーして登録する場合
            <textarea ref={textRef} readOnly value={BOOKMARKLET_CODE}
              onFocus={(e) => e.target.select()}
              style={{ display: "block", width: "100%", minHeight: 90, marginTop: 4,
                padding: 9, border: "1px solid " + T.line, borderRadius: 8,
                fontSize: 10.5, lineHeight: 1.5, color: T.ink, resize: "vertical" }} />
          </label>
          <button type="button" onClick={copy}
            style={{ ...btnSt(T.navy), marginTop: 7 }}>
            {copied ? "コピーしました" : "コードをコピー"}
          </button>

          <ol style={{ margin: "16px 0 0", paddingLeft: 22, color: T.ink,
            fontSize: 12.5, lineHeight: 1.9 }}>
            <li>「現実派に保存」をブックマークバーへドラッグして登録</li>
            <li>物件ページを開き、登録したブックマークをクリック</li>
            <li>現実派の検討候補トレイで取り込み内容を確認</li>
          </ol>
          <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8,
            background: T.warnBg, color: T.warnInk, fontSize: 11.5, lineHeight: 1.7 }}>
            数字が拾えない/ずれる場合は、保存後にトレイで直してください
          </div>
        </div>
      </div>
    )}
  </>);
}
