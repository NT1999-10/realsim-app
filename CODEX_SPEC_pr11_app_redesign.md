# 指示書: アプリのデザインをYOMUの新LPに統一する (PR#11)

対象: `realsim-app`。ブランチ `agent/pr11-design-system` を新規に切って作業する。

## 0. 目的と前提

`realsim-lp` 側のLPデザインを刷新した。アプリの見た目が旧デザイン（青緑グラデーション）のままで、LPからサインアップして入った瞬間に別サービスに見える。**アプリをLPのデザイン言語に合わせる**のがゴール。

リポジトリ直下の `CODEX_REF_yomu_lp.html` が目指す完成形の実装例。**本書の値が最優先**で、本書に書かれていない細部はこのHTMLの実装をコピーする。どちらにも無いパターンを独自に発明しないこと。

### 現状の把握（調査済み・前提として扱ってよい）

- スタイリングは**すべてインラインstyle**。CSSファイル・CSS Modules・Tailwindは一切使っていない
- デザイントークンは `src/theme.js` の `T` オブジェクト1つだけ
- 共通UIは `src/ui.jsx` の7つのexport（`Field` `Select` `Kpi` `cardSt` `h2St` `btnSt` `LockCard`）
- 画面本体は `src/App.jsx`（3138行）に集約。タブは ホーム / シミュレーション / 物件比較 / 分析 / 運用管理 / 競売
- グラフは recharts、色は `T` から供給されている
- 詳細モードのパラメータは `<Section no="01" title="...">` 〜 `09` で**既にカテゴリ分けされている**

### やらないこと（スコープ外・違反したPRは却下）

- **計算エンジン（`src/engine.js`）には一切触れない。** 数値・関数・引数を変更しない
- **`src/App.jsx` の分割リファクタリングをしない。** 3138行のままでよい。ファイル分割は差分がレビュー不能になるので禁止
- **CSSファイル・CSS変数（`:root{--x}`）・CSSフレームワークを導入しない。** 既存のインラインstyle + `T` の方式を維持する
- Supabaseスキーマ、RLS、認証、Stripe連携、API（`api/*.js`）の変更
- 機能の追加・削除・画面の統廃合。**今回は見た目だけ**
- 新規npmパッケージの追加（アイコンライブラリを含む）

---

## 1. `src/theme.js` の `T` を差し替える

**ファイルまるごと以下に置き換える。** キー名は既存を維持し（62箇所以上から参照されているため）、値だけを入れ替える。末尾に新規キーを追加する。

```js
// ---------- design tokens (YOMU) ----------
export const T = {
  bg: "transparent",

  // 面
  card: "#FFFFFF", surface2: "#FBFBF9", paper: "#F7F7F4",

  // 文字
  ink: "#14202F", sub: "#41526A", faint: "#6B7B91",

  // 罫線
  line: "#E4E4DE", line2: "#D2D6DC",

  // 藍（ブランド主色）
  navy: "#12233F", blue: "#1E3E6B", blue2: "#2F5488", teal: "#4A74AB",
  grad: "linear-gradient(180deg,#2a548c 0%,#1E3E6B 100%)",

  // シナリオ2色（グラフとKPIの対比に使う）
  scenario: "#1E3E6B",              // 現実シナリオ = 藍・実線
  scenarioSoft: "rgba(30,62,107,.20)",
  opt: "#DBA53F",                   // 楽観シナリオ = 山吹・破線
  optSoft: "rgba(219,165,63,.16)",

  // 危険・警告・良好
  real: "#C0392B",                  // 危険（キー名は互換のため据え置き。§2参照）
  realSoft: "rgba(192,57,43,.09)",
  danger: "#C0392B", dangerSoft: "rgba(192,57,43,.09)",
  warnBg: "#FDF5E3", warnInk: "#8A5A12", warnLine: "#EBD5A4",
  good: "#12795A", goodSoft: "#E6F4EF", goodLine: "#B6E0D0",

  // 山吹（ラベル・アクセント）
  gold: "#B8821F", gold2: "#DBA53F", goldSoft: "#FBF3E2",
  gradGold: "linear-gradient(180deg,#D09A2E 0%,#B8821F 100%)",

  // AI関連（青緑をやめて山吹系へ）
  aiBg: "rgba(184,130,31,.08)", aiInk: "#93671A", aiLine: "rgba(184,130,31,.35)",

  // 書体
  serif: '"Noto Serif JP",serif',
  sans: '"Zen Kaku Gothic New","Hiragino Sans","Yu Gothic",sans-serif',
  mono: '"JetBrains Mono",ui-monospace,Menlo,monospace',

  // 角丸
  r: 16, rS: 10, rXs: 8, pill: 999,

  // 影（この3つ以外の影を新規に作らない）
  sh1: "0 1px 2px rgba(18,35,63,.05), 0 6px 18px -10px rgba(18,35,63,.22)",
  sh2: "0 2px 4px rgba(18,35,63,.05), 0 18px 40px -20px rgba(18,35,63,.35)",
  sh3: "0 30px 70px -30px rgba(18,35,63,.45)",
};
```

---

## 2. `T.real` の意味を分離する（最重要・慎重に）

現在 `T.real`（#D14B32）は**2つの異なる意味**で使われている。`src/App.jsx` だけで62箇所ある。

| 意味 | 現状 | 変更後 |
|---|---|---|
| **A. 危険・マイナス値**（DSCR1.2未満、CF赤字、⛔行、支出、残り年数わずか） | `T.real` | `T.danger`（朱 #C0392B） |
| **B. 現実シナリオの系列色**（楽観と対比するグラフの線・エリア） | `T.real` | `T.scenario`（藍 #1E3E6B） |

**大半はAである。Bは以下の箇所だけ**（行番号は現時点のもの。前後の文脈で判定すること）:

- `src/App.jsx` L946 付近 — レポート内 `<Line dataKey="現実" stroke={T.real}>` → `T.scenario`
- `src/App.jsx` L2913 付近 — メイングラフ `<Line dataKey="現実累積" stroke={T.real}>` → `T.scenario`
- `src/App.jsx` L2909 付近 — `<Area dataKey="楽観累積" fill={T.realSoft}>` は塗り対象が楽観側なので → `fill={T.optSoft}`
- `src/App.jsx` L552 付近 — 予実管理 `<Line dataKey="実績累積" stroke={T.real}>` → `T.scenario`
- `src/App.jsx` L360-361 付近 — 感度分析の「現状」基準線 → `T.scenario`

**判定ルール**: その色が「悪い状態を警告している」ならA（朱）、「2つのシナリオのうち現実側を指している」ならB（藍）。迷ったらAにする。

あわせてシナリオ対比のスタイルをLPに揃える:

- 現実 = `T.scenario`、実線、`strokeWidth={2.8}`
- 楽観 = `T.opt`、破線 `strokeDasharray="5 4"`、`strokeWidth={2.4}`
- 単年CFのBarの `Cell` は `d["単年CF"] < 0 ? T.danger : T.scenario`

**なぜこう変えるか**: 現状は「現実シナリオ」が朱で描かれているため、正常な物件でも現実の線が警告色に見える。LPでは現実=藍・楽観=山吹・危険=朱と役割が分かれている。朱は危険専用に解放する。

**`T.real` というキー名は残す**（62箇所の一括置換ミスを避けるため）。値が朱のまま変わらないので、Aの用途はコード変更なしで正しく動く。Bの5箇所だけを `T.scenario` に書き換える。

---

## 3. `index.html` を差し替える

フォント読み込みと `body` の背景を変更する。`<title>` も直す。

```html
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@600;700&family=Zen+Kaku+Gothic+New:wght@400;500;700;900&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
```

- 現在の `Shippori Mincho` を `Noto Serif JP` に置き換える（LPと揃えるため）
- `JetBrains Mono` を**新規追加**する（現在は読み込まれておらず、数値がmonoになっていない）
- `<title>` を `YOMU — 不動産収支シミュレーター` に変更する

`<style>` ブロックの `body` 背景を、青緑のradial-gradient + ドットグリッドから、LPの方眼紙に置き換える:

```css
body{
  margin:0;
  font-family:"Zen Kaku Gothic New","Hiragino Sans","Yu Gothic",sans-serif;
  font-weight:500;
  color:#14202F;
  background:#F7F7F4;
}
body::before{
  content:""; position:fixed; inset:0; pointer-events:none; z-index:0;
  background-image:
    linear-gradient(rgba(30,62,107,.05) 1px,transparent 1px),
    linear-gradient(90deg,rgba(30,62,107,.05) 1px,transparent 1px);
  background-size:44px 44px;
  -webkit-mask-image:linear-gradient(180deg, rgba(0,0,0,.9), transparent 560px);
  mask-image:linear-gradient(180deg, rgba(0,0,0,.9), transparent 560px);
}
```

---

## 4. `src/ui.jsx` の7つを書き換える

**この7つを直せば、アプリの大半の見た目が変わる。** 以下をそのまま実装する。

### 4.1 `cardSt` / `h2St` / `btnSt`

```js
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
```

### 4.2 `Field` — 数値入力を主役にする

- ラベル: `fontSize: 13.5, fontWeight: 700, color: T.ink`（現状は12px・`T.sub`で薄すぎる）
- 入力: `fontFamily: T.mono, fontSize: 19, fontWeight: 700, textAlign: "right"`
- 枠: `border: 1.5px solid ${T.line2}`, `borderRadius: T.rS`, 背景 `#FFF`
- フォーカス時: `borderColor: T.teal` + `boxShadow: "0 0 0 4px rgba(74,116,171,.14)"`（`onFocus`/`onBlur` でstate管理）
- 単位（`unit`）は入力欄の**内側右端**にグレーで固定表示する（現在は外側に置かれている）
- `?` ヘルプボタン: `borderRadius: T.pill`, 色は `T.gold`。開いたときの解説パネルは `background: T.goldSoft, color: T.aiInk`
- `hint` は `fontSize: 12, color: T.faint`

### 4.3 `Select`

`Field` と同じ枠・角丸・フォーカスリングに揃える。`fontSize: 15`、`fontFamily: T.sans`。

### 4.4 `Kpi` — 画面で最も目立つ要素にする

```js
// 数値は必ず mono + tabular-nums
{ fontFamily: T.mono, fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums" }
```

- ラベル: `fontSize: 11.5, fontWeight: 700, color: T.faint, letterSpacing: ".04em"`、英字ラベルなら `fontFamily: T.mono`
- カード: `borderRadius: T.rS`, `border: 1px solid ${T.line}`, `boxShadow: T.sh1`, `padding: "14px 16px"`
- `color` propが渡されない場合の既定は `T.ink`

### 4.5 `LockCard`

`T.grad` のボタンはそのまま活かす。鍵の絵文字を `#i-shield` アイコン（§6）に差し替え、ラベルの背景を `rgba(255,255,255,.92)`、`borderRadius: T.rS` に。

---

## 5. `src/App.jsx` の直書きスタイル

`App.jsx` には `ui.jsx` を経由しない直書きの `style={{...}}` が多数ある。以下を置換する。**構造・ロジック・JSXの入れ子は変えない。値だけ差し替える。**

### 5.1 `Section`（L41付近）— パラメータ群の折りたたみカード

分類（01 物件・取得コスト 〜 09 売却出口）は**既に正しいので変更しない**。見た目だけ:

- カード: `borderRadius: T.r`, `boxShadow: T.sh1`, `padding: 22`, `border: 1px solid ${T.line}`
- 見出し: `h2St` と同じ（明朝17px + 1px罫線）。`borderBottom: 3px solid ${T.blue}` をやめる
- 番号（`no`）: `fontFamily: T.mono, fontSize: 11, letterSpacing: ".14em", color: T.gold`
- 開閉の `+` / `−`: `#i-plus` アイコン（§6）に差し替え、開いているとき45度回転

### 5.2 `DiagnosisCard`（L715付近）— LPの信号機に寄せる

`conf` を以下に変更し、判定に応じてカード全体の背景・枠線を変える:

```js
const conf = {
  ok:     { color: T.good,    bg: T.goodSoft, line: T.goodLine, label: "健全",  lamp: "g" },
  warn:   { color: T.warnInk, bg: T.warnBg,   line: T.warnLine, label: "要注意", lamp: "y" },
  danger: { color: T.danger,  bg: T.dangerSoft, line: "#F3C3BC", label: "危険", lamp: "r" },
}[diag.level];
```

- 現在の12px単色ドットを、**縦3灯の信号機**に置き換える（14px円を縦に3つ、該当色のみ点灯し `boxShadow: 0 0 0 4px <色の20%>`、非点灯は `rgba(20,32,47,.13)`）
- 見出し「診断: 健全」は `fontFamily: T.serif, fontSize: 19`
- `⛔` `⚠` の絵文字は `#i-alert` アイコンに差し替える
- `borderLeft: 5px solid` は残してよい（LPの吹き出しと同じ発想）

### 5.3 タブナビ（L2679付近）

- `borderRadius: 18` → `T.pill` のまま可。選択中の `background: T.grad` は新しい藍グラデになるので変更不要
- `boxShadow: "0 6px 18px rgba(45,125,210,.28)"` → `"0 6px 18px rgba(30,62,107,.28)"`（青緑の名残）
- 非選択タブに各タブのアイコンを追加する（ホーム=`i-metrics` / シミュレーション=`i-compare` / 物件比較=`i-metrics` / 分析=`i-stress` / 運用管理=`i-manage` / 競売=`i-auction`）
- Pro限定の 🔒 絵文字は `#i-shield` に差し替える

### 5.4 モード切替（L2714付近）・KPI行（L2875付近）・グラフ見出し

- モード切替のセグメント: `borderRadius: T.rS`, 選択中は `T.grad`
- KPI行: `gap: 8` → `10`
- グラフの見出し（`fontSize: 13, color: T.navy` の直書き）は `h2St` に統一する
- recharts の `CartesianGrid stroke` は `T.line`、`ReferenceLine y={0}` は `T.line2`、軸の `tick fill` は `T.faint`
- ハードコードされた `"#E9EDF1"` `"#16222E"`（レポート内）も `T.line` / `T.ink` に置換する

### 5.5 AI市場データのセクション（L2758付近）

`T.aiBg` / `T.aiInk` の値が青緑から山吹に変わるので、**コードは変えなくてよい**。ただし枠線の直書き `"1px solid rgba(43,184,163,.35)"` を `T.aiLine` に置換すること。

---

## 6. アイコンの導入

**付録A** のSVGを `src/assets/yomu-sprite.svg` として保存し、その中身をReactコンポーネント `src/icons.jsx` として実装する（既存のフラットな `src/` 構成に合わせる。`components/` ディレクトリは作らない）。

```jsx
// src/icons.jsx
export function IconSprite() { return ( /* 付録AのSVGをそのままJSX化 */ ); }
export function Icon({ name, size = 22, color = "currentColor", style }) {
  return (
    <svg width={size} height={size} style={{ stroke: color, fill: "none", strokeWidth: 1.7,
      strokeLinecap: "round", strokeLinejoin: "round", flexShrink: 0, ...style }}>
      <use href={`#i-${name}`} />
    </svg>
  );
}
export function IconTile({ name, tone = "ink" }) { /* 46px・角丸13px・グラデ背景のタイル */ }
```

`<IconSprite />` は `src/main.jsx` または `App` の最上位で**1度だけ**マウントする。

JSXへの変換時の注意: `class` → `className`、`stroke-width` → `strokeWidth`、`stroke-dasharray` → `strokeDasharray`、`stroke-linecap` → `strokeLinecap`、`stroke-linejoin` → `strokeLinejoin`、`fill-rule` → `fillRule`。**パスのd属性と数値は1文字も変更しないこと。**

`IconTile` のトーン: `ink`（`linear-gradient(150deg,#EAF0F9,#DCE6F4)` / 文字色 `T.blue`）、`gold`（`linear-gradient(150deg,#FBF1DC,#F4E3BF)` / `#93671A`）、`red`（`linear-gradient(150deg,#FDECEA,#FAD9D4)` / `T.danger`）。

### アイコンの割り当て（意味で固定する）

| 概念 | シンボル |
|---|---|
| 利回り・収益・純資産 | `i-yield` |
| 物件・稼働・空室・ポートフォリオ | `i-occupancy` |
| 融資・返済・金融機関 | `i-mortgage` |
| 維持・設備・修繕 | `i-upkeep` |
| シナリオ比較・累積CF | `i-compare` |
| AI市場調査 | `i-ai` |
| 信号機診断 | `i-signal` |
| 感度分析・ストレステスト | `i-stress` |
| 指標・物件比較・レポート図表 | `i-metrics` |
| 運用管理・カレンダー・予実 | `i-manage` |
| 競売・指値 | `i-auction` |
| PDF出力・申告CSV | `i-pdf` |
| 警告・⛔・⚠ | `i-alert` |
| Pro限定・セキュリティ | `i-shield` |
| 同期・繰上返済 | `i-sync` |

### 人物イラストの使いどころ

`il-woman`（スーツの女性）と `il-rookie`（初心者）を**1画面に1体まで**で使う。

- **空状態**: 物件0件、検討候補トレイが空、保存済みリサーチが無い、競売物件が0件 — `il-rookie` + 次の行動を促す1文 + CTAボタン。**「まだありません」だけの画面を全廃する**
- **診断結果**: `DiagnosisCard` の脇に `il-woman` の丸アイコン（72px、`overflow:hidden` の円に下端を合わせて配置）+ 吹き出しで `diag.summary` の1文目を出す
- **かんたんモードの導入文**: `il-woman` を添える

吹き出し: `background: "linear-gradient(120deg,#FEF5F3,#fff 60%)"`, `border: "1px solid #F3CFC9"`, `borderRadius: 14`, `padding: "13px 17px"`, `boxShadow: T.sh1`。左向きの三角は14px正方形を45度回転した `::before` 相当の要素で作る（インラインstyleでは疑似要素が使えないため、`transform: "rotate(45deg)"` を当てた `<span>` を絶対配置する）。

---

## 7. 朱色（`T.danger`）の使用ルール

朱は**注目を集めるための予算**として扱う。使いすぎると効かなくなる。

**使ってよい**: 赤信号判定、DSCR 1.2未満、CFマイナス、楽観とのギャップ、⛔行、支出、削除・解約ボタン、設備の残り年数わずか。

**使ってはいけない**: 通常のリンク、通常のラベル、装飾目的の枠線、現実シナリオの系列色（§2）。

良好は `T.good`、中立は `T.ink`、補助ラベルは `T.gold`。**1画面に朱が3箇所を超えたら設計を見直すこと。**

---

## 8. PR分割

1つの巨大PRにしない。以下の順で分割し、各PRにスクリーンショットを添える。

| PR | 内容 | 完了の目安 |
|---|---|---|
| PR-A | §1 `theme.js` 差し替え / §3 `index.html` / §6 スプライトと `icons.jsx` 設置（まだ使わない） | ビルドが通り、既存画面の配色が藍・山吹に変わっている |
| PR-B | §4 `ui.jsx` の7つを書き換え | 入力欄の数値がmonoの19pxになり、カードが角丸16pxになっている |
| PR-C | §2 `T.real` の意味分離とグラフのシナリオ2色化 | 現実の線が藍、楽観が山吹の破線になっている |
| PR-D | §5 `App.jsx` の直書きスタイル置換（`Section` / `DiagnosisCard` / タブ / KPI / レポート） | 青緑の名残（`rgba(45,125,210,*)` `rgba(43,184,163,*)` `#E9EDF1`）がgrepで出ない |
| PR-E | §6 アイコンとイラストの適用、空状態の作り込み | 「まだありません」だけの画面が0になっている |

---

## 9. 完了条件

- [ ] `src/engine.js` に差分が無い。計算結果が変更前と1円も変わらない
- [ ] `src/App.jsx` が分割されていない（ファイル数が増えていない。`icons.jsx` を除く）
- [ ] `npm run build` が通る
- [ ] 旧配色の残骸が無い: `2D7DD2` `2BB8A3` `D14B32` `9DB6C8` `1F3A52` `E2E8EF` `E9EDF1` `16222E` `10202E` `5A6B7B` を全ファイルgrepして、`theme.js` 以外にヒットしない
- [ ] すべての金額・率・年数が `fontFamily: T.mono` + `fontVariantNumeric: "tabular-nums"` で表示され、桁が縦に揃う
- [ ] `fontSize` が 12px 未満の本文が残っていない（ラベル・注釈は12px以上、本文は13.5px以上）
- [ ] 影は `T.sh1` / `T.sh2` / `T.sh3` のみ。`boxShadow` の直書きが無い
- [ ] 現実シナリオの線が藍・実線、楽観が山吹・破線になっている
- [ ] 1画面あたりの朱の使用が3箇所以内
- [ ] 空状態の画面すべてにイラストとCTAがある
- [ ] 幅 390px / 768px / 1440px で横スクロールが出ない
- [ ] 全6タブ（ホーム/シミュレーション/物件比較/分析/運用管理/競売）とレポート出力画面のスクリーンショットを添付し、`CODEX_REF_yomu_lp.html` と並べて同一プロダクトに見えることを確認

## 10. 判断に迷ったとき

本書に値の指定があれば**そのまま使う**。丸めたり近い値に置き換えたりしない。本書と `CODEX_REF_yomu_lp.html` の両方に無いパターンが必要になったら、**実装せずに報告して指示を待つ**。

本書の記述とリポジトリの実態（行番号のズレ、想定と違う実装）が食い違った場合も、勝手に読み替えずに報告すること。


---

## 付録A. SVGスプライト

以下をそのまま `src/assets/yomu-sprite.svg` として保存し、§6の手順で `src/icons.jsx` にJSX化する。アイコン21種と人物イラスト2種を含む。**パスデータを改変しないこと。**

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

### 人物イラストの配色

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
