# 指示: アプリ本体のデザインをLPの新デザインに統一する

## 0. 前提と目的

LP（`index.html` / 別途添付）のデザインを刷新した。アプリ本体（React + Vite）の見た目が旧デザインのままで、LPからサインアップして入った瞬間に別サービスに見える状態になっている。**アプリ側をLPのデザイン言語に合わせて統一する**のがこのタスクのゴール。

参照物として次の2ファイルを渡す。**必ず両方を読んでから着手すること。**

- `yomu-lp.html` … 完成済みの新LP。トークン定義・コンポーネントの実装例がすべてこの中にある
- `yomu-sprite.svg` … アイコン23種＋人物イラスト2種のSVGスプライト（そのまま流用する）

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

`yomu-sprite.svg` の中身を `src/components/IconSprite.tsx`（またはそれに相当する場所）としてアプリのルートに1度だけマウントし、各所から `<svg class="ico"><use href="#i-yield"/></svg>` で参照する。**アイコンを画像ファイルやアイコンライブラリで別途調達しない。**

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
| PR-A | トークン定義＋フォント読み込み＋スプライトのマウント。既存画面は触らない | 既存画面が壊れていないこと |
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

`yomu-lp.html` に実装がある場合は、**必ずそれをコピーして使う**。独自解釈で新しいパターンを作らない。LPに存在しないパターンが必要になった場合は、実装を進める前にその旨と提案を報告すること。
