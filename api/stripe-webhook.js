// Vercel Serverless Function: /api/stripe-webhook
// Stripeの決済イベントを受け取り、Supabaseのプランを自動更新する
//
// 必要な環境変数:
//   STRIPE_WEBHOOK_SECRET (Stripeダッシュボード → Webhook作成時に発行される whsec_...)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Stripe側の設定: Webhookエンドポイント https://<あなたのapp>/api/stripe-webhook
// 監視イベント: checkout.session.completed, customer.subscription.deleted

import crypto from "crypto";

export const config = { api: { bodyParser: false } }; // 署名検証に生ボディが必要

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Stripe署名検証(t.payload の HMAC-SHA256 が v1 と一致するか)
function verifySignature(sigHeader, payload, secret) {
  try {
    const parts = Object.fromEntries(
      (sigHeader || "").split(",").map((kv) => kv.split("=")));
    if (!parts.t || !parts.v1) return false;
    const expected = crypto.createHmac("sha256", secret)
      .update(`${parts.t}.${payload}`).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  } catch {
    return false;
  }
}

function svcHeaders() {
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json" };
}

async function setPlanByEmail(email, plan, customerId) {
  const url = process.env.SUPABASE_URL;
  const body = { plan };
  if (customerId) body.stripe_customer_id = customerId;
  await fetch(`${url}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}`, {
    method: "PATCH", headers: svcHeaders(), body: JSON.stringify(body),
  });
}

async function setPlanByCustomer(customerId, plan) {
  const url = process.env.SUPABASE_URL;
  await fetch(`${url}/rest/v1/profiles?stripe_customer_id=eq.${encodeURIComponent(customerId)}`, {
    method: "PATCH", headers: svcHeaders(), body: JSON.stringify({ plan }),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POSTのみ" });
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Webhookの環境変数が未設定です" });
  }

  const raw = await readRaw(req);
  if (!verifySignature(req.headers["stripe-signature"], raw, secret)) {
    return res.status(400).json({ error: "署名検証に失敗しました" });
  }

  const event = JSON.parse(raw.toString("utf8"));
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;
        const email = (s.customer_details && s.customer_details.email) || s.customer_email;
        if (email) await setPlanByEmail(email.toLowerCase(), "pro", s.customer || null);
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        if (sub.customer) await setPlanByCustomer(sub.customer, "free");
        break;
      }
      default:
        break; // その他のイベントは無視
    }
    return res.status(200).json({ received: true });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
