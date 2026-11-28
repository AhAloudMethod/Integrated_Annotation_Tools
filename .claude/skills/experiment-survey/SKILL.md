---
name: experiment-survey
description: あアラウド アノテーションツール（Ahnotation）の実験で，参加者が Ahnotation の画面の中で答えるアンケート（SurveyJS の定義 JSON）を作る・直す．自作の設問，同梱の NASA-TLX・Raw TLX，Google フォームからの移行（tools/gform）を扱い，experiment.json の survey・finalSurvey につないで npm run exp-check で誤りが無くなるまで直す．「アンケートを作って」「試行の後に NASA-TLX を入れて」「Google フォームのアンケートを移して」「設問を足して」などで使う．Use when creating or editing in-page questionnaires (SurveyJS definitions) for the Ahnotation's experiment mode.
---

# 画面の中のアンケートを作る

実験モードの試行の後（`survey`）と実験の後（`finalSurvey`）に，Ahnotation の画面に重ねて出すアンケートを作る．仕組みと回答の形は README の「画面の中のアンケート」と「Google フォームから移す」の節にある．作ったら必ず `npm run exp-check -- <実験フォルダ>` で検査し，誤りが無くなるまで直す．

README・`core/`・`tools/` は，リポジトリの中で使うならリポジトリの直下のものを，無ければ（claude.ai で使うとき）この skill のフォルダの中の `ahnotation/` にあるものを使う．`ahnotation/` を使うときは，`npm run exp-check -- <フォルダ>` の代わりに `node ahnotation/tools/exp-check.js <フォルダ>` を，`node tools/gform/convert.js` の代わりに `node ahnotation/tools/gform/convert.js` を実行する．

`experiment.json` の参加者・試行の順・カウンターバランスは skill `experiment-config` が扱う．この skill は，アンケートの定義と，`survey`・`finalSurvey` の要素だけを書く．

## 手順

1. **聞き取る**．足りない項目だけを聞く．
   - いつ答えるか：各試行の後（`survey`），実験の後に 1 回（`finalSurvey`），特定の試行だけ（試行の `survey`）．
   - 何を聞くか：同梱の雛形（下の表），自作の設問，Google フォームから移す，のどれか（組み合わせてよい）．
   - 自作なら設問の文・答え方・段階の数と両端のラベル．研究で引用する尺度（SUS など）は，文言の出典をユーザに確かめ，渡された文言をそのまま使う．Claude が訳を作らない．
2. **定義を書く**．実験フォルダの `surveys/<名前>.json` に SurveyJS の定義を書く（下の「書き方」）．Google フォームから移すときは「Google フォームから移す」の手順で作る．
3. **experiment.json につなぐ**．`survey`・`finalSurvey` を配列にし，`{ "form": "surveys/<名前>.json", "label": "…" }` か `{ "builtin": "nasa-tlx" }` を足す．URL のアンケートと混ぜてよい．既にある項目は消さない．
4. **検査する**．`npm run exp-check -- <実験フォルダ>` で誤りと警告を確かめ，誤りが無くなるまで直す．
5. **確かめてもらう**．ユーザに，Ahnotation で実験フォルダを開き，試しの参加者で 1 試行を終えてアンケートの見た目と答え方を確かめるよう頼む．zip の `<…>_survey.csv` に回答が入ることもそこで確かめる．
6. **報告する**．作ったファイル，つないだ場所，既定を当てた点（必須・7 段階），必須でない設問，警告を伝える．

## 同梱の雛形

| `builtin` | 中身 | 回答に足す行 |
|---|---|---|
| `nasa-tlx` | 6 尺度の評定（20 個の枠，5〜100）と一対比較 15 組（順は無作為） | `variant`（weighted），`raw_tlx`，`<尺度>_tally`，`<尺度>_weight`，`overall` |
| `raw-tlx` | 6 尺度の評定だけ | `variant`（raw），`raw_tlx` |

同じ試行に同じ雛形を 2 回出すとき（試行の後と実験の後など）は，`id` を付け分けて回答の `survey` 列で区別できるようにする．

## 書き方

定義は SurveyJS の JSON（`pages` の配列か `elements` の配列）である．書いていない項目には Ahnotation が既定を当てる．

- **必須が既定**：`isRequired` を書かなければ必須になる．任意の設問にだけ `"isRequired": false` を書く．
- **段階の評定は 7 段階が既定**：`"type": "rating"` で `rateMax` などを書かなければ 1〜7．両端のラベル `minRateDescription`・`maxRateDescription` は必ず書く（無いと警告）．
- **name**：回答の表の `question` 列になる．半角英数字と `_` で，内容が分かる名前にする（`ease`，`sus_01` など）．重複は誤りになる．
- **複数の項目に同じ段階で答える尺度**：`"type": "matrix"`（`rows` に項目，`columns` に段階）にまとめる．回答は `name.行` の行に分かれる．
- **0 も答えになる量**：スライダー（`slider`）ではなく段階の評定にする．スライダーは動かす前もつまみが端に出て，答えたように見えるからである．スライダーは必須でない設問に限って使う．
- **逆転項目**：定義では反転しない．回答は生の値で残し，反転は分析で行う．
- **ページ**：内容のまとまりごとに `pages` を分ける．2 ページ以上なら上端に進み具合が出る．
- **見た目**：`survey/ah-survey.css` が決める．定義に色やテーマを書かない．

```json
{
  "title": "事後アンケート",
  "pages": [
    { "elements": [
      { "type": "rating", "name": "ease", "title": "評価はしやすかったですか。", "minRateDescription": "全くしやすくない", "maxRateDescription": "非常にしやすい" },
      { "type": "matrix", "name": "tool", "title": "ツールについて、次の文にどのくらい当てはまりますか。",
        "columns": [{ "value": 1, "text": "当てはまらない" }, { "value": 2, "text": "どちらでもない" }, { "value": 3, "text": "当てはまる" }],
        "rows": [{ "value": "learn", "text": "操作をすぐに覚えられた" }, { "value": "again", "text": "また使いたい" }] }
    ] },
    { "elements": [
      { "type": "comment", "name": "free", "title": "感想があれば自由に書いてください。", "isRequired": false }
    ] }
  ]
}
```

## Google フォームから移す

1. ユーザに，移すフォームのスクリプト エディタで `tools/gform/export.gs` の `exportForm` を実行してもらい，できた `<フォームの名前>.form-export.json` を実験フォルダなどに置いてもらう（手順は README の「Google フォームから移す」）．
2. `node tools/gform/convert.js <書き出した JSON> <実験フォルダ>/surveys/<名前>.json` で定義にする．
3. 出力の「必須でない設問」と「確かめてください」をユーザに伝える．必須にするか，分岐を `visibleIf` で書き直すかはユーザに決めてもらう．
4. name は `q01` から順に振られる．ユーザが望めば，内容の分かる name に書き換える（回答の表の列になるので，実験を始めた後は変えない）．

書き出しの JSON が無く，ユーザが設問の文を貼ったときは，上の「書き方」に沿って定義を手で書く．

## 書かないこと

この skill は配布する．定義や報告の例に，手元の PC のパス，実験フォルダの名前，個人の Google フォームの URL を書かない．例は `<実験フォルダ>` のような置き場所にする．
