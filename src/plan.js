// ---------------------------------------------------------------
// プラン定義とライセンス認証(v1: クライアント側チェックサム方式)
//
// 【セキュリティ注意】この方式はキーの形式検証をブラウザ内で行うため、
// コードを解析すれば突破可能です。個人向けMVPとしては十分ですが、
// 売上が立ったら検証をサーバーレス関数(api/)へ移すか、
// Stripeのサブスクリプション照会に置き換えてください。
// ---------------------------------------------------------------

const SALT = "genjitsuha-v1-salt-7f3a"; // 変更したら genkey.mjs 側も同じ値に

export const PLANS = {
  free: { id: "free", label: "Free", maxProperties: 3, aiPerMonth: 0 },
  pro:  { id: "pro",  label: "Pro",  maxProperties: Infinity, aiPerMonth: 10 },
};

// Stripe Payment Link 等の購入ページURLをここに設定
export const PURCHASE_URL = "";

async function sha256hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// キー形式: RP-XXXX-XXXX-CCCCCC (Cはチェックサム)
export async function verifyLicense(key) {
  const m = (key || "").trim().toUpperCase()
    .match(/^RP-([A-Z0-9]{4})-([A-Z0-9]{4})-([A-Z0-9]{6})$/);
  if (!m) return false;
  const body = m[1] + m[2];
  const h = (await sha256hex(body + SALT)).slice(0, 6).toUpperCase();
  return h === m[3];
}

export function loadPlan() {
  try { return localStorage.getItem("rs-plan") === "pro" ? "pro" : "free"; }
  catch { return "free"; }
}
export function savePlan(p) {
  try { localStorage.setItem("rs-plan", p); } catch (e) { /* noop */ }
}

// AI調査の月間利用回数(端末ローカル管理)
export function aiQuota(plan) {
  const ym = new Date().toISOString().slice(0, 7);
  let st = { ym, n: 0 };
  try {
    const r = JSON.parse(localStorage.getItem("rs-ai") || "null");
    if (r && r.ym === ym) st = r;
  } catch (e) { /* noop */ }
  return {
    used: st.n,
    left: Math.max(0, (PLANS[plan] || PLANS.free).aiPerMonth - st.n),
    inc() {
      st.n += 1;
      try { localStorage.setItem("rs-ai", JSON.stringify(st)); } catch (e) { /* noop */ }
    },
  };
}
