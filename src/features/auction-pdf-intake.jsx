import React, { useEffect, useRef, useState } from "react";
import { T } from "../theme.js";
import { btnSt } from "../ui.jsx";

const TARGET_WIDTHS = [2000, 1700, 1500, 1300];
const MAX_IMAGES = 12;
const MAX_IMAGE_BYTES = Math.floor(1.5 * 1024 * 1024);
const MAX_PAYLOAD_BYTES = Math.floor(3.5 * 1024 * 1024);
const JPEG_QUALITY = 0.85;
const ENHANCEMENT_LABELS = {
  none: "なし（原本のまま）",
  standard: "標準（白飛ばし）",
  strong: "強（白飛ばし＋ガンマ1.4で文字を濃く）",
};
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
  for (let page = 1; page <= Math.min(6, totalPages); page += 1) pages.add(page);
  if (appraisalStart !== null) {
    for (let page = appraisalStart; page < appraisalStart + 6 && page <= totalPages; page += 1) {
      pages.add(page);
    }
  }
  return Array.from(pages).slice(0, MAX_IMAGES);
}

function canvasJpeg(canvas) {
  const src = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  const data = src.slice(src.indexOf(",") + 1);
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return { src, data, bytes: Math.floor(data.length * 3 / 4) - padding };
}

export function enhancePixels(source, mode) {
  if (mode === "none") {
    return { pixels: source, appliedMode: "none", fellBack: false };
  }

  const pixelCount = source.length / 4;
  const histogram = new Uint32Array(256);
  let beforeDark = 0;
  for (let index = 0; index < source.length; index += 4) {
    const gray = Math.round(0.299 * source[index] + 0.587 * source[index + 1] + 0.114 * source[index + 2]);
    histogram[gray] += 1;
    if (gray < 100) beforeDark += 1;
  }

  const percentileTarget = Math.ceil(pixelCount * 0.9);
  let cumulative = 0;
  let white = 255;
  for (let value = 0; value < histogram.length; value += 1) {
    cumulative += histogram[value];
    if (cumulative >= percentileTarget) {
      white = Math.max(160, value);
      break;
    }
  }

  const corrected = new Uint8ClampedArray(source);
  let afterDark = 0;
  for (let index = 0; index < corrected.length; index += 4) {
    const gray = 0.299 * source[index] + 0.587 * source[index + 1] + 0.114 * source[index + 2];
    let value = Math.min(255, Math.max(0, gray * 255 / white));
    if (mode === "strong") value = 255 * Math.pow(value / 255, 1.4);
    value = Math.round(Math.min(255, Math.max(0, value)));
    corrected[index] = value;
    corrected[index + 1] = value;
    corrected[index + 2] = value;
    if (value < 100) afterDark += 1;
  }

  if (beforeDark > 0 && afterDark < beforeDark * 0.5) {
    return { pixels: source, appliedMode: "none", fellBack: true, beforeDark, afterDark, white };
  }
  return { pixels: corrected, appliedMode: mode, fellBack: false, beforeDark, afterDark, white };
}

function enhanceCanvas(context, width, height, mode) {
  if (mode === "none") return { appliedMode: "none", fellBack: false };
  const original = context.getImageData(0, 0, width, height);
  const result = enhancePixels(original.data, mode);
  if (!result.fellBack) {
    context.putImageData(new ImageData(result.pixels, width, height), 0, 0);
  }
  return result;
}

async function renderPages(pdf, pages, targetWidth, mode, signal, setProgress) {
  const images = [];
  for (let index = 0; index < pages.length; index += 1) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    setProgress("PDFを画像に変換しています（" + (index + 1) + "/" + pages.length + "ページ）");
    const page = await pdf.getPage(pages[index]);
    let canvas = null;
    try {
      const baseViewport = page.getViewport({ scale: 1 });
      // A4 PDFはscale 1で約595px。1以下に丸めず、2000pxまで確実に拡大する。
      const scale = Math.min(6, targetWidth / Math.max(1, baseViewport.width));
      const viewport = page.getViewport({ scale });
      canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("ページ画像を生成できませんでした");
      context.fillStyle = "#FFFFFF";
      context.fillRect(0, 0, canvas.width, canvas.height);
      const renderTask = page.render({ canvasContext: context, viewport });
      await renderTask.promise;
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const enhancement = enhanceCanvas(context, canvas.width, canvas.height, mode);
      console.log(
        `[auction-pdf] page ${pages[index]} canvas ${canvas.width}x${canvas.height}px`,
      );
      const encoded = canvasJpeg(canvas);
      images.push({
        ...encoded,
        page: pages[index],
        width: canvas.width,
        height: canvas.height,
        mode: enhancement.appliedMode,
        fellBack: enhancement.fellBack,
      });
    } finally {
      if (canvas) {
        canvas.width = 1;
        canvas.height = 1;
      }
      page.cleanup();
    }
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
  const [enhancement, setEnhancement] = useState("standard");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [prepared, setPrepared] = useState(null);
  const fileRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => () => abortRef.current && abortRef.current.abort(), []);

  const resetPrepared = () => {
    setPrepared(null);
    setMessage("");
    setError("");
  };

  const preparePdf = async (modeOverride, preferredWidth) => {
    const mode = typeof modeOverride === "string" ? modeOverride : enhancement;
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
    setPrepared(null);
    setMessage("PDFを読み込んでいます");
    let pdf = null;
    let rendered = [];
    try {
      const pdfjs = await loadPdfJs();
      const data = new Uint8Array(await file.arrayBuffer());
      pdf = await pdfjs.getDocument({ data }).promise;
      if (start !== null && start > pdf.numPages) {
        throw new Error("評価書の開始ページがPDFのページ数を超えています");
      }
      const pages = selectedPages(pdf.numPages, start);
      console.log("[auction-pdf] rendered pages:", pages);
      const widths = Number.isFinite(preferredWidth)
        ? [preferredWidth, ...TARGET_WIDTHS.filter((width) => width < preferredWidth)]
        : TARGET_WIDTHS;
      for (const width of widths) {
        rendered.length = 0;
        rendered = await renderPages(pdf, pages, width, mode, controller.signal, setMessage);
        if (fitsLimits(rendered)) {
          const bytes = payloadBytes(rendered);
          setPrepared({
            images: rendered.map((image) => image.data),
            pages: rendered,
            pageCount: rendered.length,
            width,
            bytes,
            requestedMode: mode,
          });
          setMessage("画像を確認してからAI解析を実行してください");
          rendered = [];
          return;
        }
        if (width !== widths[widths.length - 1]) {
          setMessage("送信サイズを調整しています");
        }
      }
      throw new Error("ページ数を減らしてください");
    } catch (caught) {
      if (caught && caught.name === "AbortError") return;
      setMessage("");
      setError(caught && caught.message ? caught.message : "PDFの解析に失敗しました");
    } finally {
      rendered.length = 0;
      if (pdf) await pdf.destroy().catch(() => {});
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  };

  const parsePrepared = async () => {
    if (!prepared || !prepared.images.length) {
      setError("先にPDFを画像化して画質を確認してください");
      return;
    }
    abortRef.current && abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError("");
    setMessage("解析中です。30秒ほどかかります");
    try {
      const result = await request(prepared.images, { signal: controller.signal });
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
          <input ref={fileRef} type="file" accept="application/pdf" disabled={busy}
            onChange={resetPrepared} style={{ ...inputSt, marginTop: 4 }} />
        </label>
        <label style={{ display: "block", marginTop: 10, fontSize: 12, color: T.sub }}>
          評価書の開始ページ（任意・PDFビューアで確認）
          <input
            type="number"
            min="1"
            step="1"
            value={appraisalStart}
            onChange={(event) => { setAppraisalStart(event.target.value); resetPrepared(); }}
            placeholder="例: 13"
            disabled={busy}
            style={{ ...inputSt, marginTop: 4 }}
          />
        </label>
        <p style={{ margin: "8px 0 0", color: T.sub, fontSize: 11.5, lineHeight: 1.6 }}>
          基本1〜6ページと、指定時は評価書の開始ページから6ページをブラウザ内で高精細JPEG化します。PDF原本は送信・保存しません。
        </p>
        <label style={{ display: "block", marginTop: 10, fontSize: 12, color: T.sub }}>
          画質補正
          <select
            value={enhancement}
            disabled={busy}
            onChange={(event) => {
              const nextMode = event.target.value;
              setEnhancement(nextMode);
              if (fileRef.current?.files?.[0]) void preparePdf(nextMode, prepared?.width);
              else resetPrepared();
            }}
            style={{ ...inputSt, marginTop: 4 }}
          >
            <option value="none">なし（原本のまま）</option>
            <option value="standard">標準（白飛ばし）</option>
            <option value="strong">強（白飛ばし＋ガンマ1.4で文字を濃く）</option>
          </select>
        </label>
        <button
          type="button"
          onClick={preparePdf}
          disabled={busy}
          style={{ ...btnSt(T.teal), marginTop: 10, opacity: busy ? 0.65 : 1 }}
        >
          {busy ? "処理中..." : prepared ? "画像を作り直す" : "PDFを画像化して確認"}
        </button>
        {prepared && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8 }}>
              {prepared.pages.map((image) => (
                <div key={image.page} style={{ flex: "0 0 480px", maxWidth: "88vw" }}>
                  <a href={image.src} target="_blank" rel="noreferrer" title="クリックして原寸表示">
                    <img
                      src={image.src}
                      alt={`AIへ送信する${image.page}ページ目のプレビュー`}
                      style={{ display: "block", width: "100%", maxWidth: 480, border: `1px solid ${T.line}`, borderRadius: 5 }}
                    />
                  </a>
                  <div style={{ marginTop: 5, color: T.sub, fontSize: 11, lineHeight: 1.5 }}>
                    {image.width}px × {image.height}px / {Math.round(image.bytes / 1024)}KB / 補正: {image.fellBack ? "なし（自動フォールバック）" : ENHANCEMENT_LABELS[image.mode]}
                    <br />クリックで原寸表示
                  </div>
                </div>
              ))}
            </div>
            <p style={{ margin: "7px 0", color: T.ink, fontSize: 11.5, lineHeight: 1.6 }}>
              この画質でAIに送信します。文字が読めない場合は解析に失敗します
              （{prepared.width}px・{prepared.pageCount}枚・{(prepared.bytes / 1024 / 1024).toFixed(2)}MB）
            </p>
            <button type="button" onClick={parsePrepared} disabled={busy}
              style={{ ...btnSt(T.teal), opacity: busy ? 0.65 : 1 }}>
              {busy ? "解析中..." : "この画質でAI解析して方式Aへ反映"}
            </button>
          </div>
        )}
        {message && <div style={{ marginTop: 9, color: "#087A55", fontSize: 12, fontWeight: 700 }}>{message}</div>}
        {error && <div role="alert" style={{ marginTop: 9, color: "#B42318", fontSize: 12, fontWeight: 700 }}>{error}</div>}
      </div>
    </details>
  );
}

