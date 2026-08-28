# 指示書: アプリ本体の「現実派」→「YOMU」リブランド (PR#12)

対象: `realsim-app`。ブランチ `agent/pr12-rebrand` を新規に切って作業する。

**PR#11（デザイン刷新）とは独立した作業**。PR#11の作業中でも並行して進めてよいが、`src/theme.js` `src/ui.jsx` `src/icons.jsx` には触れないこと。

## 0. 背景

サービス名を「現実派」から「YOMU」へ変更した。YOMU は Yield（利回り）/ Occupancy（稼働）/ Mortgage（返済）/ Upkeep（維持）の頭字語で、「読む」にかけている。アプリ内に旧名が残っているため、これを置き換える。

## 1. 絶対に変更してはいけないもの

- **`src/plan.js` の `SALT = "genjitsuha-v1-salt-7f3a"`**
  文字列に旧名が含まれているが、**変更すると発行済みのライセンスキーがすべて無効になる**。`scripts/genkey.mjs` と対になっている値であり、リブランドとは無関係。**1文字も触らないこと。**
- **`supabase/*.sql` のテーブル名・カラム名・インデックス名・ポリシー名**
  先頭のコメント行のみ変更対象。DDLの識別子は一切変更しない
- **`CODEX_SPEC_phase1-3.md` などの既存の指示書**
  過去の作業記録なので書き換えない。旧名が残っていて正しい
- `src/engine.js` の計算ロジック
- Supabaseスキーマ、認証、Stripe連携、API

## 2. 置換対象（この7箇所だけ）

| ファイル | 行 | 現状 | 変更後 |
|---|---|---|---|
| `index.html` | `<title>` | `現実派 不動産収支シミュレーター v2` | `YOMU — 不動産収支シミュレーター` |
| `src/App.jsx` | L827付近 | `現実派 — 不動産収支シミュレーター ／ {title}` | `YOMU — 不動産収支シミュレーター ／ {title}` |
| `src/App.jsx` | L899付近 | `現実派 ｜ REAL ESTATE REALITY REPORT` | `YOMU ｜ YIELD · OCCUPANCY · MORTGAGE · UPKEEP` |
| `src/App.jsx` | L1089付近 | 同上（比較レポートの表紙） | 同上 |
| `package.json` | `name` | `genjitsuha-realsim` | `yomu-app` |
| `README.md` | L1 | `# 現実派 不動産収支シミュレーター(...)` | `# YOMU 不動産収支シミュレーター(...)` |
| `README.md` | L106付近 | `商品「現実派 Pro」` | `商品「YOMU Pro」` |
| `supabase/schema.sql` ほか2件 | 各L1のコメント | `-- 現実派: ...` | `-- YOMU: ...` |

## 3. 表記ルール

- サービス名は半角大文字の **`YOMU`**。「Yomu」「よむ」「読む」とは書かない
- 日本語の説明を添える場合は `YOMU — 不動産収支シミュレーター`（全角ダッシュではなくem dash `—`）
- 英字のブランド行は `YOMU ｜ YIELD · OCCUPANCY · MORTGAGE · UPKEEP`（区切りは全角縦棒とミドルドット）
- 頭字語を説明する場合は `Yield・Occupancy・Mortgage・Upkeep`

## 4. アプリ内にブランドの由来を1箇所だけ足す

現在アプリ内に「YOMUとは何の略か」を示す場所が無い。以下を追加する。

- 画面右上のアカウントメニュー、またはフッターに、`YOMU` のワードマークと小さく `Yield・Occupancy・Mortgage・Upkeep` を添える
- 装飾は最小限にとどめる。新規のモーダルやセクションは作らない

## 5. 完了条件

- [ ] `grep -rn '現実派' . --include='*.js' --include='*.jsx' --include='*.html' --include='*.json' --include='*.md' --include='*.sql'` の結果が、`CODEX_SPEC_*.md`（過去の指示書）のみになる
- [ ] `grep -rn 'genjitsuha' .` の結果が **`src/plan.js` の SALT 1行のみ**になる（`package.json` からは消える）
- [ ] `src/plan.js` に差分が無い
- [ ] `supabase/*.sql` の差分がコメント行のみ（DDLに差分が無い）
- [ ] `src/engine.js` `src/theme.js` `src/ui.jsx` に差分が無い
- [ ] `npm run build` が通る
- [ ] Proプランのライセンスキー認証が従来どおり動作する（SALTを変えていないことの確認）
- [ ] PDFレポートの表紙・フッター、比較レポートの表紙のスクリーンショットを添付する

## 6. 補足（今回はやらない・報告のみ）

以下は旧名に関連するが今回のスコープ外。**気づいた点があればPR説明に記載するだけにとどめ、変更しないこと。**

- Vercelプロジェクト名（`realsim-app` / `realsim-lp`）とURLの移行
- `src/App.jsx` L3127-3131 の法定ページへのリンク先 `https://realsim-lp.vercel.app/...`
- Supabase の Redirect URLs、Stripe の商品名
