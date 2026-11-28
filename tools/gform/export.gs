// Google フォームの設問を JSON に書き出す Apps Script．書き出した JSON は tools/gform/convert.js で SurveyJS の定義（画面の中のアンケート）にする．
// 使い方（README の「Google フォームから移す」）：
//   1. 移したいフォームを開き，右上の「︙」→「スクリプト エディタ」を開く
//   2. このファイルの中身を貼り付けて保存し，関数 exportForm を実行する（初回は権限を許可する）
//   3. マイドライブに「<フォームの名前>.form-export.json」ができるので，ダウンロードする
// フォームに紐づかない場所で実行するときは，下の FORM_ID にフォームの ID（編集用の URL の /d/ と /edit の間）を入れる．
// 回答は読まない．設問の種類・文・選択肢・段階の範囲と両端のラベル・必須かどうかだけを書き出す
const FORM_ID = '';

function exportForm() {
  const form = FORM_ID ? FormApp.openById(FORM_ID) : FormApp.getActiveForm();
  const items = form.getItems().map(readItem);
  const out = {
    format: 'ahnotation-gform-export',
    version: 1,
    title: form.getTitle(),
    description: form.getDescription(),
    shuffle: form.getShuffleQuestions(),
    quiz: form.isQuiz(),
    items: items,
  };
  const name = (form.getTitle() || 'form') + '.form-export.json';
  const file = DriveApp.createFile(name, JSON.stringify(out, null, 1), MimeType.PLAIN_TEXT);
  Logger.log('書き出しました：' + file.getUrl());
}

function readItem(item) {
  const t = item.getType(), T = FormApp.ItemType;
  const base = { type: String(t), title: item.getTitle(), help: item.getHelpText() };
  const req = it => ({ required: it.isRequired() });
  const choices = it => it.getChoices().map(function (c) { return c.getValue(); });
  // 分岐（回答に応じたページの移動）は移せないので，あったことだけを残す
  // （分岐を設定していない選択肢は移動の種類が空で返るので，空と「次へ進む」は分岐に数えない）
  const branch = it => it.getChoices().some(function (c) {
    try { const nav = c.getPageNavigationType(); return !!c.getGotoPage() || (nav != null && nav !== FormApp.PageNavigationType.CONTINUE); } catch (e) { return false; }
  });
  switch (t) {
    case T.MULTIPLE_CHOICE: { const it = item.asMultipleChoiceItem(); return Object.assign(base, req(it), { choices: choices(it), other: it.hasOtherOption(), branch: branch(it) }); }
    case T.CHECKBOX: { const it = item.asCheckboxItem(); return Object.assign(base, req(it), { choices: choices(it), other: it.hasOtherOption() }); }
    case T.LIST: { const it = item.asListItem(); return Object.assign(base, req(it), { choices: choices(it), branch: branch(it) }); }
    case T.SCALE: { const it = item.asScaleItem(); return Object.assign(base, req(it), { lower: it.getLowerBound(), upper: it.getUpperBound(), leftLabel: it.getLeftLabel(), rightLabel: it.getRightLabel() }); }
    case T.GRID: { const it = item.asGridItem(); return Object.assign(base, req(it), { rows: it.getRows(), columns: it.getColumns() }); }
    case T.CHECKBOX_GRID: { const it = item.asCheckboxGridItem(); return Object.assign(base, req(it), { rows: it.getRows(), columns: it.getColumns() }); }
    case T.TEXT: return Object.assign(base, req(item.asTextItem()));
    case T.PARAGRAPH_TEXT: return Object.assign(base, req(item.asParagraphTextItem()));
    case T.DATE: return Object.assign(base, req(item.asDateItem()));
    case T.TIME: return Object.assign(base, req(item.asTimeItem()));
    case T.DATETIME: return Object.assign(base, req(item.asDateTimeItem()));
    case T.DURATION: return Object.assign(base, req(item.asDurationItem()));
    case T.RATING: { const it = item.asRatingItem(); return Object.assign(base, req(it), { level: it.getRatingScaleLevel() }); }
    default: return base;   // PAGE_BREAK・SECTION_HEADER・IMAGE・VIDEO など（答える欄が無い）
  }
}
