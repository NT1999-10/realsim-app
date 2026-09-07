# 指示書: UIの修正5点 (PR#14)

対象: `realsim-app`。ブランチ `agent/pr14-ui-fixes` を新規に切って作業する。

前提: PR#11 の **PR-B（`src/ui.jsx` の書き換え）がマージ済み**であること。実機で確認して見つかった不具合と読みにくさの修正。

**PR#11 の PR-C 以降には着手しないこと。** 本PRは `src/App.jsx` に触れるため、PR-C を開始する前にマージする。

---

## 1. 数字の書体を差し替える（0 が読みにくい）

現在 `T.mono` に指定している **JetBrains Mono はゼロにドットが入る字形**で、金額や年数の 0 が汚れて見える。ドットもスラッシュも無い素直な字形の **Roboto Mono** に差し替える。

### `src/theme.js`

```js
mono: '"Roboto Mono",ui-monospace,SFMono-Regular,Menlo,monospace',
```

### `index.html`

`<head>` のフォント読み込みから `JetBrains+Mono:wght@400;500;700` を削り、`Roboto+Mono:wght@400;500;700` を入れる。他のファミリー（Noto Serif JP / Zen Kaku Gothic New）はそのまま。

```html
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@600;700&family=Zen+Kaku+Gothic+New:wght@400;500;700;900&family=Roboto+Mono:wght@400;500;700&display=swap" rel="stylesheet">
```

`JetBrains` という文字列がリポジトリ全体から消えることを確認する（`CODEX_SPEC_*.md` と `CODEX_REF_yomu_lp.html` は過去の記録なので除外してよい）。

---

## 2. 「楽観とのギャップ」のKPIが2行に折り返す

`+1,445万円` が2行に割れている。`Kpi` の flex-basis が 145px と狭く、数値が26pxになったため収まらない。

### `src/ui.jsx` の `Kpi`

- カードの `flex` を `"1 1 145px"` → **`"1 1 172px"`** にする
- 数値（`value`）の要素に **`whiteSpace: "nowrap"`** を追加する
- ラベル（`label`）の要素にも `whiteSpace: "nowrap"` を追加する

`sub`（補足文）は折り返してよい。ここには `nowrap` を入れないこと。

---

## 3. `?` の解説をポップオーバーにする（セルの高さを変えない）

現在は解説文がセルの中に展開されるため、開いた瞬間にそのセルだけ縦に伸び、グリッド全体の高さが変わる。**周囲のレイアウトに影響しない、上に浮くポップオーバー**に変更する。

### `src/ui.jsx` の `Field`

構造を次のように変える。外側を `<div style={{ position: "relative" }}>` にし、`<label>` はラベル文言と入力欄だけを包む。解説は `<label>` の外に絶対配置で置く（`<label>` の内側に置くと、解説文をクリックしただけで入力欄にフォーカスが移ってしまうため）。

```jsx
export function Field({ label, value, onChange, unit, step = 1, min, hint, help }) {
  const [showHelp, setShowHelp] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!showHelp) return;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setShowHelp(false);
    };
    const onEsc = (e) => { if (e.key === "Escape") setShowHelp(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [showHelp]);

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <label style={{ display: "block" }}>
        {/* ラベル行（? ボタンを含む）と入力欄。既存の実装をそのまま使う */}
      </label>

      {help && showHelp && (
        <div style={{
          position: "absolute", zIndex: 60, top: "100%", left: 0, marginTop: 6,
          width: 272, maxWidth: "min(272px, 76vw)",
          background: "#FFFFFF", border: `1px solid ${T.line2}`,
          borderRadius: T.rS, boxShadow: T.sh2, padding: "12px 14px",
          fontSize: 12.5, lineHeight: 1.85, color: T.ink, fontWeight: 500,
        }}>{help}</div>
      )}
    </div>
  );
}
```

- `useRef` と `useEffect` を `react` の import に追加する
- `?` ボタンは `type="button"` のまま。`onClick` で `setShowHelp(!showHelp)`、`e.preventDefault()` と `e.stopPropagation()` を両方呼ぶ
- **画面の右端にあるセルでポップオーバーが切れないこと。** 切れる場合は、そのセルが最終列のときだけ `left: "auto", right: 0` に切り替える（`getBoundingClientRect` で判定してよい）
- `hint`（枠の下の小さな補足文）は今までどおりインラインのままでよい

同じ `?` の仕組みを `Select` にも持たせる必要はない。現状 `Select` に `help` は渡っていない。

---

## 4. 「市区町村」だけ書体と枠が違う

`src/features/souba.jsx` の市区町村は、そのファイル固有の `inputStyle`（L39付近）を使った素の `<input>` で、`Field` / `Select` と枠・角丸・文字サイズが揃っていない。

### `src/ui.jsx` に `TextField` を追加する

`Field` と同じラベル書式・枠・フォーカスリングを持つ、**テキスト入力用**のコンポーネントを新設する。数値ではないので **mono にしない・右寄せにしない**。

```jsx
export function TextField({ label, value, onChange, placeholder, hint }) {
  // ラベル: Field と同一（fontSize 13.5 / fontWeight 700 / color T.ink）
  // 枠:     Field と同一（border 1.5px T.line2 / borderRadius T.rS / フォーカスで T.teal + リング）
  // 入力:   fontFamily は継承（sans）、fontSize 15、textAlign は left
}
```

### 置き換える箇所

| ファイル | 場所 | 現在 |
|---|---|---|
| `src/features/souba.jsx` | 市区町村 | 独自 `inputStyle` の `<input type="text">` |
| `src/App.jsx` L2774付近 | AI市場調査「対象エリア」 | `inputStyle` |
| `src/App.jsx` L2779付近 | AI市場調査「物件タイプ」 | `inputStyle` |

置き換え後、`src/features/souba.jsx` の `const inputStyle`（L39付近）は未使用になるので削除する。`src/App.jsx` L2600付近の `const inputStyle` は L3061 でまだ使われているので**残す**。

`src/features/lead-intake.jsx` の `inputStyle` は本PRの対象外。触らないこと。

---

## 5. 「建物管理費・修繕積立金」のラベルが2行になる

ラベルが11文字あり、グリッドの最小幅150pxに収まらず折り返して、そのセルだけ縦に伸びている。

### `src/App.jsx` L3028付近

`Field` の `label` を **`"管理費・修繕積立金"`** に短くする（`help` と `unit` はそのまま）。

```jsx
<Field label="管理費・修繕積立金" help="区分マンション特有の固定費。…" value={p.bldgFee} … />
```

### `src/App.jsx` の `Section`（L41付近）

パラメータのグリッドの最小幅を上げる。

```js
gridTemplateColumns: "repeat(auto-fit, minmax(164px, 1fr))"
```

同じ `minmax(150px, 1fr)` がかんたん入力（L2741付近）にもあるので、そちらも `164px` に揃える。

**注意:** `src/App.jsx` L396 の `EXPENSE_CATS` に含まれる `"建物管理費・修繕積立金"` は**確定申告CSVの科目名**であり、UIのラベルではない。**変更しないこと。** 変えるのは L3028 の `Field` の `label` だけ。

---

## やらないこと

- `src/engine.js` の変更（計算結果が1円でも変わる変更は却下）
- `src/logo.jsx` と `public/` 配下の変更
- `src/App.jsx` の分割リファクタリング
- `src/features/lead-intake.jsx` の変更
- PR#11 の PR-C / PR-D / PR-E に含まれる作業の先取り
- 新規npmパッケージの追加

---

## 完了条件（Codexが機械的に確認すること）

コマンドを実行し、**結果をPR説明に貼ること**。目視でしか判断できない項目は含まれていない。

- [ ] `npm run build` が成功する
- [ ] `grep -rn 'JetBrains' src/ index.html` が **0件**
- [ ] `git diff --stat` で、変更ファイルが次の5つだけであること
      `src/theme.js` / `index.html` / `src/ui.jsx` / `src/App.jsx` / `src/features/souba.jsx`
- [ ] `git diff src/engine.js` が **空**
- [ ] `git diff src/logo.jsx` が **空**
- [ ] `git diff src/App.jsx | grep EXPENSE_CATS` が **空**（申告CSVの科目名に差分が無い）
- [ ] `git diff src/features/lead-intake.jsx` が **空**
- [ ] `grep -n 'inputStyle' src/features/souba.jsx` が 0件（未使用定義を削除済み）
- [ ] `grep -n 'inputStyle' src/App.jsx` が L2600付近の定義と L3061付近の使用の**2件だけ**
- [ ] `package.json` に差分が無い（新規パッケージを追加していない）
- [ ] `src/ui.jsx` が `useRef` と `useEffect` を import していること
- [ ] `Kpi` に `whiteSpace: "nowrap"` が2か所（label と value）入っていること
- [ ] `minmax(150px` がリポジトリに残っていないこと（`164px` に置換済み）

## 報告すること

PRの説明に次を書く。**スクリーンショットは不要**（撮れないため求めていない）。

1. 上の各コマンドの実行結果
2. 修正5点それぞれについて、**どのファイルの何行目をどう変えたか**の対応表
3. 指示書の記述とリポジトリの実態が食い違っていた箇所（行番号のズレ、想定と違う実装など）
4. 指示どおりに実装できなかった点があれば、その理由と代わりに何をしたか

## 人間がプレビューで確認すること（Codexは判定しない）

Vercelのプレビューリンクで、依頼者が目視で確認する。**Codexはこの節を検証しようとしないこと。**

- 数値の 0 にドットもスラッシュも無い
- 「楽観とのギャップ」が1行に収まっている
- `?` を押してもセルの高さが変わらず、解説が上に浮く
- 外側クリックとEscで解説が閉じる。画面右端でも見切れない
- 「市区町村」「対象エリア」「物件タイプ」の枠と書体が隣と揃っている
- 「管理費・修繕積立金」が1行に収まっている
- 物件価格を変えるとKPIとグラフが再計算される
- 幅390pxで破綻しない
