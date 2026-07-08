// Vercel Serverless Function: /api/research
// 認証(Supabase JWT)+プラン確認+月間クオータをサーバー側で強制してから
// Anthropic APIを呼び出す。ANTHROPIC_API_KEYはクライアントに出ない。
//
// 必要な環境変数:
//   ANTHROPIC_API_KEY
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//   (Supabase系が未設定の場合は認証なしの開発モードで動作)

const AI_PER_MONTH = 10;

const buildPrompt = (area, ptype) => `あなたは日本の不動産市場アナリストです。ウェブ検索を使って、以下のエリア・物件タイプの賃貸住宅市場データを調査してください。
エリア: ${area}
物件タイプ: ${ptype}

調査観点:
1. このエリアの賃貸住宅の家賃推移(直近数年の年間下落/上昇率)と、平均入居年数・退去後の平均空室期間
2. 日銀の金融政策を踏まえた、投資用不動産ローンの現在の変動金利相場と今後の年間上昇ペース
3. このエリアの中古物件価格の年間変動率と、同種中古物件の期待利回り(キャップレート)
4. このエリアの賃貸商習慣: 礼金の相場、更新料(貸主受取分)の相場、募集広告料(AD)の相場
5. 賃貸管理委託料の相場、退去時原状回復費の貸主負担の平均額、修繕・内装工事費の年間上昇率

回答は以下のJSONオブジェクトのみを返してください。コードブロック記号や前置きは一切不要です。数値は推定でよいので必ず数値で埋めてください(商習慣がない項目は0)。
{
  "rentDeclinePct": 年間家賃下落率の推定(%、上昇トレンドならマイナス値),
  "stayYears": 平均入居期間の推定(年),
  "vacancyMonths": 退去後の平均空室期間の推定(月),
  "loanRatePct": 投資用不動産ローンの当初変動金利の相場(%),
  "rateSlopePctPerYear": 変動金利の年間上昇ペース推定(%ポイント/年),
  "priceTrendPct": 中古物件価格の年間変動率推定(%、下落ならマイナス),
  "exitYieldPct": 同種中古物件の期待利回り・キャップレートの推定(%),
  "reikinMonths": 礼金の相場(家賃の月数、慣習がなければ0),
  "renewalOwnerMonths": 更新料のうち貸主受取分の相場(家賃の月数、慣習がなければ0),
  "adMonths": 募集広告料(AD)の相場(家賃の月数),
  "mgmtPct": 賃貸管理委託料の相場(家賃比%),
  "restorationCostYen": 退去時原状回復費の貸主負担平均(円),
  "repairInflPct": 修繕・内装工事費の年間上昇率の推定(%),
  "summary": "根拠の要約(250字以内)",
  "sources": ["参照した情報源名1", "情報源名2"]
}`;

// JWTからユーザーを特定
async function getUser(req) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return { open: true }; // 認証未設定 = 開発モード

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

// プラン確認+クオータ消費(service roleで実行)
async function checkAndCountQuota(userId) {
  const url = process.env.SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!svc) return { error: "サーバー設定(SERVICE_ROLE_KEY)が不足しています", status: 500 };
  const h = { apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json" };

  const pr = await fetch(
    `${url}/rest/v1/profiles?id=eq.${userId}&select=plan,ai_used,ai_month`, { headers: h });
  const rows = await pr.json();
  const p = Array.isArray(rows) ? rows[0] : null;
  if (!p) return { error: "プロファイルが見つかりません", status: 403 };
  if (p.plan !== "pro") return { error: "AI市場調査はProプラン限定です", status: 403 };

  const ym = new Date().toISOString().slice(0, 7);
  const used = p.ai_month === ym ? p.ai_used : 0;
  if (used >= AI_PER_MONTH) {
    return { error: `今月のAI調査回数(${AI_PER_MONTH}回)を使い切りました。翌月1日にリセットされます`, status: 429 };
  }
  await fetch(`${url}/rest/v1/profiles?id=eq.${userId}`, {
    method: "PATCH", headers: h,
    body: JSON.stringify({ ai_used: used + 1, ai_month: ym }),
  });
  return { ok: true };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POSTのみ受け付けます" });
  const { area, ptype } = req.body || {};
  if (!area || !ptype) return res.status(400).json({ error: "area と ptype が必要です" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "サーバーに ANTHROPIC_API_KEY が未設定です" });

  // 認証+クオータ(Supabase設定時のみ強制)
  const who = await getUser(req);
  if (who.error) return res.status(who.status).json({ error: who.error });
  if (!who.open) {
    const q = await checkAndCountQuota(who.userId);
    if (q.error) return res.status(q.status).json({ error: q.error });
  }

  let messages = [{ role: "user", content: buildPrompt(area, ptype) }];
  try {
    // pause_turn/JSON未出力に備え、最大5回継続要求
    for (let attempt = 0; attempt < 5; attempt++) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
          max_tokens: 2000,
          messages,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
        }),
      });
      const data = await r.json();
      if (data.error) return res.status(502).json({ error: data.error.message || "上流APIエラー" });

      const text = (data.content || [])
        .filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        try { return res.status(200).json(JSON.parse(m[0])); } catch (e) { /* 続行 */ }
      }
      messages = [...messages, { role: "assistant", content: data.content }];
      if (data.stop_reason !== "pause_turn") {
        messages.push({
          role: "user",
          content: "追加の検索は不要です。ここまでに得た情報に基づき、最初に指定したJSONオブジェクトのみを出力してください。",
        });
      }
    }
    return res.status(502).json({ error: "複数回試行しましたが構造化データを取得できませんでした" });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
