# 指示書: YOMUロゴの実装 (PR#13)

対象: `realsim-app`。ブランチ `agent/pr13-logo` を新規に切って作業する。

前提: PR#12（リブランド）がマージ済みであること。PR#11のデザイン刷新とは独立して進めてよい。

## 0. 先に直す — PR#12 が取りこぼした箇所

PR#12の完了条件は `grep '現実派'` だったが、`src/App.jsx` L2618付近のヘッダーでは旧ブランドが **`現実<span style=...>派</span>` とタグで分断されている**ため検索に引っかからない。**アプリで最も目立つロゴがそのまま残っている。**

同じヘッダーにある旧コピー `現実を、味方につける。` も同じ理由で未検出。

本PRの §2 でこのヘッダーごと置き換えることで解消する。

## 1. 配置済みのファイル（**中身を変更しないこと**）

以下は既にリポジトリに置いてある。**1文字も書き換えないこと。**

```
src/logo.jsx                    ロゴのReactコンポーネント（後述）
public/favicon.svg
public/favicon-16.png
public/favicon-32.png
public/apple-touch-icon.png
public/icon-192.png
public/icon-512.png
```

`src/logo.jsx` は次の3つをエクスポートする。

| export | 用途 |
|---|---|
| `YomuWordmark({ height, gold })` | ワードマーク。`gold`（既定 true）で O が金になる |
| `YomuMark({ size })` | 日輪マーク。`size<=20` で自動的に格子なしの小サイズ用に切り替わる |
| `YomuLock({ size, vertical })` | マーク + ワードマークのロックアップ。O は藍に落とされる |

ワードマークは Poppins Medium をアウトライン化した図形で構成されている。**Webフォントを追加してはいけない。** パスデータを整形・短縮・再計算しないこと。

## 2. ヘッダーを置き換える（`src/App.jsx` L2618付近）

現在の `<header style={{ marginBottom: 16 }}>` の冒頭3要素 — 旧コピー `現実を、味方につける。`、`<h1>` の `現実<span>派</span> 不動産収支シミュレーター`、説明文 `取得検討から運用・申告まで。…` — を、次の1行に置き換える。

```jsx
<YomuWordmark height={26} />
```

- 説明文「不動産収支シミュレーター」は**表示しない**。訪問者は何のサービスか分かって来ており、直下にタブとKPIが並ぶため、ヘッダーはロゴだけで完結させる
- 旧コピー `現実を、味方につける。` は復活させない。新しいキャッチコピーもここに置かない
- `<header>` 内の**ログイン状態・プラン表示・アップグレードボタンのブロックはそのまま残す**
- ファイル冒頭に `import { YomuWordmark, YomuMark, YomuLock } from "./logo.jsx";` を追加する

## 3. ロックアップを3か所に置く

### 3.1 ログイン / 新規登録（`AuthModal`、L2009付近）

モーダルの見出しの上に、縦組みロックアップを置く。

```jsx
<YomuLock size={56} vertical style={{ margin: "0 auto 18px" }} />
```

### 3.2 PDFレポートの表紙（`ReportView` L899付近 / `CompareReportView` L1089付近）

PR#12で `YOMU ｜ YIELD · OCCUPANCY · MORTGAGE · UPKEEP` に置換済みの `<div className="brand">` を、マーク入りに変える。

```jsx
<div className="brand" style={{ display: "flex", alignItems: "center", gap: 10 }}>
  <YomuMark size={22} style={{ color: "#1E3E6B" }} />
  <span>YOMU ｜ YIELD · OCCUPANCY · MORTGAGE · UPKEEP</span>
</div>
```

レポートのフッター（L827付近）は文字のみのままでよい。

### 3.3 空状態

次の4か所の「まだ〜ありません」に、マークとCTAを添える。**文言は変えてよいが、次の行動を促す一文を必ず入れること。**

| 場所 | 現在の文言（抜粋） |
|---|---|
| `CompareTab` L214付近 | まだ保存された物件がありません。… |
| ホームの保有ポートフォリオ L1787付近 | まだ物件が保存されていません。… |
| 月次レビュー L1883付近 | {review.label}の実績がまだ入力されていません。… |
| 保存済みリサーチライブラリ L2829付近 | まだ保存されたリサーチはありません。… |

書式は次に揃える。

```jsx
<div style={{ textAlign: "center", padding: "28px 16px" }}>
  <YomuMark size={44} style={{ margin: "0 auto 14px", opacity: 0.32, color: "#1E3E6B" }} />
  <div style={{ fontSize: 13.5, color: "#41526A", lineHeight: 1.8 }}>
    …説明文…
  </div>
</div>
```

## 4. `index.html`

`<head>` に追加する。

```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#12233F">
<meta property="og:title" content="YOMU — 不動産収支シミュレーター">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
```

**OGP画像は用意しない。** `og:image` と `og:description` は設定しないこと。`twitter:card` は画像なしのため `summary` を指定する。

`<title>` が `YOMU — 不動産収支シミュレーター` になっていることを確認する（PR#12で変更済みのはず）。

## 5. ロゴの使用ルール

**金の丸は常にひとつだけ**、が原則。これを守れば残りは自動的に決まる。

| 場面 | 使うもの |
|---|---|
| ヘッダー（横長・小さい） | `<YomuWordmark />` 単体。O は金 |
| ログイン・レポート表紙・空状態（面が大きい） | `<YomuLock />`。マークが金を担当し、O は藍に落ちる |
| ファビコン・アプリアイコン・SNS（正方形） | `<YomuMark />` 単体 |

- **ワードマークとマークを金の丸ふたつで同時に出さない。** 併置するときは必ず `YomuLock` を使う（`gold={false}` が内部で効く）
- マークの周囲には、マークの高さの1/4以上の余白を確保する
- マーク・ワードマークを回転・変形・単色化しない。日輪の `#DBA53F` と格子の `#F7F7F4` は固定で、屋根と文字だけが `currentColor` で背景に追従する
- サイズは `size` / `height` の props で指定する。CSSの `transform: scale()` や `width` で縮小しない（小サイズ用の描き分けが効かなくなる）

## 6. やらないこと

- `src/logo.jsx` と `public/` の配置済みファイルの変更
- `src/theme.js` `src/ui.jsx` `src/icons.jsx` `src/engine.js` の変更
- Webフォントの追加（ロゴはアウトライン化済みで、フォントに依存しない）
- `src/App.jsx` の分割リファクタリング
- ヘッダーへのキャッチコピー・説明文の追加

## 7. 完了条件

- [ ] `grep -rn '現実' src/ index.html` の結果が **0件**（`現実派` ではなく `現実` で検索すること）
- [ ] `grep -rn 'Shippori' .` の結果が0件
- [ ] `src/logo.jsx` に差分が無い
- [ ] `src/theme.js` `src/ui.jsx` `src/engine.js` に差分が無い
- [ ] `package.json` に新しい依存が増えていない
- [ ] `npm run build` が通る
- [ ] ブラウザのタブにアイコンが表示される
- [ ] 金の丸が2つ同時に出ている画面が無い
- [ ] 「まだ〜ありません」だけの空画面が無くなっている
- [ ] ヘッダー・ログイン画面・レポート表紙・空状態・ファビコンのスクリーンショットを添付する
