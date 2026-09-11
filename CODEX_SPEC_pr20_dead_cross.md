# CODEX_SPEC — デッドクロスの判定と表示を追加する

## 目的

減価償却が切れた年に税が急に増え、手元の収支が悪化する「デッドクロス」を、アプリで見えるようにする。

今のアプリは、税の計算が初期設定でオフで、信号機診断にも税や償却を見る条件が無い。そのため、築古木造アパートのように短期間で償却が切れる物件でも警告が出ない。

## 方針（変えない前提）

- **税の計算の初期設定はオフのまま**。画面に出ている収支・IRR・総合損益などの数値は1円も変えない
- 判定は、税の計算がオフでも、裏で限界税率を使って税を計算して行う
- 「元金返済＞減価償却費」の年は、低金利の区分マンションではほぼ1年目に成立するので、**警告には使わない**（年次明細に数字を出すだけ）
- 警告（黄）の条件：**分析期間内・ローン返済中に償却が切れ、それによって増える税が当初の年間家賃の10%以上**

## 範囲

**`src/engine.js` の末尾への関数追加と、`src/App.jsx` の7箇所の置換だけを行う。**

- `src/engine.js` の既存の行（1〜178行）は1文字も変更しない
- `src/App.jsx` は、下の7箇所以外を変更しない。3100行を超える一枚岩だが、分割やリファクタは禁止
- 他のファイルを作成・変更しない（下の検証用スクリプトは /tmp に作り、コミットしない）

スクリーンショットは不要です。ブラウザでの画面確認も不要です。

---

## 1. `src/engine.js`：ファイル末尾（178行目の閉じ括弧の後）に、空行1つを挟んで追加

```js
// ---------- デッドクロス ----------
// 税の計算がオフでも、限界税率で税を計算して判定する(画面に出す収支の数値は変えない)。
// depEndYear: 減価償却費が初めて0になる年(分析期間内に無ければ null)
// taxIncrease: その年に償却が無くなったことで増える税額(円/年)
// rentShare: taxIncrease ÷ 当初の年間家賃
export function deadCrossInfo(q) {
  const taxed = simulate({ ...q, taxOn: true }, true);
  const depAnnual = taxed[0].dep;
  const crossRow = taxed.find((r) => r.loanPaid - r.interestPaid > r.dep);
  const endRow = taxed.find((r, i) => i > 0 && r.dep === 0 && taxed[i - 1].dep > 0);
  let taxIncrease = null, rentShare = null;
  if (endRow) {
    const base = endRow.income - endRow.expense - endRow.interestPaid; // 償却が無い年の課税所得
    const f = (x) => (q.lossOffset ? x : Math.max(0, x));
    taxIncrease = (f(base) - f(base - depAnnual)) * (q.taxRate / 100);
    rentShare = q.rent > 0 ? taxIncrease / (q.rent * 12) : null;
  }
  const deficitRow = taxed.find((r) => r.cf < 0);
  return {
    depAnnual,
    crossYear: crossRow ? crossRow.year : null,
    depEndYear: endRow ? endRow.year : null,
    taxIncrease, rentShare,
    afterTaxDeficitYear: deficitRow ? deficitRow.year : null,
  };
}
```

既存の `simulate` をそのまま呼ぶだけで、`simulate` 自体は変更しない。

## 2. `src/App.jsx`：7箇所の置換

各「変更前」は `src/App.jsx` 内にちょうど1回だけ出現する。

### 2-1. 10行目：import に deadCrossInfo を追加

変更前:

```jsx
import { simulate, computeMetrics, saleAnalysis, exitCurve, irrOf } from "./engine.js";
```

変更後:

```jsx
import { simulate, computeMetrics, saleAnalysis, exitCurve, irrOf, deadCrossInfo } from "./engine.js";
```

### 2-2. diagnose 関数：早期赤字の警告の直後にデッドクロスの判定を追加

変更前:

```jsx
  if (m.firstDeficitYear && m.firstDeficitYear <= 5 && monthly1 >= 0 && !goodOverall)
    warns.push(`${m.firstDeficitYear}年目という早期に単年赤字へ転落します。運営初期段階での持ち出しに備える必要があります`);
```

変更後:

```jsx
  if (m.firstDeficitYear && m.firstDeficitYear <= 5 && monthly1 >= 0 && !goodOverall)
    warns.push(`${m.firstDeficitYear}年目という早期に単年赤字へ転落します。運営初期段階での持ち出しに備える必要があります`);
  // デッドクロス: ローン返済中に償却が切れ、増える税が当初家賃の1割以上なら注意喚起(税の計算がオフでも判定する)
  const dc = deadCrossInfo(q);
  if (dc.depEndYear && dc.depEndYear <= q.loanYears && dc.rentShare != null && dc.rentShare >= 0.1)
    warns.push(`${dc.depEndYear}年目に減価償却が切れ、税が年約${fmtMan(dc.taxIncrease)}増えます(当初家賃の${Math.round(dc.rentShare * 100)}%)。ローン返済が続く中で手元の収支が一段悪化する「デッドクロス」です${q.taxOn ? "" : `。限界税率${q.taxRate}%での試算で、税の計算をオンにすると年次明細で確認できます`}`);
```

### 2-3. メイン画面：diag の useMemo の直後に deadCross を追加

変更前:

```jsx
  const diag = useMemo(() => diagnose(p, metricsAll), [p, metricsAll]);
```

変更後:

```jsx
  const diag = useMemo(() => diagnose(p, metricsAll), [p, metricsAll]);
  const deadCross = useMemo(() => deadCrossInfo(p), [p]);
```

### 2-4. KPIカード：「単年CF初赤字」の直後に「償却切れ(デッドクロス)」を追加

変更前:

```jsx
          <Kpi label="単年CF初赤字" value={firstDeficit ? `${firstDeficit.year}年目` : "なし"}
               color={firstDeficit ? T.warnInk : T.good} />
```

変更後:

```jsx
          <Kpi label="単年CF初赤字" value={firstDeficit ? `${firstDeficit.year}年目` : "なし"}
               color={firstDeficit ? T.warnInk : T.good} />
          <Kpi label="償却切れ(デッドクロス)"
               value={deadCross.depEndYear ? `${deadCross.depEndYear}年目` : "期間内なし"}
               color={deadCross.depEndYear && deadCross.depEndYear <= p.loanYears && deadCross.rentShare >= 0.1 ? T.warnInk : T.ink}
               sub={deadCross.depEndYear
                 ? `税 +${fmtMan(deadCross.taxIncrease)}/年(限界税率${p.taxRate}%)`
                 : deadCross.depAnnual > 0 ? `償却は${p.simYears}年の分析期間中続きます` : "減価償却の設定がありません"} />
```

### 2-5. 年次明細表：見出しに「元金」「償却」を追加

変更前:

```jsx
                    {["年", "金利", "収入", "経費", "返済", p.taxOn ? "税" : null, "単年CF", "累積CF", "残債"]
```

変更後:

```jsx
                    {["年", "金利", "収入", "経費", "返済", "元金", "償却", p.taxOn ? "税" : null, "単年CF", "累積CF", "残債"]
```

### 2-6. 年次明細表：償却が切れる年の年数セルに印を付ける

変更前:

```jsx
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{r.year}</td>
```

変更後:

```jsx
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{r.year === deadCross.depEndYear ? "償却切れ " : ""}{r.year}</td>
```

### 2-7. 年次明細表：返済のセルの直後に元金・償却のセルを追加

変更前:

```jsx
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{fmtMan(r.loanPaid)}</td>
```

変更後:

```jsx
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{fmtMan(r.loanPaid)}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{fmtMan(r.loanPaid - r.interestPaid)}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{fmtMan(r.dep)}</td>
```

---

## 完了条件（Codexが判定する）

### ビルドと変更範囲

- `npm run build` が成功する
- `git diff --stat main` に出るのは `src/engine.js` と `src/App.jsx` の2ファイルだけ
- `git diff main -- src/engine.js | grep -c '^-[^-]'` が 0（既存行の削除・変更なし）
- `git diff --numstat main -- src/engine.js` の追加行数が 27、削除行数が 0
- `git diff --numstat main -- src/App.jsx` の追加行数が 17、削除行数が 4

### 件数

| コマンド | 期待値 |
|---|---|
| `grep -c "export function deadCrossInfo" src/engine.js` | 1 |
| `grep -oF "deadCrossInfo" src/App.jsx \| wc -l` | 3 |
| `grep -oF "rentShare >= 0.1" src/App.jsx \| wc -l` | 2 |
| `grep -oF '"返済", "元金", "償却",' src/App.jsx \| wc -l` | 1 |
| `grep -oF "償却切れ(デッドクロス)" src/App.jsx \| wc -l` | 1 |

### 数値の検証（一時スクリプト。コミットしない）

リポジトリ直下で次を実行する。

```bash
git show main:src/engine.js > /tmp/old_engine.mjs
mkdir -p /tmp/dccheck
cat > /tmp/dccheck/check.mjs <<'JS'
import { simulate, deadCrossInfo } from "REPO/src/engine.js";
import * as old from "/tmp/old_engine.mjs";
import { DEMO_PROPERTY_PARAMS as d } from "REPO/src/demoData.js";
const same = JSON.stringify(simulate(d, true)) === JSON.stringify(old.simulate(d, true))
  && JSON.stringify(simulate(d, false)) === JSON.stringify(old.simulate(d, false));
const s = deadCrossInfo(d);
const w = deadCrossInfo({ ...d, price: 5000, rent: 400000, bldgRatio: 70, depYears: 4, loanYears: 25, simYears: 25, saleMode: "yield" });
console.log(JSON.stringify({ same, sample: [s.crossYear, s.depEndYear], wood: [w.depEndYear, Math.round(w.taxIncrease), w.rentShare] }));
JS
sed -i "s#REPO#$(pwd)#g" /tmp/dccheck/check.mjs
node /tmp/dccheck/check.mjs
```

出力が次の1行と完全に一致すること。

```
{"same":true,"sample":[1,null],"wood":[5,2625000,0.546875]}
```

- `same: true` … 既存の `simulate` の計算結果が変わっていない
- `sample` … サンプル物件は1年目から元金＞償却だが、償却は分析期間内に切れない
- `wood` … 築古木造（建物70%・償却4年）では5年目に償却が切れ、税が年2,625,000円増える（当初家賃の54.7%）

## 人間がプレビューで確認すること（Codexは判定しない）

- KPIカードの「単年CF初赤字」の右に「償却切れ(デッドクロス)」が出る。サンプル物件では「期間内なし」
- サンプル物件の信号機診断は、今までと同じ黄で、文言も変わらない
- 詳細モードで 物件価格5000万円・家賃40万円・建物割合70%・残存償却年数4年・返済期間25年・分析期間25年 にすると黄になり、「5年目に減価償却が切れ、税が年約263万円増えます(当初家賃の55%)…」が出る
- 詳細モードの年次明細に「元金」「償却」の列が増え、償却が切れる年に「償却切れ」の印が付く
