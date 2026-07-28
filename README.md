# 現実派 不動産収支シミュレーター(アカウント認証+課金対応版)

Vercel + Supabase + Stripe による本番SaaS構成。
アカウント作成/ログイン、プランのDB管理、決済完了時の自動Pro開放に対応。

## アーキテクチャ

```
ブラウザ(React) ──ログイン──▶ Supabase Auth(アカウント管理)
      │                          │
      │ JWT付きでAI調査依頼        │ profilesテーブル(plan, AI利用回数)
      ▼                          ▼
Vercel /api/research ──検証──▶ Supabase DB ◀──plan更新── /api/stripe-webhook ◀── Stripe決済
      │                              ▲
      ▼                              │ market_cache(7日)
Anthropic API              /api/market-price ──▶ 国交省 不動産情報ライブラリAPI
      │                              │
      └──── /api/auction-import ─────▶ auction_items ◀──── /api/auction-list
             (管理者CSV・service role)                  (JWT・Pro限定)
(キーはサーバー側のみ)
```

- **認証はSupabase任せ**(パスワードのハッシュ化・確認メール等を自作しない)
- **プランはDBが正**。端末が変わってもログインすれば同じプラン・同じクオータ
- **AI調査はサーバー側でJWT検証+Pro確認+月10回制限を強制**(直叩き対策済み)
- **相場照合APIはJWT検証+Pro確認+1ユーザー30回/日制限を強制**。国交省APIキーはサーバー側だけに保持
- **競売一覧APIはJWT検証+Pro確認を強制**。RLSを維持したままservice roleで有効物件だけを返す
- Supabase環境変数が未設定の場合は従来のライセンスキー方式で動作(段階移行可能)

## セットアップフロー

### 1. Supabase(約15分)
1. https://supabase.com で無料アカウント作成 → New Project(リージョンは Tokyo 推奨)
2. 左メニュー SQL Editorで次のSQLを順に実行:
   - `supabase/schema.sql` — 認証・ユーザーデータの基本テーブル
   - `supabase/schema_v3_market.sql` — 相場照合の7日キャッシュ(既存環境への追加分)
   - `supabase/schema_v4_auction.sql` — 競売物件データ(既存環境への追加分)
3. Settings → API で以下を控える:
   - Project URL → `VITE_SUPABASE_URL` と `SUPABASE_URL`
   - anon public キー → `VITE_SUPABASE_ANON_KEY` と `SUPABASE_ANON_KEY`
   - service_role キー → `SUPABASE_SERVICE_ROLE_KEY`(**絶対に公開しない**)
4. Authentication → URL Configuration → Site URL にアプリのURL(https://realsim-app.vercel.app 等)を設定
   (新規登録の確認メールのリンク先になります)

### 2. Vercel 環境変数(約5分)
プロジェクト → Settings → Environment Variables に `.env.example` の変数を登録
→ Deployments → 最新の「⋯」→ Redeploy(環境変数は再デプロイで反映)

`SUPABASE_SERVICE_ROLE_KEY`、`ANTHROPIC_API_KEY`、`STRIPE_SECRET_KEY`、
`STRIPE_WEBHOOK_SECRET`、`MLIT_API_KEY`、`ADMIN_EMAILS` はサーバー専用です。
`VITE_` 接頭辞を付けたり、クライアントコードへ記載したりしないでください。

### 3. 国土交通省 不動産情報ライブラリAPI

1. [不動産情報ライブラリ API利用申請](https://www.reinfolib.mlit.go.jp/api/request/)から利用申請
2. 発行されたAPIキーをVercelの `MLIT_API_KEY` に設定
3. `supabase/schema_v3_market.sql` を実行後、再デプロイ

実装は公式の [XIT001](https://www.reinfolib.mlit.go.jp/help/apiManual/xit001/) と
[XIT002](https://www.reinfolib.mlit.go.jp/help/apiManual/xit002/) を使用します。

### 4. 競売データの管理者CSV取り込み

BITのサイト利用条件と `robots.txt`、現行検索画面の構造を確認した結果、
PR#5では自動クロールを採用せず、管理者が手動で転記・エクスポートしたCSVを
`POST /api/auction-import` で取り込む方式にしています。BITへの自動アクセスや
3点セットPDFの保存は行いません。

1. `supabase/schema_v4_auction.sql` をSQL Editorで実行
2. Vercelの `ADMIN_EMAILS` に取り込みを許可するログインメールをカンマ区切りで設定
3. 対象管理者でログインして得たJWTを `Authorization: Bearer <JWT>` に設定
4. `Content-Type: text/csv` でCSV本文をPOST（JSONの `{"csv":"..."}` も可）

必須列は `id` と `bit_url` です。対応する全列は次のとおりです。

```csv
id,court,case_no,item_no,pref,city,address,type,min_price,deposit,bid_start,bid_end,open_date,built_year,floor_area,land_area,bit_url,active
13105-R8-K1-1,東京地方裁判所,令和8年(ケ)第1号,1,東京都,文京区,文京区○○,マンション,20000000,4000000,2026-08-01,2026-08-08,2026-08-15,2001,45.2,,https://www.bit.courts.go.jp/app/example,true
```

- `type`: `マンション` / `戸建て` / `土地` / `その他`
- 金額は円、日付は `YYYY-MM-DD`
- `bit_url` は `https://www.bit.courts.go.jp/` 配下のみ許可
- 1回最大1,000件。同一 `id` は更新し、初回登録日時は保持
- 認証なしは401、許可メール以外は403、`ADMIN_EMAILS` 未設定は501

管理者メールでログインすると、アプリの「競売」タブ上部に管理者専用の取り込み画面が表示されます。
1件入力フォーム、ヘッダー付きCSVの一括貼り付け、直近20件の確認・無効化を画面上で行えます。
管理者判定は `GET /api/auction-import` がサーバー側で行い、許可メール一覧はブラウザへ返しません。

Proユーザーはアプリの「競売」タブから `POST /api/auction-list` を利用します。
都道府県・種別・基準価額上限で検索でき、フォローした物件の入札開始・終了・開札日は
運用管理のイベントカレンダーへ自動表示されます。「入札上限を計算」から
シミュレーションへ基準価額を反映し、SashineLabを競売モードで開けます。

### 5. Stripe(約15分)
1. https://stripe.com でアカウント作成 → 商品「現実派 Pro」月額¥1,480のサブスクを作成
2. Payment Link を発行 → URLを `src/plan.js` の `PURCHASE_URL` に設定
3. Developers → Webhooks → Add endpoint:
   - URL: `https://<あなたのapp>/api/stripe-webhook`
   - イベント: `checkout.session.completed` と `customer.subscription.deleted`
4. 発行された署名シークレット(whsec_...)を Vercel の `STRIPE_WEBHOOK_SECRET` に設定 → Redeploy

### 6. 動作確認
1. アプリで新規登録 → 確認メール → ログイン(Freeプラン表示)
2. 「Proにアップグレード」→ Stripeのテストモードでテストカード(4242 4242 4242 4242)決済
3. 「決済後、反映を確認する」→ Proに切り替われば全経路が通っています
4. AI調査を1回実行 → Supabaseの profiles で ai_used が増えていれば完璧
5. `POST /api/market-price` をProユーザーのJWT付きで実行し、Supabaseの
   `market_cache` に結果が保存されることを確認
6. 管理者JWT付きで `POST /api/auction-import` を実行し、`auction_items` に結果が保存されることを確認
7. Proユーザーで競売タブを検索し、BITリンク・入札上限計算・フォロー日程のカレンダー表示を確認

## ユーザーから見た流れ

新規登録(確認メール) → ログイン → Freeで利用 → アップグレード →
登録メアドのままStripe決済 → 自動でPro開放 → 解約時は自動でFreeに降格

## 残課題(次のステップ)

- 保存物件・予実データはまだ端末のlocalStorage。端末間同期にはSupabaseテーブルへの移行が必要
- パスワードリセットUI(Supabaseの `resetPasswordForEmail` で実装可能)
- 商用運用時は Vercel Pro(月$20)への切り替えが規約上必要
- 特商法表記・プライバシーポリシー・利用規約ページの整備
