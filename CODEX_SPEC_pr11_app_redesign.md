# 指示書: アプリ本体のデザインをYOMUの新LPに統一する (PR#11)

対象リポジトリ: `realsim-app`。新規ブランチ `agent/pr11-design-system` を切って作業すること。

## 0. 前提と目的

`realsim-lp` 側のLPデザインを刷新した。アプリ本体（React + Vite）の見た目が旧デザインのままで、**LPからサインアップして入った瞬間に別サービスに見える**状態になっている。アプリ側をLPのデザイン言語に合わせるのがこのタスクのゴール。

**この指示書は単体で完結している。** 必要なデザイントークン・コンポーネント仕様・アイコンのSVGソースはすべて本書に記載してあるので、他リポジトリ（`realsim-lp`）を参照する必要はない。本書に書かれていない色・寸法・パターンを独自に発明しないこと。

### やらないこと（スコープ外）

- **計算エンジン（35年月次シミュレーション）のロジックには一切触れない。** 数値・関数・テストの期待値を変更する変更は却下する
- Supabase のスキーマ、RLS、認証フロー、Stripe連携の変更
- 機能の追加・削除・画面の統廃合。**今回は見た目だけ**
- ライブラリの新規導入（Tailwind、MUI、shadcn等への移行は不可。既存のスタイリング方式のまま置き換える）

---

## 1. デザイントークンを単一の定義に集約する

まず `src/theme/` 配下（既存のtheme/ui分離を利用する。無ければ `src/styles/tokens.css` を新設）に、以下を**唯一の正**として定義する。以後、コンポーネント内のハードコードされた色・角丸・影はすべてこのトークン参照に置き換えること。

```css
:root{
  /* 藍 — ブランドの主色。数値・見出し・主要CTA */
  --ink:#1E3E6B; --ink-2:#2f5488; --ink-3:#4a74ab; --ink-deep:#12233f; --ink-night:#0B1526;
  /* 山吹 — ラベル・アクセント。CTAの副系統 */
  --gold:#B8821F; --gold-2:#DBA53F; --gold-soft:#FBF3E2;
  /* 朱 — 危険・警告・注目。使用箇所を絞る（後述 §4） */
  --red:#C0392B; --red-2:#E05A46; --red-soft:#FDECEA;
  /* 緑 — 良好・達成 */
  --ok:#12795A; --ok-soft:#E6F4EF;
  /* 面 */
  --paper:#F7F7F4; --surface:#ffffff; --surface-2:#FBFBF9;
  /* 文字 */
  --text:#14202F; --muted:#41526A; --faint:#6B7B91;
  /* 罫線 */
  --line:#E4E4DE; --line-2:#D2D6DC;
  /* 書体 */
  --serif:"Noto Serif JP",serif;
  --sans:"Zen Kaku Gothic New","Hiragino Sans","Yu Gothic",sans-serif;
  --mono:"JetBrains Mono",ui-monospace,Menlo,monospace;
  /* 角丸 */
  --r:16px; --r-s:10px; --r-xs:8px; --pill:999px;
  /* 影（3段階だけ。これ以外の影を新規に作らない） */
  --sh1:0 1px 2px rgba(18,35,63,.05), 0 6px 18px -10px rgba(18,35,63,.22);
  --sh2:0 2px 4px rgba(18,35,63,.05), 0 18px 40px -20px rgba(18,35,63,.35);
  --sh3:0 30px 70px -30px rgba(18,35,63,.45);
}
```

フォントは `index.html` の `<head>` で Google Fonts を1リクエストにまとめて読み込む:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@600;700&family=Zen+Kaku+Gothic+New:wght@400;500;700;900&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
```

**書体の使い分けは厳格に守ること。**

| 用途 | 書体 | 備考 |
|---|---|---|
| ページ見出し・セクション見出し | Noto Serif JP 700 | 和の表情はここだけで出す |
| 本文・ラベル・ボタン・カード見出し | Zen Kaku Gothic New 500 / 700 | 既定の `font-weight` は **500**。400は使わない |
| **すべての数値・単位・英字ラベル** | JetBrains Mono + `font-variant-numeric: tabular-nums` | 金額・利回り・DSCR・年月・IRR。桁が揃うことが信頼感の源 |

`body` の既定は `font-size:16px; font-weight:500; line-height:1.78; color:var(--text); background:var(--paper);`

---

## 2. コンポーネントの作り替え

旧デザインの「1px罫線で全部を仕切る帳簿レイアウト」をやめる。**面を分けるのは罫線ではなくカードと余白**に統一する。

### 2.1 カード（最重要）

```
background: var(--surface);
border: 1px solid var(--line);
border-radius: var(--r);      /* 16px */
box-shadow: var(--sh1);
padding: 22px;
```

- グリッドは `display:grid; gap:14px`。**隣接セルで罫線を共有しない**（旧: `border-right:1px` の連鎖 → 廃止）
- クリック可能なカードのみ `:hover { transform: translateY(-4px); box-shadow: var(--sh2); }`、遷移は `.22s cubic-bezier(.2,.8,.3,1)`
- 静的な表示カードにホバー効果を付けない（触れるものと触れないものを見た目で区別する）

### 2.2 ボタン

| 種別 | 指定 |
|---|---|
| Primary | `background: linear-gradient(180deg,#2a548c,#1E3E6B); color:#fff; box-shadow:var(--sh1)` |
| Gold（課金・変換系） | `background: linear-gradient(180deg,#D09A2E,#B8821F); color:#fff` |
| Outline | `background:var(--surface); border:1px solid var(--line-2); color:var(--ink)` |
| Danger | `background:var(--red); color:#fff` — 削除・解約など不可逆な操作のみ |

共通: `border-radius:var(--r-s); padding:11px 20px; font-weight:700; font-size:14.5px`。ホバーで `translateY(-2px)` + `--sh2`。**フラットな1px枠のボタンは全廃**。

### 2.3 入力フォーム

物件パラメータの入力欄は、数値入力であることが一目で分かる作りにする。

```
外枠: background:var(--surface); border:1.5px solid var(--line-2); border-radius:var(--r-s); padding:0 14px
入力: font-family:var(--mono); font-size:19px; font-weight:700; text-align:right; border:0; outline:0
単位: 入力欄の内側右端に "万円" "円" "%" をグレーで固定表示（プレースホルダではなく常時表示）
フォーカス: border-color:var(--ink-3); box-shadow:0 0 0 4px rgba(74,116,171,.14)
ラベル: 左に日本語ラベル（700）、右にモノスペースの英字キー（PRICE / RENT / EQUITY 等）
```

30以上のパラメータを持つ詳細モードでは、**関連するパラメータをカードで束ね、カード単位に見出しとアイコンを付ける**（例: 「借入条件」「稼働と退去」「維持と設備」「税と売却」）。1画面にフラットな入力欄が並ぶ現状をやめる。

### 2.4 テーブル（物件比較・35年収支表）

- 外側を `.card` で包み `overflow:hidden`、テーブル自体の外枠線は消す
- `thead` は塗り（`var(--ink-deep)`、文字 `#fff`、`font-size:12.5px`）。行の罫線は `1px solid var(--line)` のみ、縦罫線は引かない
- 行ホバー `background:#FAFBFD`
- **数値セルは必ず mono + `tabular-nums` + 右寄せ**
- 良し悪しのある列は、テキストに色を付けるのではなく **アイコンバッジ**で示す（✓ = 緑丸、✕ = 朱丸、19px、`border-radius:50%`、白抜きアイコン）

### 2.5 信号機診断コンポーネント

LPの `.signal` をそのまま移植する。判定に応じて**カードの背景ごと**変える:

| 判定 | 背景 | 枠線 | ランプ |
|---|---|---|---|
| 青 | `var(--ok-soft)` | `#B6E0D0` | `var(--ok)` + `box-shadow:0 0 0 4px rgba(18,121,90,.18)` |
| 黄 | `#FDF5E3` | `#EBD5A4` | `#DFA82C` |
| 赤 | `var(--red-soft)` | `#F3C3BC` | `var(--red)` |

判定タイトルは17px/700、理由文は13.5px/500。ランプは14px円を縦3つ、非点灯は `rgba(20,32,47,.13)`。

### 2.6 グラフ

Rechartsなど既存のライブラリはそのまま使ってよいが、色とスタイルを揃える。

- 実線（YOMUの現実前提）= `var(--ink)`、太さ2.8、`stroke-linecap:round`
- 破線（楽観・業者提案）= `var(--gold-2)`、太さ2.4、`stroke-dasharray:"5 4"`
- 面グラデーション = `var(--ink)` を opacity .20 → 0
- グリッド線 `#EDEDE7`、基準線 `#D2D6DC`、軸ラベルは mono 9〜10px `var(--faint)`
- 危険域・赤字域を示すときだけ `var(--red)`
- **凡例は上に載せず、線の終点近くに直接ラベルを置く**（LPのヒーローグラフを参照）

---

## 3. アイコンとイラスト

**付録A** のSVGスプライトを `src/assets/yomu-sprite.svg` として新規作成し、その中身をアプリのルートに1度だけマウントするコンポーネント（`src/components/IconSprite.tsx` 等）を作る。各所からは `<svg class="ico"><use href="#i-yield"/></svg>` で参照する。**アイコンを画像ファイルやアイコンライブラリ（lucide、heroicons等）で別途調達しない。**

```css
.ico{ width:22px; height:22px; stroke:currentColor; fill:none;
      stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
.ico-box{ width:46px; height:46px; border-radius:13px; display:flex;
          align-items:center; justify-content:center; flex:0 0 auto;
          background:linear-gradient(150deg,#EAF0F9,#DCE6F4); color:var(--ink);
          box-shadow:inset 0 1px 0 #fff; }
.ico-box.gold{ background:linear-gradient(150deg,#FBF1DC,#F4E3BF); color:#93671A; }
.ico-box.red { background:linear-gradient(150deg,#FDECEA,#FAD9D4); color:var(--red); }
```

収録シンボル: `i-yield` `i-occupancy` `i-mortgage` `i-upkeep` `i-compare` `i-ai` `i-signal` `i-stress` `i-metrics` `i-manage` `i-auction` `i-pdf` `i-sync` `i-doc` `i-arrow` `i-plus` `i-check` `i-x` `i-alert` `i-shield` `i-users` / イラスト `il-woman` `il-rookie`

**アイコンの割り当ては意味で固定する**（LPと同じ対応表を守ること）:

| 概念 | シンボル | タイル色 |
|---|---|---|
| 利回り・収益 | `i-yield` | 標準（藍） |
| 稼働・空室・物件 | `i-occupancy` | 標準 |
| 返済・借入・金融機関 | `i-mortgage` | **red** |
| 維持・設備・修繕 | `i-upkeep` | **gold** |
| AI市場調査 | `i-ai` | gold |
| 信号機診断 | `i-signal` | red |
| 感度分析・ストレス | `i-stress` | 標準 |
| 指標・比較 | `i-metrics` | 標準 |
| 運用管理・カレンダー | `i-manage` | 標準 |
| 競売 | `i-auction` | gold |
| PDF出力 | `i-pdf` | 標準 |
| 警告 | `i-alert` | red |

**人物イラストの使いどころ**（濫用しないこと。1画面に1体まで）:

- 初回オンボーディング / チュートリアルの各ステップ — `il-woman` を吹き出しと組み合わせる
- 空状態（物件0件、調査履歴なし、比較対象なし）— `il-rookie` + 次の行動を促す1文 + CTAボタン。**「データがありません」だけの空画面を全廃する**
- 診断結果の解説パネル — `il-woman` の丸アイコン（80px）+ 吹き出しで、判定理由を一言で述べる

吹き出しのスタイル:
```
background:linear-gradient(120deg,#FEF5F3,#fff 60%); border:1px solid #F3CFC9;
border-radius:14px; padding:13px 17px; box-shadow:var(--sh1);
/* 左向きの三角は ::before を 14px 正方形 45度回転で作る（LPの .bubble を参照） */
```

---

## 4. 朱色（`--red`）の使用ルール

朱は**注目を集めるための予算**として扱う。使いすぎると効かなくなる。

**使ってよい:**
- 赤信号判定、DSCR 1.0未満、月次CFがマイナスの数値
- 予測と実績の乖離、ストレステストで赤字転落する条件
- 削除・解約など不可逆な操作のボタン
- 画面内で最も注目させたい数値、1画面につき**最大2〜3箇所**

**使ってはいけない:**
- 通常のリンク、通常のラベル、装飾目的の下線や枠
- 複数の数値に一律で適用すること（どれが本当に危険なのか分からなくなる）

良好な状態は `--ok`、中立は `--ink`、補助ラベルは `--gold`。

---

## 5. レイアウトと余白

- コンテンツ最大幅 1180px、左右パディング 24px（モバイル 18px）
- セクション間の縦余白 58px（モバイル 44px）、カード間 14px
- **1画面あたりの情報密度を上げる。** 余白を空けるより、意味のある数値・ラベルを置く
- サイドバー/ヘッダーは `background:rgba(247,247,244,.86); backdrop-filter:saturate(180%) blur(14px); border-bottom:1px solid rgba(0,0,0,.06)`
- 画面の主要な数値（月次CF、DSCR、IRR、実質利回り）は、LPの `.kv` に相当する**KPIタイル**として画面上部に常に見える形で置く

---

## 6. 作業の進め方（PR分割）

1つの巨大PRにしない。以下の順で分割し、各PRごとにスクリーンショットを添えること。

| PR | 内容 | 完了の目安 |
|---|---|---|
| PR-A | トークン定義＋フォント読み込み＋付録Aのスプライト設置とマウント。既存画面は触らない | 既存画面が壊れていないこと |
| PR-B | 共通UI（Button / Card / Input / Table / Badge / Modal）をトークンベースに置換 | ハードコードされた色・角丸・影がUIコンポーネントから消えていること |
| PR-C | ダッシュボードと物件詳細（KPIタイル、グラフ配色、信号機コンポーネント） | LPのヒーローと並べて同じ製品に見えること |
| PR-D | 入力フォーム（かんたんモード / 詳細モード）のカード化・単位表示・mono数値 | 30以上のパラメータがカテゴリ別カードに束ねられていること |
| PR-E | 空状態・オンボーディング・診断結果へのイラスト適用 | 「データがありません」だけの画面が0になっていること |

---

## 7. 完了条件（このすべてを満たすこと）

- [ ] アプリ内に、トークンを経由しない色・角丸・影のハードコードが**残っていない**（`#[0-9a-fA-F]{6}` でgrepして、トークン定義ファイル以外にヒットしないこと。グラフのデータ色など不可避なものはコメントで理由を明記）
- [ ] すべての金額・率・年数が mono + `tabular-nums` で表示され、桁が縦に揃っている
- [ ] 本文の既定 `font-weight` が 500 になっており、薄すぎて読めない箇所がない
- [ ] 見出しは Noto Serif JP、本文は Zen Kaku Gothic New で描画されている（フォント読み込み失敗時のフォールバックも確認）
- [ ] 罫線だけで区切られたグリッドが残っていない（カード＋gapに置換済み）
- [ ] 朱色の使用箇所が1画面あたり3箇所以内に収まっている
- [ ] 空状態の画面すべてにイラストと次の行動のCTAがある
- [ ] 幅 390px / 768px / 1440px で表示崩れと横スクロールが発生しない
- [ ] 本文と背景のコントラスト比が 4.5:1 以上（`--faint` を本文に使わない。ラベル・注釈のみ）
- [ ] 既存のユニットテストが全て通り、**計算結果の数値が変更前と1円も変わっていない**
- [ ] LPとアプリのスクリーンショットを並べて添付し、同一プロダクトに見えることを目視確認

## 8. 判断に迷ったとき

本書に指定がある場合は、**必ずその値をそのまま使う**。近い値に丸めたり、独自解釈で新しいパターンを作ったりしない。本書に存在しないパターンが必要になった場合は、実装を進める前に「何が足りないか」と「どうしたいか」を報告し、指示を待つこと。

指示書の記述とリポジトリの実態（ディレクトリ構成、既存のスタイリング方式、theme/ui分離の実装）が食い違っていた場合も、勝手に読み替えずに報告すること。

---

## 付録A. SVGスプライト

以下をそのまま `src/assets/yomu-sprite.svg` として保存する。アイコン21種と人物イラスト2種を含む。**内容を改変しないこと。**

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
<defs>
  <!-- ===== line icons (24x24, inherit stroke via currentColor) ===== -->
  <symbol id="i-yield" viewBox="0 0 24 24"><polyline points="3 17 9 11 13 15 21 6"/><polyline points="15 6 21 6 21 12"/></symbol>
  <symbol id="i-occupancy" viewBox="0 0 24 24"><path d="M4 21V7l8-4 8 4v14"/><path d="M9 11h2M13 11h2M9 15h2M13 15h2"/><path d="M10 21v-3h4v3"/><path d="M2 21h20"/></symbol>
  <symbol id="i-mortgage" viewBox="0 0 24 24"><path d="M3 10l9-6 9 6"/><path d="M6 10v8M10.5 10v8M15 10v8M19.5 10v8"/><path d="M2.5 21h19"/></symbol>
  <symbol id="i-upkeep" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M12 3.2v2.4M12 18.4v2.4M3.2 12h2.4M18.4 12h2.4M5.9 5.9l1.7 1.7M16.4 16.4l1.7 1.7M18.1 5.9l-1.7 1.7M7.6 16.4l-1.7 1.7"/></symbol>
  <symbol id="i-compare" viewBox="0 0 24 24"><path d="M3 20L20 5" stroke-dasharray="3.5 3"/><path d="M3 20c6 0 10-3 17-6"/><path d="M20 5v9"/><circle cx="20" cy="5" r="1.6"/><circle cx="20" cy="14" r="1.6"/></symbol>
  <symbol id="i-ai" viewBox="0 0 24 24"><path d="M12 3l1.7 4.6L18 9.2l-4.3 1.6L12 15.4l-1.7-4.6L6 9.2l4.3-1.6z"/><path d="M18.5 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/><path d="M5 16l.6 1.5 1.5.6-1.5.6L5 20.2l-.6-1.5L2.9 18l1.5-.6z"/></symbol>
  <symbol id="i-signal" viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="4.5"/><circle cx="12" cy="7.5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="16.5" r="1.6"/></symbol>
  <symbol id="i-stress" viewBox="0 0 24 24"><path d="M3 7h18M3 12h18M3 17h18"/><circle cx="9" cy="7" r="2.2"/><circle cx="15" cy="12" r="2.2"/><circle cx="7" cy="17" r="2.2"/></symbol>
  <symbol id="i-metrics" viewBox="0 0 24 24"><path d="M3 21h18"/><rect x="4" y="12" width="3.6" height="6" rx="1"/><rect x="10.2" y="7" width="3.6" height="11" rx="1"/><rect x="16.4" y="3.5" width="3.6" height="14.5" rx="1"/></symbol>
  <symbol id="i-manage" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/><polyline points="9 15 11 17 15 13"/></symbol>
  <symbol id="i-auction" viewBox="0 0 24 24"><path d="M13.5 3.2l5.3 5.3-2.6 2.6-5.3-5.3z"/><path d="M10.4 7.4L3.6 14.2a2 2 0 0 0 0 2.8l1.4 1.4a2 2 0 0 0 2.8 0l6.8-6.8"/><path d="M13 21h8"/></symbol>
  <symbol id="i-pdf" viewBox="0 0 24 24"><path d="M6 3h8l5 5v13H6z"/><polyline points="14 3 14 8 19 8"/><path d="M9 13h6M9 17h4"/></symbol>
  <symbol id="i-sync" viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 13.6-5.7L20 8"/><polyline points="20 3.5 20 8 15.5 8"/><path d="M20 12a8 8 0 0 1-13.6 5.7L4 16"/><polyline points="4 20.5 4 16 8.5 16"/></symbol>
  <symbol id="i-doc" viewBox="0 0 24 24"><path d="M5 3h9l5 5v13H5z"/><polyline points="14 3 14 8 19 8"/><path d="M8.5 13.5h7M8.5 17h5"/></symbol>
  <symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h14"/><polyline points="13 6 19 12 13 18"/></symbol>
  <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
  <symbol id="i-check" viewBox="0 0 24 24"><polyline points="4 12.5 9.5 18 20 6.5"/></symbol>
  <symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></symbol>
  <symbol id="i-alert" viewBox="0 0 24 24"><path d="M12 3.5L22 20H2z"/><path d="M12 10v4.5M12 17.2v.1"/></symbol>
  <symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8.2-8 9.5C7.5 20.2 4 17 4 12V6z"/><polyline points="9 12 11 14 15 10"/></symbol>
  <symbol id="i-users" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.4"/><path d="M3 20c0-3.4 2.7-5.6 6-5.6s6 2.2 6 5.6"/><path d="M16 5.2a3.4 3.4 0 0 1 0 6.6M17.5 14.8c2.2.7 3.5 2.6 3.5 5.2"/></symbol>

  <!-- ===== illustration: 女性アドバイザー ===== -->
  <symbol id="il-woman" viewBox="0 0 200 210">
    <path d="M100 28C62 28 54 58 56 88c1.4 21-3 46-8 66l26-4c-4-27-4-52 0-64 8-21 44-21 52 0 4 12 4 37 0 64l26 4c-5-20-9.4-45-8-66 2-30-6-60-44-60z" fill="#2A3040"/>
    <rect x="88" y="102" width="24" height="46" rx="11" fill="#E8BE9F"/>
    <path d="M100 146c-29 0-55 19-59 64h118c-4-45-30-64-59-64z" fill="#1E3E6B"/>
    <path d="M82 150l18-8v68l-24 0z" fill="#2F5488"/>
    <path d="M118 150l-18-8v68l24 0z" fill="#2F5488"/>
    <path d="M100 142l-19 8 19 44 19-44z" fill="#FFFFFF"/>
    <circle cx="84" cy="180" r="3.8" fill="#DBA53F"/>
    <ellipse cx="60" cy="86" rx="6.5" ry="8.5" fill="#F6D8C0"/><ellipse cx="140" cy="86" rx="6.5" ry="8.5" fill="#F6D8C0"/>
    <ellipse cx="100" cy="80" rx="40" ry="44" fill="#F6D8C0"/>
    <path d="M100 32c-26 0-38 21-38 46 12-11 22-17 38-17s28 8 38 17c0-25-12-46-38-46z" fill="#2A3040"/>
    <ellipse cx="73" cy="97" rx="8" ry="4.6" fill="#F0A392" opacity=".5"/><ellipse cx="127" cy="97" rx="8" ry="4.6" fill="#F0A392" opacity=".5"/>
    <ellipse cx="85" cy="86" rx="4.6" ry="6" fill="#23293A"/><ellipse cx="115" cy="86" rx="4.6" ry="6" fill="#23293A"/>
    <circle cx="86.7" cy="83.4" r="1.7" fill="#fff"/><circle cx="116.7" cy="83.4" r="1.7" fill="#fff"/>
    <path d="M77 72q8-4.5 16-1M123 72q-8-4.5-16-1" stroke="#2A3040" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <path d="M93 101q7 6 14 0" stroke="#B4574B" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <path d="M148 168c6 18-6 32-26 32" stroke="#1E3E6B" stroke-width="20" fill="none" stroke-linecap="round"/>
    <g transform="rotate(-7 143 180)">
      <rect x="112" y="156" width="64" height="46" rx="7" fill="#fff" stroke="#12233F" stroke-width="2.6"/>
      <rect x="120" y="182" width="9" height="12" rx="2.5" fill="#2F5488"/><rect x="133" y="174" width="9" height="20" rx="2.5" fill="#2F5488"/>
      <rect x="146" y="166" width="9" height="28" rx="2.5" fill="#DBA53F"/><rect x="159" y="178" width="9" height="16" rx="2.5" fill="#C0392B"/>
    </g>
    <ellipse cx="118" cy="197" rx="10.5" ry="8" fill="#F6D8C0"/>
  </symbol>

  <!-- ===== illustration: はじめての人 ===== -->
  <symbol id="il-rookie" viewBox="0 0 200 210">
    <rect x="88" y="104" width="24" height="46" rx="11" fill="#E8BE9F"/>
    <path d="M100 148c-29 0-55 19-59 62h118c-4-43-30-62-59-62z" fill="#7FA5CE"/>
    <path d="M82 152l18-8v66l-24 0z" fill="#5D8AB8"/>
    <path d="M118 152l-18-8v66l24 0z" fill="#5D8AB8"/>
    <path d="M100 144l-18 8 18 40 18-40z" fill="#F4F7FB"/>
    <ellipse cx="60" cy="88" rx="6.5" ry="8.5" fill="#F6D8C0"/><ellipse cx="140" cy="88" rx="6.5" ry="8.5" fill="#F6D8C0"/>
    <ellipse cx="100" cy="82" rx="40" ry="43" fill="#F6D8C0"/>
    <path d="M58 90A42 52 0 0 1 142 90C136 73 122 64 100 64S64 73 58 90Z" fill="#3A3226"/>
    <ellipse cx="73" cy="99" rx="8" ry="4.6" fill="#F0A392" opacity=".45"/><ellipse cx="127" cy="99" rx="8" ry="4.6" fill="#F0A392" opacity=".45"/>
    <ellipse cx="85" cy="88" rx="4.4" ry="5.8" fill="#23293A"/><ellipse cx="115" cy="88" rx="4.4" ry="5.8" fill="#23293A"/>
    <circle cx="86.6" cy="85.5" r="1.6" fill="#fff"/><circle cx="116.6" cy="85.5" r="1.6" fill="#fff"/>
    <path d="M78 75q7-4 14-1M122 75q-7-4-14-1" stroke="#3A3226" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <path d="M92 102q8 7 16 0" stroke="#B4574B" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <path d="M54 170c-7 16 3 30 22 32" stroke="#7FA5CE" stroke-width="19" fill="none" stroke-linecap="round"/>
    <g transform="rotate(9 72 184)">
      <rect x="52" y="160" width="36" height="54" rx="8" fill="#fff" stroke="#12233F" stroke-width="2.6"/>
      <rect x="60" y="168" width="20" height="4" rx="2" fill="#C7D3E2"/>
      <circle cx="64" cy="185" r="4.2" fill="#C0392B"/><circle cx="64" cy="197" r="4.2" fill="#12795A"/>
      <rect x="72" y="181" width="10" height="3.4" rx="1.7" fill="#C7D3E2"/><rect x="72" y="193" width="10" height="3.4" rx="1.7" fill="#C7D3E2"/>
    </g>
    <ellipse cx="80" cy="199" rx="10.5" ry="8" fill="#F6D8C0"/>
  </symbol>
</defs>
</svg>
```

### 人物イラストの色を変える場合

`il-woman`（スーツの女性・アドバイザー役）と `il-rookie`（初心者の男性）で使っている色は次の通り。変更が必要な場合はこの対応で置換する。

| 用途 | 色 |
|---|---|
| 肌 | `#F6D8C0` / 影 `#E8BE9F` |
| 女性の髪 | `#2A3040` |
| 男性の髪 | `#3A3226` |
| 女性のスーツ | `#1E3E6B` / 襟 `#2F5488` |
| 男性のシャツ | `#7FA5CE` / 襟 `#5D8AB8` |
| 頬 | `#F0A392`（opacity .45〜.5） |
| 口 | `#B4574B` |
| 目 | `#23293A` |
