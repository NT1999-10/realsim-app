import React, { useMemo, useState } from "react";
import { T } from "../theme.js";
import { btnSt } from "../ui.jsx";
import {
  parseAuctionPaste,
  updateAuctionPasteRow,
  auctionPasteRowsToCsv,
  auctionTemplateCsv,
} from "./auction-paste.js";

const TYPES = ["マンション", "戸建て", "土地", "その他"];
const inputSt = {
  width: "100%", padding: "8px 10px", border: "1px solid " + T.line,
  borderRadius: 7, fontSize: 13, color: T.ink, background: "#FBFCFD",
};
function importSummaryText(label, data) {
  const inserted = Number(data && data.inserted) || 0;
  const updated = Number(data && data.updated) || 0;
  const skipped = Number(data && data.skipped) || 0;
  const details = Array.isArray(data && data.errors)
    ? data.errors.slice(0, 5).map((item) =>
      String(item.row) + "行目: " + String(item.reason || "取り込み対象外")).join(" ／ ")
    : "";
  return label + "（新規" + inserted + "件・更新" + updated +
    "件・除外" + skipped + "件）" + (details ? " " + details : "");
}

function downloadAuctionTemplate() {
  const blob = new Blob([auctionTemplateCsv()], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = "auction-import-template.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

export default function AuctionPasteImport({ request, onImported }) {
  const [source, setSource] = useState("");
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const selectedCount = useMemo(() =>
    rows.filter((row) => row.selected && !row.errors.length).length, [rows]);

  const analyze = () => {
    setMessage(null);
    try {
      const next = parseAuctionPaste(source);
      setRows(next);
      const errors = next.filter((row) => row.errors.length).length;
      const warnings = next.filter((row) => !row.errors.length && row.warnings.length).length;
      setMessage({
        ok: errors === 0,
        text: "解析しました（全" + next.length + "件・警告" + warnings +
          "件・エラー" + errors + "件）",
      });
    } catch (error) {
      setRows([]);
      setMessage({
        ok: false,
        text: "解析できませんでした: " + String(error && error.message || error),
      });
    }
  };

  const editRow = (index, key, value) => {
    setRows((current) => current.map((row, rowIndex) =>
      rowIndex === index ? updateAuctionPasteRow(row, key, value) : row));
  };

  const toggleRow = (index) => {
    setRows((current) => current.map((row, rowIndex) =>
      rowIndex === index && !row.errors.length
        ? { ...row, selected: !row.selected } : row));
  };

  const submit = async () => {
    const selected = rows.filter((row) => row.selected && !row.errors.length);
    if (!selected.length) {
      setMessage({ ok: false, text: "登録する正常行を1件以上選択してください" });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const csv = auctionPasteRowsToCsv(selected);
      const data = await request({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      setMessage({
        ok: Number(data.skipped) === 0,
        text: importSummaryText("選択行を登録しました", data),
      });
      setRows((current) => current.map((row) => ({ ...row, selected: false })));
      await onImported();
    } catch (error) {
      setMessage({
        ok: false,
        text: "登録できませんでした: " + String(error && error.message || error),
      });
    } finally {
      setBusy(false);
    }
  };

  const inputValue = (row, key) => {
    const raw = row.raw || {};
    return Object.prototype.hasOwnProperty.call(raw, key)
      ? raw[key] : row.values[key] == null ? "" : row.values[key];
  };

  return (
    <div style={{ padding: 14, border: "2px solid " + T.teal, borderRadius: 10,
      background: "rgba(43,184,163,.04)", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8,
        justifyContent: "space-between", flexWrap: "wrap" }}>
        <h3 style={{ fontSize: 15, color: T.navy, margin: 0 }}>
          方式C: 表を貼り付けて一括登録
        </h3>
        <button type="button" onClick={downloadAuctionTemplate}
          style={btnSt(T.sub)}>CSVテンプレートをダウンロード</button>
      </div>
      <p style={{ fontSize: 12.5, color: T.sub, lineHeight: 1.7, margin: "9px 0" }}>
        BITの検索結果ページで表の範囲を選択して Ctrl+C し、そのまま貼り付けてください。
        Excelからの貼り付け(タブ区切り)、CSV、BITからダウンロードしたファイルの中身にも対応します。
      </p>
      <textarea value={source} onChange={(event) => setSource(event.target.value)}
        placeholder="BITの検索結果表、Excelの表、CSVの内容を貼り付けてください"
        style={{ ...inputSt, minHeight: 190, fontFamily: "monospace",
          resize: "vertical", background: "#FFF" }} />
      <button type="button" onClick={analyze} disabled={!source.trim() || busy}
        style={{ ...btnSt(T.teal), marginTop: 8,
          opacity: !source.trim() || busy ? 0.5 : 1 }}>解析する</button>

      {message && (
        <div role={message.ok ? "status" : "alert"}
          style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, fontSize: 12,
            lineHeight: 1.6, color: message.ok ? T.good : T.real,
            background: message.ok ? "rgba(35,139,91,.08)" : "rgba(209,75,50,.08)" }}>
          {message.text}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table style={{ width: "100%", minWidth: 1180, borderCollapse: "collapse",
              fontSize: 11.5, background: "#FFF" }}>
              <thead>
                <tr style={{ color: T.sub, background: "#F1F4F7" }}>
                  {["行番号", "所在地", "種別", "売却基準価額", "入札期間",
                    "開札日", "bit_url", "判定"].map((label) => (
                    <th key={label} style={{ textAlign: "left", padding: "7px 6px",
                      borderBottom: "1px solid " + T.line }}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const price = Number(row.values.min_price);
                  const hasPrice = Number.isFinite(price);
                  const statusLabel = row.errors.length ? "エラー"
                    : row.warnings.length ? "警告" : "OK";
                  const statusColor = row.errors.length ? T.real
                    : row.warnings.length ? T.warnInk : T.good;
                  return (
                    <tr key={row.line} style={{
                      verticalAlign: "top",
                      background: row.errors.length ? "rgba(209,75,50,.04)" : "#FFF",
                    }}>
                      <td style={{ padding: 6, borderBottom: "1px solid " + T.line }}>
                        <label style={{ display: "flex", gap: 5, alignItems: "center" }}>
                          <input type="checkbox" checked={row.selected}
                            disabled={row.errors.length > 0}
                            onChange={() => toggleRow(index)} />
                          {row.line}
                        </label>
                      </td>
                      <td style={{ padding: 6, borderBottom: "1px solid " + T.line,
                        minWidth: 205 }}>
                        <input value={inputValue(row, "case_no")}
                          onChange={(event) => editRow(index, "case_no", event.target.value)}
                          placeholder="事件番号*" style={{ ...inputSt, padding: "5px 6px" }} />
                        <input value={inputValue(row, "court")}
                          onChange={(event) => editRow(index, "court", event.target.value)}
                          placeholder="裁判所" style={{ ...inputSt, padding: "5px 6px", marginTop: 4 }} />
                        <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                          <input value={inputValue(row, "pref")}
                            onChange={(event) => editRow(index, "pref", event.target.value)}
                            placeholder="都道府県" style={{ ...inputSt, padding: "5px 6px" }} />
                          <input value={inputValue(row, "city")}
                            onChange={(event) => editRow(index, "city", event.target.value)}
                            placeholder="市区町村" style={{ ...inputSt, padding: "5px 6px" }} />
                        </div>
                        <input value={inputValue(row, "address")}
                          onChange={(event) => editRow(index, "address", event.target.value)}
                          placeholder="所在地" style={{ ...inputSt, padding: "5px 6px", marginTop: 4 }} />
                      </td>
                      <td style={{ padding: 6, borderBottom: "1px solid " + T.line,
                        minWidth: 110 }}>
                        <select value={row.values.type}
                          onChange={(event) => editRow(index, "type", event.target.value)}
                          style={{ ...inputSt, padding: "5px 6px" }}>
                          {TYPES.filter(Boolean).map((value) => (
                            <option key={value} value={value}>{value}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: 6, borderBottom: "1px solid " + T.line,
                        minWidth: 155 }}>
                        <input value={inputValue(row, "min_price")}
                          onChange={(event) => editRow(index, "min_price", event.target.value)}
                          placeholder="例: 1,289万円"
                          style={{ ...inputSt, padding: "5px 6px" }} />
                        <div style={{ color: T.sub, marginTop: 4, lineHeight: 1.5 }}>
                          {hasPrice
                            ? price.toLocaleString() + "円（" +
                              (price / 10000).toLocaleString() + "万円）"
                            : "金額未入力"}
                        </div>
                      </td>
                      <td style={{ padding: 6, borderBottom: "1px solid " + T.line,
                        minWidth: 135 }}>
                        <input value={inputValue(row, "bid_start")}
                          onChange={(event) => editRow(index, "bid_start", event.target.value)}
                          placeholder="開始日" style={{ ...inputSt, padding: "5px 6px" }} />
                        <input value={inputValue(row, "bid_end")}
                          onChange={(event) => editRow(index, "bid_end", event.target.value)}
                          placeholder="終了日"
                          style={{ ...inputSt, padding: "5px 6px", marginTop: 4 }} />
                      </td>
                      <td style={{ padding: 6, borderBottom: "1px solid " + T.line,
                        minWidth: 115 }}>
                        <input value={inputValue(row, "open_date")}
                          onChange={(event) => editRow(index, "open_date", event.target.value)}
                          placeholder="開札日" style={{ ...inputSt, padding: "5px 6px" }} />
                      </td>
                      <td style={{ padding: 6, borderBottom: "1px solid " + T.line,
                        minWidth: 235 }}>
                        <input value={inputValue(row, "bit_url")}
                          onChange={(event) => editRow(index, "bit_url", event.target.value)}
                          placeholder="https://www.bit.courts.go.jp/..."
                          style={{ ...inputSt, padding: "5px 6px" }} />
                      </td>
                      <td style={{ padding: 6, borderBottom: "1px solid " + T.line,
                        minWidth: 210 }}>
                        <strong style={{ color: statusColor }}>{statusLabel}</strong>
                        {[...row.errors, ...row.warnings].map((reason, reasonIndex) => (
                          <div key={reasonIndex} style={{ color: row.errors.includes(reason)
                            ? T.real : T.warnInk, lineHeight: 1.45, marginTop: 3 }}>
                            {reason}
                          </div>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={submit}
            disabled={!selectedCount || busy}
            style={{ ...btnSt(T.navy), marginTop: 10,
              opacity: !selectedCount || busy ? 0.5 : 1 }}>
            {busy ? "登録中…" : "選択した " + selectedCount + " 件を登録する"}
          </button>
        </>
      )}
    </div>
  );
}
