// Vercel Serverless Function: /api/delete-account
// 本人確認(JWT)の上で、有効なサブスクを解約 → アカウントを完全削除する。
// profiles / user_data は外部キーの on delete cascade で自動削除される。
// 必要な環境変数: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// (STRIPE_SECRET_KEY があればサブスクの自動解約も行う)

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
  const who = await getUser(req);
  if (who.error) return res.status(who.status).json({ error: who.error });

  const url = process.env.SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const h = { apikey: svc, Authorization: `Bearer ${svc}` };

  // プロファイル取得
  const pr = await fetch(
    `${url}/rest/v1/profiles?id=eq.${who.userId}&select=plan,stripe_customer_id`,
    { headers: h });
  const rows = await pr.json();
  const p = (rows && rows[0]) || {};
  const cid = p.stripe_customer_id;
  const sk = process.env.STRIPE_SECRET_KEY;

  // 有効なサブスクの解約(可能なら自動、不可能ならエラーで案内)
  if (cid && sk) {
    try {
      const list = await fetch(
        `https://api.stripe.com/v1/subscriptions?customer=${encodeURIComponent(cid)}&status=active&limit=10`,
        { headers: { Authorization: `Bearer ${sk}` } });
      const subs = await list.json();
      for (const s of (subs.data || [])) {
        await fetch(`https://api.stripe.com/v1/subscriptions/${s.id}`, {
          method: "DELETE", headers: { Authorization: `Bearer ${sk}` } });
      }
    } catch (e) {
      return res.status(502).json({ error: "サブスクリプションの解約に失敗しました。先に「支払い・サブスクリプション管理」から解約してから、再度お試しください" });
    }
  } else if (p.plan === "pro" && cid) {
    return res.status(400).json({
      error: "有効なサブスクリプションがあります。先に「支払い・サブスクリプション管理」から解約してから、アカウントを削除してください" });
  }

  // Supabase Authからユーザーを削除(profiles/user_dataはcascadeで消える)
  const del = await fetch(`${url}/auth/v1/admin/users/${who.userId}`, {
    method: "DELETE", headers: h });
  if (!del.ok) {
    return res.status(502).json({ error: "アカウントの削除に失敗しました。時間をおいて再度お試しください" });
  }
  return res.status(200).json({ ok: true });
}
