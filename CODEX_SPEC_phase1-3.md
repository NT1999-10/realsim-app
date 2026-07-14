# 現実派 — フェーズ1〜3 実装指示書(Codex向け)

この文書は単独で完結するように書かれている。会話履歴は参照できない前提で、必要な文脈をすべて含む。
**実装前にこの文書を最後まで読むこと。** 特に §0 の禁止事項はすべての作業に優先する。

---

## §0. プロジェクト概要と絶対規則

### 0.1 プロダクト
「現実派 不動産収支シミュレーター」— 金利上昇・家賃下落・空室・修繕・税・売却出口を織り込む不動産投資SaaS。
- アプリ: https://realsim-app.vercel.app (GitHubリポジトリ `realsim-app`)
- LP: https://realsim-lp.vercel.app (リポジトリ `realsim-lp`、静的HTML)

### 0.2 技術スタック(変更禁止)
- Vite + React 18(**JavaScript。TypeScript化禁止**)
- スタイルはすべてインラインstyle + デザイントークン `T`(CSSフレームワーク導入禁止)
- チャート: recharts / 認証+DB: Supabase / 決済: Stripe / ホスティング: Vercel(サーバーレス関数は `api/*.js`)
- AI呼び出しモデルは `claude-sonnet-4-6`。**いかなる理由でも変更しない**(「sonnet-5」等は存在しない)

### 0.3 禁止事項(違反PRは全却下)
1. 依存パッケージのメジャーアップデート、Next.js等への移行、TS化、Prettier一括整形
2. `src/plan.js` のライセンスキー方式フォールバックの削除(Supabase未設定環境の後方互換として意図的に残している)
3. `api/research.js` のJWT検証・Pro確認・月10回クオータの緩和
4. Supabaseの Row Level Security を無効化する変更
5. UI文言の英語化(すべて日本語)
6. 既存ファイルの全面書き換え。**差分は外科的に最小で**
7. 秘密鍵・APIキーをクライアントコードに書くこと(サーバー環境変数のみ)

### 0.4 検証手順(全フェーズ共通)
```bash
npm install && npm run build   # 必ず通ること
```
受け入れテストは各フェーズ末尾に記載。1フェーズ=1PR。フェーズをまたぐ変更を混ぜない。

---

## §1. 既存コードマップ

### 1.1 ファイル構成
```
realsim-deploy/
  index.html            # フォント読込・グローバルCSS(box-sizing, 背景グラデ)
  src/App.jsx           # ★モノリス(~3000行)。全UIと計算エンジン
  src/plan.js           # プラン定義・PURCHASE_URL・ライセンス検証(レガシー)
  src/auth.js           # Supabaseクライアント(authEnabled = 環境変数の有無)
  api/research.js       # AI市場調査プロキシ(JWT→Pro→クオータ→Anthropic)
  api/stripe-webhook.js # 決済→plan自動更新
  api/billing-portal.js # Stripeカスタマーポータル誘導
  api/delete-account.js # サブスク解約→アカウント削除
  supabase/schema.sql   # profiles / user_data(新規構築用フルセット)
  supabase/schema_v2_userdata.sql # 既存環境への追加分
```

### 1.2 App.jsx の主要シンボル(アンカーとして使用可)
- `const T = {...}` — デザイントークン。`T.blue #2D7DD2 / T.teal #2BB8A3 / T.grad(グラデ) / T.real #D14B32(赤) / T.good / T.navy / T.line / T.sub`
- 計算エンジン: `simulate(p, realistic)`(月次420ヶ月ループ→年次配列`{year,income,expense,loanPaid,cf,cum,balance}`)、`computeMetrics(q)`(`{real,total,irr,ccr,dscr,firstDeficitYear,cumFinal,sale}`)、`saleAnalysis`、`exitCurve`、`diagnose(q,m)`
- 時点補助: `valuationNetAt(q,t)` `balanceAt(q,real,t)` `cfAtYear(real,t)`
- ストレージ層: `loadKey(key, fallback)` / `saveKey(key, value, cap)` — **ログイン中はSupabase `user_data`、未ログインはlocalStorage**を自動で使い分ける。新しい永続データは必ずこの層を通すこと。キーは `KEY_RESEARCH / KEY_PROPS / KEY_ACTUALS / KEY_LEADS` + `SYNCED_KEYS`(ログアウト時消去リスト。新キー追加時はここにも追加)
- 共通UI: `Field({label,value,onChange,unit,step,min,hint,help})` `Select` `Section` `Kpi` `cardSt` `h2St` `btnSt(bg)`
- プラン: App内 `const plan` / `isPro`。Pro限定UIは `isPro ? 実UI : <LockCard onUpgrade={...}>ぼかし</LockCard>` パターン(HomeTab内に実例)
- タブ: `[["home","ホーム",true],["sim",...],["cmp",...],["ana",..,isPro],["ops",..,isPro]]`。レンダーは `{tab==="xxx" && isPro && (...)}` 形式(**表示側にもプラン確認を入れるのが本プロジェクトの規約**)
- 検討候補トレイ: `LeadTray` + App側 `leads/addLead/updateLead/deleteLead/simulateLead`(lead形: `{id,addedAt,status,name,url,price(万円),rent(円),memo}`、上限 Free5/Pro50)
- 認証: `supabase`(src/auth.js)。APIへは `Authorization: Bearer <access_token>`。サーバー側検証パターンは `api/billing-portal.js` の `getUser()` をコピーして使う

### 1.3 新規コードの置き場所
- 新しいUI機能は **`src/features/<名前>.jsx` を新設**し、App.jsxからimport(App.jsxの肥大化を止める)。ただし `T` や `Field` 等はApp.jsx内ローカルなので、**最初のPRで次のリファクタを行う**:
  1. `src/theme.js` を新設し `export const T = {...}`(App.jsxの定義を移動)。App.jsxは `import { T } from "./theme.js"` に差し替え
  2. `src/ui.jsx` を新設し `Field / Select / Kpi / cardSt / h2St / btnSt / LockCard` を移動・export。App.jsxはimportに差し替え
  3. ビルドが通り、画面表示が完全に同一であることを確認してからフェーズ1本体に着手

---

## §2. フェーズ1: 指値・入札上限逆算機 + ブックマークレット

### 2.1 機能A: 指値・入札上限逆算機(SashineLab)

**目的**: 「この物件、いくらまでなら買っていいか」を既存エンジンで逆算する。外部データ不要・完全クライアントサイド。

**配置**: シミュレーションタブ内、診断カードの直後に `<SashineLab p={p} isPro={isPro} onUpgrade={...} />`。**Pro限定**(Freeには LockCard でぼかし表示)。

**UI仕様**(`src/features/sashine.jsx`):
- モード切替(2ボタン): 「通常物件の指値」/「競売の入札上限」
- 共通入力: 目標(Select: `IRR ≥ X%` / `月次CF ≥ X円` / `DSCR ≥ X`)、目標値(Field)。デフォルト: 通常=IRR 5% / 競売=IRR 8%
- 競売モード追加入力(Field×4、円): 立退き・占有対応費(既定 500,000)、滞納管理費等の引受(既定 200,000)、取得後修繕費(既定 1,000,000)、その他(登録免許税等・既定 300,000)。注記「競売は仲介手数料が不要な一方、これらの競売特有コストを価格に織り込みます」
- 出力カード: 逆算上限価格(万円・大きく)、現在の売出価格(`p.price`)との乖離%、目標達成時の主要指標(IRR/月次CF/DSCR)、競売モードは「入札額の目安: 上限を10万円単位で切り捨てた額」も併記
- 免責1行: 「逆算値は現在のパラメータ前提に基づく参考値です」

**計算仕様(擬似コード)**:
```js
// 単調性: 価格が上がるほど IRR/CF/DSCR は悪化する → 二分探索で解ける
function solveMaxPrice(p, extraCostsYen, check /* (m, q)=>bool */) {
  let lo = p.price * 0.1, hi = p.price * 2.0;           // 万円
  const q0 = { ...p };
  // 競売特有コストは「価格に上乗せされる一時費用」として downPayment側でなく
  // costsPct を実効化する: costsYen = price*1e4*costsPct/100 + extraCostsYen
  // 既存エンジンを改造しないため、extraCosts を costsPct に換算して渡す:
  const withPrice = (P) => {
    const pctExtra = extraCostsYen > 0 ? (extraCostsYen / (P * 1e4)) * 100 : 0;
    return { ...q0, price: P, costsPct: q0.costsPct + pctExtra };
  };
  if (!check(computeMetrics(withPrice(lo)), withPrice(lo))) return null; // 下限でも不成立
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    check(computeMetrics(withPrice(mid)), withPrice(mid)) ? (lo = mid) : (hi = mid);
  }
  return Math.floor(lo); // 万円
}
// check例: 目標IRR → (m)=> m.irr != null && m.irr >= target
//          月次CF → (m)=> m.real[0].cf / 12 >= targetYen
//          DSCR   → (m)=> m.dscr == null || m.dscr >= target
```
`computeMetrics` はApp.jsxローカルなので、リファクタPRで `src/engine.js` に `simulate/computeMetrics/saleAnalysis/exitCurve/irrOf` を移動・exportし、App.jsxをimportに差し替えてから使うこと(§1.3と同様の等価性確認必須)。

### 2.2 機能B: ブックマークレット(ポータル→トレイ取り込み)

**目的**: ユーザーがSUUMO等の物件ページを開いた状態でワンクリック→検討候補トレイに保存。**一括スクレイピングではなく、ユーザー本人の閲覧ページを本人の操作で1件取り込むだけ**(この設計意図を変更しないこと)。

**構成**:
1. **取り込みURLスキーム**: `https://<app>/?lead=<base64(JSON)>`。JSON形: `{n:名称, u:URL, p:価格万円(数値|null), r:月額家賃円(数値|null)}`。base64はUTF-8対応(`btoa(unescape(encodeURIComponent(...)))`)
2. **App側インテーク**: App.jsxのマウント時useEffectで `location.search` を解析。`lead` があれば decode→`addLead()`(既存の上限メッセージをそのまま利用)→`history.replaceState` でURLを浄化→結果を小さなトースト(3秒で消えるfixed通知、新規実装可)で表示。**未ログインでも動作すること**(トレイはローカル保存で動く)
3. **ブックマークレット生成UI**: LeadTray内に「🔖 ブックマークレットを入手」ボタン→モーダル。中身: (a)ドラッグしてブックマークバーに登録するための `<a href="javascript:...">現実派に保存</a>`、(b)コピー用textarea、(c)使い方3行
4. **抽出ロジック(ブックマークレット内)**: 最小・防御的に。
```js
javascript:(function(){
  var t=document.title.slice(0,60);
  var body=document.body.innerText;
  function yen(re){var m=body.match(re);return m?m[1].replace(/,/g,''):null;}
  var price=yen(/([0-9,]+(?:\.[0-9]+)?)\s*万円/);            // 最初の「◯万円」
  var rent=yen(/(?:賃料|家賃|想定賃料)[^0-9]{0,10}([0-9,]+)\s*円/);
  var d={n:t,u:location.href,p:price?parseFloat(price):null,r:rent?parseInt(rent):null};
  location.href='https://realsim-app.vercel.app/?lead='+
    encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(d)))));
})();
```
サイト別の精緻なセレクタは**実装しない**(HTML変更で壊れ続けるため)。取り込み後にトレイ上で価格・家賃を編集できることが正: モーダル内に「数字が拾えない/ずれる場合は、保存後にトレイで直してください」と明記。

### 2.3 フェーズ1 受け入れテスト
1. リファクタ後、既存全画面が視覚的に同一・ビルド成功
2. 指値: 売出3200万・家賃9.5万の条件で「IRR≥5%」を解くと、返る上限価格の `computeMetrics.irr` が5.0±0.2%
3. 競売モード: 特有コスト合計200万を入れると上限が通常モードより下がる
4. `/?lead=` 付きURLで開くとトレイに1件追加され、URLが浄化され、Free上限(5件)超過時は既存メッセージが出る
5. ブックマークレットをChromeのブックマークバーに登録し、任意の物件ページで実行→トレイに飛ぶ

---

## §3. フェーズ2: 相場照合(国交省 不動産情報ライブラリAPI)

### 3.1 前提
- API: 国土交通省「不動産情報ライブラリ」外部API。**無料・要APIキー**(Web登録)。キーはリクエストヘッダー `Ocp-Apim-Subscription-Key`
- 主要エンドポイント(実装時に必ず公式マニュアル https://www.reinfolib.mlit.go.jp/help/apiManual/ で最新仕様を確認すること。以下は設計時点の理解):
  - `XIT002`: 市区町村一覧 `?area={都道府県コード2桁}` → `{id(市区町村コード), name}`
  - `XIT001`: 不動産取引価格 `?year=YYYY&quarter=1..4&area={都道府県コード}&city={市区町村コード}` → 取引配列(`Type`(中古マンション等/宅地(土地と建物)等), `TradePrice`, `Area`(㎡), `BuildingYear` など)
- **フィールド名が想定と異なる場合はサーバー側でマッピングを吸収し、クライアントの型は変えない**

### 3.2 サーバー実装 `api/market-price.js`
- 環境変数: `MLIT_API_KEY`(README・.env.exampleに追記)
- 認可: `api/billing-portal.js` の `getUser()` パターンでJWT検証。**Pro限定**(profiles.plan確認)。回数制限は不要(APIは無料)だが、1ユーザー30回/日を`user_data`とは別の軽量なメモリMapで簡易制限(ベストエフォートで可)
- 入力: `POST {pref: "13", cityName: "文京区", type: "mansion"|"house"|"land"}`
- 処理:
  1. XIT002で `pref` の市区町村一覧を取得し `cityName` 部分一致でコード解決(一覧はモジュールスコープでメモリキャッシュ、TTL 24h)
  2. 直近8四半期分の XIT001 を順次取得(直列・1秒間隔)。`type` でフィルタ(mansion→"中古マンション等")
  3. 集計して返す: `{count, medianUnitYenPerM2, p25, p75, samples:[{price,area,unit,builtYear,period}](最大50件), city:{code,name}}`。単価 = TradePrice/Area
  4. 結果をSupabase `market_cache` にupsert(下記SQL)。同キーで7日以内ならAPIを叩かずキャッシュ返却
```sql
-- supabase/schema_v3_market.sql(新規ファイル。既存実行者向け差分)
create table public.market_cache (
  key text primary key,          -- pref:city:type
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table public.market_cache enable row level security;
-- クライアント直読みはさせない(service roleのみ)。ポリシーは作らない
```

### 3.3 クライアント `src/features/souba.jsx`
- 配置: シミュレーションタブのSashineLab直後 `<SoubaCheck p={p} isPro onUpgrade />`。Pro限定(LockCard)
- 入力: 都道府県(Select・47件は静的配列をファイル内に定義)、市区町村(テキスト)、種別(Select: 中古マンション/戸建て/土地)、**専有面積㎡**(Field・pに面積パラメータは無いのでここでのみ入力、既定25)
- 「相場を照合する」→ `/api/market-price` をJWT付きPOST
- 出力: 成約 n件(直近2年)/ 中央値単価 / 対象物件の単価(`p.price*1e4/面積`)/ **乖離%を大きく色分け**(±10%以内=緑「相場圏内」、+10〜25%=琥珀「やや割高」、+25%超=赤「割高。指値の根拠になります」、マイナス=青「割安圏。理由の確認を」)/ recharts散布図(x=面積, y=単価, 対象物件を赤点で重ねる)
- 免責: 「成約事例は立地・階数・状態の個別性が大きく、単価比較は参考情報です」
- エラー時: 「市区町村が見つかりません」「データが少なすぎます(n<5)」を明示

### 3.4 フェーズ2 受け入れテスト
1. `MLIT_API_KEY` 未設定時、APIは501と日本語エラーを返し、UIにそのまま表示される
2. 実キーで「東京都・文京区・中古マンション」→ n≥5、中央値が現実的なレンジ(50万〜200万円/㎡)
3. 同条件2回目はキャッシュ応答(サーバーログで外部API未呼び出しを確認)
4. Freeアカウントには結果でなくLockCardが出る。JWT無しの直POSTは401

---

## §4. フェーズ3: 競売ウォッチ(BITクロール+検索+アラート)

### 4.1 法務・運用ゲート(実装より先に確認。満たせなければ§4.7の縮退案へ)
1. BIT(https://www.bit.courts.go.jp)の利用条件・robots.txtを確認し、機械的取得を明示的に禁じる条項がないこと
2. アクセスは **1リクエスト3秒以上の間隔・1実行あたり最大50ページ・深夜帯(JST 2-5時)・UA `RealSimBot/1.0 (+運営者メール)`**
3. 3点セットPDFは**保存せずBITへのリンクのみ**保持
4. 取得失敗・構造変化時は静かにスキップしログに残す(リトライ爆撃をしない)

### 4.2 スキーマ `supabase/schema_v4_auction.sql`
```sql
create table public.auction_items (
  id text primary key,                -- 裁判所コード+事件番号+物件番号
  court text, case_no text, item_no int,
  pref text, city text, address text,
  type text,                          -- マンション/戸建て/土地/その他
  min_price bigint,                   -- 売却基準価額(円)
  deposit bigint,                     -- 買受申出保証額(円)
  bid_start date, bid_end date, open_date date,  -- 入札期間・開札日
  built_year int, floor_area numeric, land_area numeric,
  bit_url text not null,
  active boolean not null default true,
  first_seen timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.auction_items (pref, type, active);
create index on public.auction_items (bid_end);
alter table public.auction_items enable row level security;
-- 読み取りはAPI経由のみ(service role)。ポリシーは作らない
```

### 4.3 同期 `api/auction-sync.js` + Vercel Cron
- `vercel.json` を新設: `{"crons":[{"path":"/api/auction-sync","schedule":"0 18 * * *"}]}`(UTC18時=JST翌3時)
- 認可: `Authorization: Bearer ${CRON_SECRET}`(Vercel Cronは自動付与。環境変数 `CRON_SECRET` 追加)。不一致は401
- 処理: 対象都道府県(環境変数 `AUCTION_PREFS` 例 `"東京都,神奈川県,埼玉県,千葉県"`)ごとにBITの検索結果を取得→パース→`auction_items` にupsert。今回の走査で見つからなかった既存activeレコードは `active=false`
- パーサは `api/_bit-parser.js` に分離し、**HTML構造への依存点を1ファイルに閉じ込める**。実装時に実レスポンスを取得して確認すること(BITは検索フォームPOST/動的読み込みの可能性がある。fetchで再現できない場合は§4.7へ)
- 1実行の所要が10秒制限を超える場合: 都道府県を1回のcronで1つずつ巡回(`market_cache` に進捗カーソルを保存)する設計に変更してよい

### 4.4 一覧API `api/auction-list.js`
- JWT検証+**Pro限定**。入力: `{pref?, type?, maxPrice?, sort?("bid_end"|"min_price"), page?}`
- service roleで `auction_items` を検索(active=true、bid_end>=今日)。50件/ページ
- 併せて `user_data` の `auction-seen`(既読の最大first_seen)と比較できるよう、各itemに `isNew`(first_seenが7日以内)を付けて返す

### 4.5 クライアント `src/features/auction.jsx` — 新タブ「競売」
- タブ配列に `["auc","競売",isPro]` を「運用管理」の後ろに追加。レンダーガードも既存規約通り
- UI:
  1. 検索条件(都道府県・種別・上限価格)。条件は `saveKey("auction-search")` で保存
  2. 結果カード: 住所(市区まで)・種別・**売却基準価額**・入札期間・開札日・「NEW」バッジ・「BITで3点セットを見る↗」リンク
  3. 各カードのボタン: 「入札上限を計算」→ 種別と基準価額をシミュレーションに流し(`setP` price=基準価額/1e4, タブをsimへ)、SashineLabの競売モードへ誘導 / 「フォロー」→ `saveKey("auction-follow")` に追加し、**入札開始・終了・開札日を既存EventCalendarに自動表示**(EventCalendarにprops `extraEvents` を追加し、App側でfollowから生成して渡す)
  4. 3点セットチェックリスト(静的コンポーネント): 占有者の有無/引渡命令の要否/滞納管理費/境界・越境/再建築可否/内覧不可前提の修繕予備費 — 各項目にチェックボックス(保存不要、印刷用)
- 免責: 「競売には引渡し・占有・瑕疵のリスクがあり、3点セットの精読と現地確認が不可欠です」

### 4.6 フェーズ3 受け入れテスト
1. `CRON_SECRET` 不一致で401。一致で同期が走り `auction_items` に行が入る
2. 同期2回目で重複せずupsert、消えた物件が `active=false` になる
3. 競売タブ: Freeはタブ自体がロック挙動(既存の分析タブと同一)。検索→結果→BITリンクが正しく開く
4. フォローした物件の開札日がイベントカレンダーに出る
5. 1リクエスト間隔≥3秒がコードで保証されている(sleep実装をレビューで確認)

### 4.7 縮退案(BITの機械取得が規約・技術で不可の場合)
クローラを断念し、**手動インポート運用**に切り替える: `api/auction-import.js`(管理者専用: `ADMIN_EMAILS` 環境変数のメールのみ許可)にCSVをPOST→upsert。運営者が週2回、BITから手動エクスポート/転記したCSVを流す。UI(§4.5)はそのまま使える。この判断は実装者が§4.1の確認結果に基づき行い、PR説明に確認結果を記載すること。

---

## §5. 環境変数まとめ(追加分)
| 変数 | フェーズ | 用途 |
|---|---|---|
| `MLIT_API_KEY` | 2 | 不動産情報ライブラリAPIキー |
| `CRON_SECRET` | 3 | cron認可 |
| `AUCTION_PREFS` | 3 | 巡回対象都道府県(カンマ区切り) |
| `ADMIN_EMAILS` | 3縮退 | 手動インポート許可者 |

`.env.example` と `README.md` のセットアップ手順(Supabase SQLの実行ファイル名を含む)を各フェーズで必ず更新すること。

## §6. 実装順(厳守)
1. **PR#0**: theme/ui/engineの分離リファクタ(§1.3・§2.1)。**機能変更ゼロ・見た目同一**
2. **PR#1**: SashineLab → **PR#2**: ブックマークレット+インテーク
3. **PR#3**: market-price API+SQL → **PR#4**: SoubaCheck UI
4. **PR#5**: auctionスキーマ+sync(または縮退版import) → **PR#6**: 競売タブUI+カレンダー連携

各PRで `npm run build` 成功と受け入れテスト結果をPR説明に記載すること。
