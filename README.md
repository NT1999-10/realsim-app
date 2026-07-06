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
      │
      ▼
Anthropic API(キーはサーバー側のみ)
```

- **認証はSupabase任せ**(パスワードのハッシュ化・確認メール等を自作しない)
- **プランはDBが正**。端末が変わってもログインすれば同じプラン・同じクオータ
- **AI調査はサーバー側でJWT検証+Pro確認+月10回制限を強制**(直叩き対策済み)
- Supabase環境変数が未設定の場合は従来のライセンスキー方式で動作(段階移行可能)

## セットアップフロー

### 1. Supabase(約15分)
1. https://supabase.com で無料アカウント作成 → New Project(リージョンは Tokyo 推奨)
2. 左メニュー SQL Editor → `supabase/schema.sql` の全文を貼り付けて Run
3. Settings → API で以下を控える:
   - Project URL → `VITE_SUPABASE_URL` と `SUPABASE_URL`
   - anon public キー → `VITE_SUPABASE_ANON_KEY` と `SUPABASE_ANON_KEY`
   - service_role キー → `SUPABASE_SERVICE_ROLE_KEY`(**絶対に公開しない**)
4. Authentication → URL Configuration → Site URL にアプリのURL(https://realsim-app.vercel.app 等)を設定
   (新規登録の確認メールのリンク先になります)

### 2. Vercel 環境変数(約5分)
プロジェクト → Settings → Environment Variables に `.env.example` の6変数を登録
→ Deployments → 最新の「⋯」→ Redeploy(環境変数は再デプロイで反映)

### 3. Stripe(約15分)
1. https://stripe.com でアカウント作成 → 商品「現実派 Pro」月額¥1,480のサブスクを作成
2. Payment Link を発行 → URLを `src/plan.js` の `PURCHASE_URL` に設定
3. Developers → Webhooks → Add endpoint:
   - URL: `https://<あなたのapp>/api/stripe-webhook`
   - イベント: `checkout.session.completed` と `customer.subscription.deleted`
4. 発行された署名シークレット(whsec_...)を Vercel の `STRIPE_WEBHOOK_SECRET` に設定 → Redeploy

### 4. 動作確認
1. アプリで新規登録 → 確認メール → ログイン(Freeプラン表示)
2. 「Proにアップグレード」→ Stripeのテストモードでテストカード(4242 4242 4242 4242)決済
3. 「決済後、反映を確認する」→ Proに切り替われば全経路が通っています
4. AI調査を1回実行 → Supabaseの profiles で ai_used が増えていれば完璧

## ユーザーから見た流れ

新規登録(確認メール) → ログイン → Freeで利用 → アップグレード →
登録メアドのままStripe決済 → 自動でPro開放 → 解約時は自動でFreeに降格

## 残課題(次のステップ)

- 保存物件・予実データはまだ端末のlocalStorage。端末間同期にはSupabaseテーブルへの移行が必要
- パスワードリセットUI(Supabaseの `resetPasswordForEmail` で実装可能)
- 商用運用時は Vercel Pro(月$20)への切り替えが規約上必要
- 特商法表記・プライバシーポリシー・利用規約ページの整備
