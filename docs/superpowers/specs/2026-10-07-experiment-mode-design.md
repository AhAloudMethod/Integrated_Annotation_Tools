# 実験モードの設計

## 目的

参加者内で複数の入力方式を比べる実験に，このツールをそのまま使えるようにする．参加者が選べる要素を減らし，各試行のタスク遂行時間を測る．

## 合意した要件

- 参加者内の比較である．1 人の参加者が複数の方式を，設定ファイルで決めた順に使う．
- 実験者は，`experiment.json` と動画を入れたフォルダを起動時に 1 回だけ選ぶ（`<input webkitdirectory>`）．`file://` のまま動く．
- タスク遂行時間は，参加者が「開始」を押してから「完了」を押すまでとする．
- 参加者から隠すもの：ID・方式・動画を開く，設定パネル全体，評価区間・グラフ・説明，書き出し．音声入力・見返し・別ウィンドウは，設定ファイルで許したときだけ出す．
- 各方式の前に練習動画の試行を置ける（`"practice": true`）．練習も記録し，本番と区別する．

## 仮定（ユーザの異議なし）

- 完了を押すと確認を出し，書き出してから入力をロックし，次の試行へ進む．
- 未入力の区間が残っていても完了を拒まない．未入力の数は要約に残す．
- 方式のパネル内の設定（カスタムの設計，顔・軌跡などの切り替え，評価する軸）も設定ファイルで決め，欄を隠す．
- 実験者は Ctrl+Shift+E で実験モードを抜ける（確認つき）．
- 試行の後のアンケート（追加の要望）：`survey` に URL のひな形を書くと，完了の後に「アンケートを開く」を出し，開くまで「次へ」を出さない．練習には既定で出さない．
- 時間の内訳は操作ログから計算する．

## 設定ファイル

```json
{
  "name": "exp2",
  "settings": { "axes": "va", "rate": 1, "f0": false, "timeline": false },
  "range": { "start": 0, "bin": 1 },
  "participants": {
    "P01": [
      { "mode": "excel", "video": "practice.mp4", "practice": true },
      { "mode": "excel", "video": "a.mp4", "options": {}, "settings": { "review": true } }
    ]
  }
}
```

- `settings` の項目と既定値（書いていない項目は既定値．参加者のブラウザに残った値は使わない）：
  `axes`（va），`rate`（1），`afterWrite`（hold），`graphEdit`（true），`grid`（false），`f0`（true），`listen`（false），`timeline`（false），`videoSize`（55），`padJoy`（true），`padSlider`（true），`padSquare`（true），`review`（false），`voice`（false），`videoWindow`（false）．
- 試行の `settings` は全体の `settings` を上書きする．`options` は方式の設定（`S.meta.options`）に重ねる．
- `range` は `start`，`end`（省くと動画の最後），`bin`，`label` を持つ．試行ごとの `range` が全体の `range` を上書きする．
- 読み込み時に検査する：JSON の形，方式 id，動画がフォルダにあるか，同じ参加者の中で方式と動画の組が重複しないか（自動保存のキーが衝突するため）．

## 画面と状態

試行ごとに `ready → running → done` と進む．

- `ready`：全画面の覆いに「開始」を出す．キー・マウス・ゲームパッドのボタン 0 は効かない．
- `running`：覆いを外す．ヘッダーには再生の操作，時刻，記録ボタン，進行（「2 / 4 練習」など），「完了」だけを出す．操作ログに `task_start` を残す．
- `done`：「完了」の確認で，書き込みを確定し，停止し，操作ログに `task_end` を残し，書き出す．覆いに「次へ」を出す．最後の試行なら全試行の要約 `<ID>_<name>_trials.csv` を書き出す．

再読み込みなどで中断したときは，実験者がフォルダを選び直すと，終えていない最初の試行から始まる．途中の試行は自動保存から再開でき，`task_start` があれば `running` から続く．

設定を当てるときは各欄の既存の処理を使い，ブラウザに保存される値は実験モードを抜けるとき（とページを閉じるとき）に元へ戻す．

## 記録

- 書き出しのファイル名に試行の番号を入れる：`<ID>_t01p_<動画>_<方式>…`（p は練習）．
- `meta.experiment`：実験名，試行の番号，練習か，当てた設定，要約．
- 要約の列：`trial, practice, mode, video, start_iso, end_iso, task_ms, play_ms, review_ms, n_play, n_seek, n_undo, n_redo, n_strokes, n_events, bins, filled_v, filled_a, n_restore`．
- 進行（終えた試行と要約）は localStorage の `ahann_exp:<name>:<ID>` に残す．

## テスト

`tests/experiment.test.js`：フォルダの読み込みと検査，隠す要素，開始前に入力が効かないこと，開始から完了までの時間と書き出し，次の試行への切り替えと設定の適用，抜けたときに設定が戻ること．
