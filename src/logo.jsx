import React, { useId } from "react";

/* ============================================================
   YOMU ロゴ
   ・ワードマークは Poppins Medium をアウトライン化した図形。
     フォントの読み込みに依存しないので、環境によらず字形が変わらない。
   ・使い分けは3つだけ:
       1. ワードマーク単体（O は金）  … ヘッダー
       2. マーク + ワードマーク（O は藍）… ログイン画面・レポート表紙・空状態
       3. マーク単体                  … ファビコン・アプリアイコン・SNS
     金の丸は常にひとつだけ、が原則。
   ============================================================ */

const GOLD = "#DBA53F";
const LATTICE = "#F7F7F4";
const WM_W = 2923;
const WM_H = 711;
const WM_BASE = 704;

/** ロゴマーク（障子越しの日輪）。size<=20 で格子を省いた小サイズ用に切り替わる */
export function YomuMark({ size = 32, style }) {
  const id = useId();
  const small = size <= 20;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true"
      style={{ display: "block", flexShrink: 0, ...style }}>
      {!small && (
        <defs><clipPath id={id}><circle cx="32" cy="30" r="18" /></clipPath></defs>
      )}
      <circle cx="32" cy="30" r="18" fill={GOLD} />
      {!small && (
        <g clipPath={`url(#${id})`} stroke={LATTICE} strokeWidth="3.2">
          <path d="M32 10v40M12 22h40M12 38h40" />
        </g>
      )}
      <path d="M6 50L32 24 58 50" stroke="currentColor"
        strokeWidth={small ? 6.4 : 5.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** ワードマーク。height は文字の高さ（px）。gold=false で O も currentColor になる */
export function YomuWordmark({ height = 26, gold = true, style }) {
  const w = (WM_W / WM_H) * height;
  return (
    <svg width={w} height={height} viewBox={`0 0 ${WM_W} ${WM_H}`} fill="none"
      role="img" aria-label="YOMU" style={{ display: "block", flexShrink: 0, ...style }}>
      <g transform={`translate(0,${WM_BASE}) scale(1,-1)`}>
      <path fill="currentColor" d="M590 695 360 252V0H246V252L15 695H142L303 354L464 695Z" transform="translate(0,0)" />
      <path fill={gold ? GOLD : "currentColor"} d="M37 349Q37 451 84.5 532.0Q132 613 213.5 658.5Q295 704 392 704Q490 704 571.5 658.5Q653 613 700.0 532.0Q747 451 747 349Q747 247 700.0 165.5Q653 84 571.5 38.5Q490 -7 392 -7Q295 -7 213.5 38.5Q132 84 84.5 165.5Q37 247 37 349ZM630 349Q630 426 599.5 484.0Q569 542 515.0 573.0Q461 604 392 604Q323 604 269.0 573.0Q215 542 184.5 484.0Q154 426 154 349Q154 272 184.5 213.5Q215 155 269.0 123.5Q323 92 392 92Q461 92 515.0 123.5Q569 155 599.5 213.5Q630 272 630 349Z" transform="translate(577,0)" />
      <path fill="currentColor" d="M807 695V0H693V476L481 0H402L189 476V0H75V695H198L442 150L685 695Z" transform="translate(1351,0)" />
      <path fill="currentColor" d="M188 695V252Q188 173 229.5 133.0Q271 93 345 93Q420 93 461.5 133.0Q503 173 503 252V695H617V254Q617 169 580.0 110.0Q543 51 481.0 22.0Q419 -7 344 -7Q269 -7 207.5 22.0Q146 51 110.0 110.0Q74 169 74 254V695Z" transform="translate(2233,0)" />
      </g>
    </svg>
  );
}

/** マーク + ワードマークのロックアップ。O は藍に落として金の丸をひとつに保つ */
export function YomuLock({ size = 40, vertical = false, style }) {
  if (vertical) {
    return (
      <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center",
        gap: Math.round(size * 0.17), lineHeight: 1, ...style }}>
        <YomuMark size={size} />
        <YomuWordmark height={Math.round(size * 0.48)} gold={false} />
      </span>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center",
      gap: Math.round(size * 0.26), lineHeight: 1, ...style }}>
      <YomuMark size={size} />
      <YomuWordmark height={Math.round(size * 0.72)} gold={false} />
    </span>
  );
}
