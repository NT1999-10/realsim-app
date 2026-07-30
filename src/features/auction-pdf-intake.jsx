import React, { useEffect, useRef, useState } from "react";
import { T } from "../theme.js";
import { btnSt } from "../ui.jsx";

const MAX_WIDTH = 1600;
const MAX_IMAGES = 16;
const MAX_IMAGE_BYTES = 1024 * 1024;
const MAX_PAYLOAD_BYTES = Math.floor(3.5 * 1024 * 1024);
let pdfJsPromise = null;

function loadPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = Promise.all([
      import("pdfjs-dist/build/pdf.mjs"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
  }
  return pdfJsPromise;
}

function selectedPages(totalPages, appraisalStart) {
  const pages = new Set();
  for (let page = 1; page <= Math.min(8, totalPages); page += 1) pages.add(page);
  if (appraisalStart !== null) {
    for (let page = appraisalStart; page < appraisalStart + 8 && page <= totalPages; page += 1) {
      pages.add(page);
    }
  }
  return Array.from(pages).slice(0, MAX_IMAGES);
}

function canvasJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("ページ画像の生成に失敗しました"));
    }, "image/jpeg", quality);
  });
}

function rawBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("ページ画像の読み込みに失敗しました"));
    reader.onload = () => {
      const value = String(reader.result || "");
      resolve(value.slice(value.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}

async function renderPages(pdf, pages, quality, signal, setProgress) {
  const images = [];
  for (let index = 0; index < pages.length; index += 1) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    setProgress("PDFを画像に変換しています（" + (index + 1) + "/" + pages.length + "ページ）");
    const page = await pdf.getPage(pages[index]);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(1, MAX_WIDTH / baseViewport.width);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("ページ画像を生成できませんでした");
    await page.render({ canvasContext: context, viewport }).promise;
    const blob = await canvasJpeg(canvas, quality);
    const data = await rawBase64(blob);
    images.push({ data, bytes: blob.size });
    canvas.width = 1;
    canvas.height = 1;
    page.cleanup();
  }
  return images;
}

function payloadBytes(images) {
  return new TextEncoder().encode(JSON.stringify({ images: images.map((image) => image.data) })).byteLength;
}

function fitsLimits(images) {
  return images.every((image) => image.bytes <= MAX_IMAGE_BYTES)
    && payloadBytes(images) <= MAX_PAYLOAD_BYTES;
}

const inputSt = {
  width: "100%", padding: "8px 10px", border: `1px solid ${T.line}`,
  borderRadius: 7, fontSize: 13, color: T.ink, background: "#FBFCFD",
};

export default function AuctionPdfIntake({ request, onExtract }) {
  const [appraisalStart, setAppraisalStart] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => () => abortRef.current && abortRef.current.abort(), []);

  const parsePdf = async () => {
    const file = fileRef.current && fileRef.current.files && fileRef.current.files[0];
    if (!file) {
      setError("3点セットPDFを選択してください");
      return;
    }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("PDFファイルを選択してください");
      return;
    }

    const start = appraisalStart === "" ? null : Number(appraisalStart);
    if (start !== null && (!Number.isInteger(start) || start < 1)) {
      setError("評価書の開始ページは1以上の整数で入力してください");
      return;
    }

    abortRef.current && abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError("");
    setMessage("PDFを読み込んでいます");
    let pdf = null;
    try {
      const pdfjs = await loadPdfJs();
      const data = new Uint8Array(await file.arrayBuffer());
      pdf = await pdfjs.getDocument({ data }).promise;
      if (start !== null && start > pdf.numPages) {
        throw new Error("評価書の開始ページがPDFのページ数を超えています");
      }
      const pages = selectedPages(pdf.numPages, start);
      let rendered = await renderPages(pdf, pages, 0.65, controller.signal, setMessage);
      if (!fitsLimits(rendered)) {
        setMessage("送信サイズを調整しています");
        rendered = await renderPages(pdf, pages, 0.5, controller.signal, setMessage);
      }
      if (!fitsLimits(rendered)) {
        throw new Error("送信サイズが大きすぎます。評価書の開始ページを空欄にするなど、ページ数を減らしてください");
      }

      setMessage("解析中です。30秒ほどかかります");
      const result = await request(rendered.map((image) => image.data), { signal: controller.signal });
      if (!result || !result.ok || !result.data) {
        throw new Error((result && result.error) || "PDFの解析に失敗しました");
      }
      onExtract(result.data);
      setMessage("解析結果を方式Aへ反映しました。原本と照合してから登録してください");
    } catch (caught) {
      if (caught && caught.name === "AbortError") return;
      setMessage("");
      setError(caught && caught.message ? caught.message : "PDFの解析に失敗しました");
    } finally {
      if (pdf) await pdf.destroy().catch(() => {});
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  };

  return (
    <details style={{ marginTop: 14, border: `1px solid ${T.line}`, borderRadius: 9, background: "#FFF" }}>
      <summary style={{ cursor: "pointer", padding: "12px 14px", fontWeight: 700, color: T.ink }}>
        方式D: 3点セットPDFから取り込み(推奨)
      </summary>
      <div style={{ padding: "0 14px 14px" }}>
        <div style={{ padding: "9px 11px", borderRadius: 7, background: "#FFF8E7", color: "#74520B", fontSize: 12, lineHeight: 1.7 }}>
          PDF解析はAIを使用します(管理者のみ・1件あたり十数円程度)。抽出結果は必ず原本と照合してください。
        </div>
        <p style={{ margin: "8px 0", color: "#B42318", fontWeight: 700, fontSize: 12 }}>
          BITの物件URLはPDFから取得できません。解析後、方式Aで必ず手入力してください。
        </p>
        <label style={{ display: "block", marginTop: 10, fontSize: 12, color: T.sub }}>
          3点セットPDF
          <input ref={fileRef} type="file" accept="application/pdf" disabled={busy} style={{ ...inputSt, marginTop: 4 }} />
        </label>
        <label style={{ display: "block", marginTop: 10, fontSize: 12, color: T.sub }}>
          評価書の開始ページ（任意・PDFビューアで確認）
          <input
            type="number"
            min="1"
            step="1"
            value={appraisalStart}
            onChange={(event) => setAppraisalStart(event.target.value)}
            placeholder="例: 13"
            disabled={busy}
            style={{ ...inputSt, marginTop: 4 }}
          />
        </label>
        <p style={{ margin: "8px 0 0", color: T.sub, fontSize: 11.5, lineHeight: 1.6 }}>
          基本1〜8ページと、指定時は評価書の開始ページから8ページをブラウザ内でJPEG化します。PDF原本は送信・保存しません。
        </p>
        <button
          type="button"
          onClick={parsePdf}
          disabled={busy}
          style={{ ...btnSt, marginTop: 10, opacity: busy ? 0.65 : 1 }}
        >
          {busy ? "処理中..." : "PDFを解析して方式Aへ反映"}
        </button>
        {message && <div style={{ marginTop: 9, color: "#087A55", fontSize: 12, fontWeight: 700 }}>{message}</div>}
        {error && <div role="alert" style={{ marginTop: 9, color: "#B42318", fontSize: 12, fontWeight: 700 }}>{error}</div>}
      </div>
    </details>
  );
}
