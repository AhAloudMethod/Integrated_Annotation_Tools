vendor/ … 外部ライブラリの同梱（ネット接続なし・file:// で開いても動くように）

vosk.js
  vosk-browser 0.0.8（https://github.com/ccoreilly/vosk-browser）の dist/vosk.js をそのまま置いたもの。
  Vosk（https://github.com/alphacep/vosk-api）を WebAssembly にしたもの。ライセンスは Apache License 2.0。
  声の認識で「Vosk」を選んだときだけ読み込む（core/voice.js）。
  取得元：https://cdn.jsdelivr.net/npm/vosk-browser@0.0.8/dist/vosk.js

  修正（tools/patch-vosk.js で当てる。元の dist/vosk.js に1回だけ）：
    index.html をファイルとして直接開いた（file://）ページでは、worker の場所に基準の URL がなく、
    またページで作った blob: を worker から fetch できないため、モデルを読み込めない。そこで worker のコードに2か所手を入れた。
    1. モデルの URL の解決：new URL(modelUrl, 基準) が失敗したら、絶対 URL のまま new URL(modelUrl) を使う
    2. 「ah-model:」で始まる URL の fetch は、ページから postMessage({ action: 'ah-model', buffer }) で送られた
       モデルの中身（ArrayBuffer）を返す。core/voice.js はこの方法でモデルを渡す
    vosk-browser を更新するときは、新しい dist/vosk.js を置いて node tools/patch-vosk.js を実行する。

surveyjs/
  SurveyJS Form Library 3.2.8（https://github.com/surveyjs/survey-library）の配布物から，次の 4 つをそのまま置いたもの．
  JSON の定義からアンケートのフォームを表示する．ライセンスは MIT（各ファイルの先頭と package.json に記載）．
  有料なのは別の製品（Survey Creator・Dashboard・PDF Generator）で，ここには含めない．
    survey.core.min.js   … survey-core の本体（グローバルの Survey）
    japanese.min.js      … survey-core/i18n の日本語の文言（locale: 'ja'）
    survey-js-ui.min.js  … survey-js-ui の描画（素の JavaScript 版．jQuery は要らない）
    survey-core.min.css  … 既定のテーマ（外部のフォントや画像を読まない）
  読み込む順は css，survey.core，japanese，survey-js-ui．file:// で開いても動く．
  取得元：npm pack survey-core@3.2.8 survey-js-ui@3.2.8
  更新するときは，同じ 4 つを新しい版に置き換え，ここの版の番号を直す．
