// Vercel Serverless Function: /api/billing-portal
// ログイン中のユーザーをStripeカスタマーポータルへ誘導する。
// ポータル内で サブスク解約 / 支払い方法の変更・削除 / 請求書確認 ができる。
// 必要な環境変数: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// Stripe側の事前設定: 設定 → Billing → カスタマーポータル を有効化(Save)しておくこと

async function getUser(req) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return { error: "サーバーの認証設定が未完了です", status: 501 };
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { error: "ログインが必要です", status: 401 };
  const r = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anon, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return { error: "認証に失敗しました。再ログインしてください", status: 401 };
  const u = await r.json();
  if (!u || !u.id) return { error: "認証に失敗しました", status: 401 };
  return { userId: u.id };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POSTのみ" });
  const sk = process.env.STRIPE_SECRET_KEY;
  if (!sk) return res.status(501).json({ error: "サーバーに STRIPE_SECRET_KEY が未設定です" });

  const who = await getUser(req);
  if (who.error) return res.status(who.status).json({ error: who.error });

  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const h = { apikey: svc, Authorization: `Bearer ${svc}` };
  const pr = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/profiles?id=eq.${who.userId}&select=stripe_customer_id`,
    { headers: h });
  const rows = await pr.json();
  const cid = rows && rows[0] && rows[0].stripe_customer_id;
  if (!cid) {
    return res.status(400).json({
      error: "決済情報が見つかりません。Proプラン購入後にご利用いただけます" });
  }

  const origin = req.headers.origin || `https://${req.headers.host}`;
  const body = new URLSearchParams({ customer: cid, return_url: origin });
  const r = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sk}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const s = await r.json();
  if (!r.ok || s.error) {
    return res.status(502).json({
      error: (s.error && s.error.message) ||
        "ポータルの作成に失敗しました。Stripe側でカスタマーポータルが有効化されているか確認してください" });
  }
  return res.status(200).json({ url: s.url });
}
