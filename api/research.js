// Vercel Serverless Function: /api/research
// ANTHROPIC_API_KEY は Vercel の環境変数に設定する(クライアントには出ない)

const buildPrompt = (area, ptype) => `あなたは日本の不動産市場アナリストです。ウェブ検索を使って、以下のエリア・物件タイプの賃貸住宅市場データを調査してください。
エリア: ${area}
物件タイプ: ${ptype}

調査観点:
1. このエリアの賃貸住宅の家賃推移(直近数年の年間下落/上昇率)
2. 平均空室期間・平均入居年数の傾向
3. 日銀の金融政策と変動金利型住宅・不動産ローンの今後の金利見通し(年あたり上昇ペース)
4. このエリアの中古物件価格の年間変動率トレンド

回答は以下のJSONオブジェクトのみを返してください。コードブロック記号や前置きは一切不要です。数値は推定でよいので必ず数値で埋めてください。
{
  "rentDeclinePct": 年間家賃下落率の推定(%、上昇トレンドならマイナス値),
  "stayYears": 平均入居期間の推定(年),
  "vacancyMonths": 退去後の平均空室期間の推定(月),
  "rateSlopePctPerYear": 変動金利の年間上昇ペース推定(%ポイント/年),
  "priceTrendPct": 中古物件価格の年間変動率推定(%、下落ならマイナス),
  "summary": "根拠の要約(200字以内)",
  "sources": ["参照した情報源名1", "情報源名2"]
}`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POSTのみ受け付けます" });
  const { area, ptype } = req.body || {};
  if (!area || !ptype) return res.status(400).json({ error: "area と ptype が必要です" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "サーバーに ANTHROPIC_API_KEY が未設定です" });

  let messages = [{ role: "user", content: buildPrompt(area, ptype) }];
  try {
    // pause_turn(検索付き応答の一時停止)とJSON未出力に備え、最大5回継続要求
    for (let attempt = 0; attempt < 5; attempt++) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
          max_tokens: 1500,
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
