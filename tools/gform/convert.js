// Google フォームの書き出し（tools/gform/export.gs が作る .form-export.json）を、画面の中のアンケート（SurveyJS）の定義にする。
// node tools/gform/convert.js <書き出した JSON> [<出力先の JSON>]．出力先を省くと、入力と同じ場所に <フォームの名前>.json を書く。
// 設問の name は q01, q02, … と順に振る（回答の表の question 列になる。分析しやすい名前に書き換えてよい）。
// 必須かどうかはフォームのまま移し、必須でない設問を一覧で知らせる（画面の中のアンケートは書かなければ必須になるので、false を明示する）。
// 移せないもの（分岐、画像・動画、テストの採点、設問の順の入れ替え）は警告に出す
const fs = require('fs');
const path = require('path');
const { lintForm } = require('../../core/exp-check');

const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const text = s => (typeof s === 'string' ? s.trim() : '');

// 書き出し → { form（SurveyJS の定義）, warnings, optional（必須でない設問の name と文）}
function convert(src) {
  if (!src || src.format !== 'ahnotation-gform-export') throw new Error('tools/gform/export.gs で書き出した JSON ではありません');
  const warnings = [], optional = [];
  const pages = [{ name: 'page1', elements: [] }];
  let n = 0, sec = 0, media = 0;
  const page = () => pages[pages.length - 1];
  const add = e => page().elements.push(e);
  for (const it of Array.isArray(src.items) ? src.items : []) {
    const title = text(it.title), help = text(it.help);
    if (it.type === 'PAGE_BREAK') {
      pages.push({ name: `page${pages.length + 1}`, ...(title ? { title } : {}), ...(help ? { description: help } : {}), elements: [] });
      continue;
    }
    if (it.type === 'SECTION_HEADER') {
      add({ type: 'html', name: `section${++sec}`, html: `${title ? `<h3>${escHtml(title)}</h3>` : ''}${help ? `<p>${escHtml(help).replace(/\n/g, '<br>')}</p>` : ''}` });
      continue;
    }
    if (it.type === 'IMAGE' || it.type === 'VIDEO') {
      media++;
      add({ type: 'html', name: `media${media}`, html: `<p>（ここにあった${it.type === 'IMAGE' ? '画像' : '動画'}「${escHtml(title)}」は移していません）</p>` });
      warnings.push(`${it.type === 'IMAGE' ? '画像' : '動画'}「${title}」は移せません。定義に置き場所の文だけを入れました`);
      continue;
    }
    const name = `q${String(++n).padStart(2, '0')}`;
    const q = { name, title: title || name, ...(help ? { description: help } : {}), isRequired: !!it.required };
    const choices = Array.isArray(it.choices) ? it.choices.map(String) : [];
    switch (it.type) {
      case 'MULTIPLE_CHOICE': Object.assign(q, { type: 'radiogroup', choices }, it.other ? { showOtherItem: true } : {}); break;
      case 'CHECKBOX': Object.assign(q, { type: 'checkbox', choices }, it.other ? { showOtherItem: true } : {}); break;
      case 'LIST': Object.assign(q, { type: 'dropdown', choices }); break;
      case 'SCALE': Object.assign(q, { type: 'rating', rateMin: it.lower, rateMax: it.upper },
        text(it.leftLabel) ? { minRateDescription: text(it.leftLabel) } : {}, text(it.rightLabel) ? { maxRateDescription: text(it.rightLabel) } : {}); break;
      case 'RATING': Object.assign(q, { type: 'rating', rateType: 'stars', rateMin: 1, rateMax: it.level || 5 }); break;
      case 'GRID': Object.assign(q, { type: 'matrix', columns: (it.columns || []).map(String), rows: (it.rows || []).map(String) }, it.required ? { isAllRowRequired: true } : {}); break;
      case 'CHECKBOX_GRID':
        Object.assign(q, { type: 'matrixdropdown', rows: (it.rows || []).map(String), columns: [{ name: 'answer', title: '選択', cellType: 'checkbox', choices: (it.columns || []).map(String) }] });
        warnings.push(`「${title}」（チェックボックスのグリッド）は行ごとに複数選ぶ表にしました。見た目を確かめてください`);
        break;
      case 'TEXT': q.type = 'text'; break;
      case 'PARAGRAPH_TEXT': q.type = 'comment'; break;
      case 'DATE': Object.assign(q, { type: 'text', inputType: 'date' }); break;
      case 'TIME': Object.assign(q, { type: 'text', inputType: 'time' }); break;
      case 'DATETIME': Object.assign(q, { type: 'text', inputType: 'datetime-local' }); break;
      case 'DURATION': Object.assign(q, { type: 'text', placeholder: '時:分:秒' }); break;
      default:
        n--;
        warnings.push(`「${title}」の種類（${it.type}）は移せません。飛ばしました`);
        continue;
    }
    if (it.branch) warnings.push(`「${title}」の回答による分岐（ページの移動）は移せません。必要なら SurveyJS の visibleIf で書き直してください`);
    if (!q.isRequired) optional.push(`${name}：${q.title}`);
    add(q);
  }
  if (src.shuffle) warnings.push('フォームの「質問の順序をシャッフルする」は移していません（必要ならページに questionOrder: "random" を書く）');
  if (src.quiz) warnings.push('テスト（採点）の設定は移していません');
  const form = { title: text(src.title) || 'アンケート', ...(text(src.description) ? { description: text(src.description) } : {}),
    ...(pages.length > 1 ? { showProgressBar: 'top' } : {}), pages: pages.filter(p => p.elements.length || p.title) };
  return { form, warnings, optional };
}

function main(argv) {
  const [inFile, outArg] = argv;
  if (!inFile) { console.log('使い方：node tools/gform/convert.js <書き出した JSON> [<出力先の JSON>]'); return 2; }
  let src;
  try { src = JSON.parse(fs.readFileSync(inFile, 'utf8').replace(/^﻿/, '')); } catch (e) { console.log(`読めません：${e.message}`); return 1; }
  let r;
  try { r = convert(src); } catch (e) { console.log(e.message); return 1; }
  const safe = s => s.replace(/[\\/:*?"<>|]/g, '_');
  const outFile = outArg || path.join(path.dirname(inFile), `${safe(r.form.title)}.json`);
  if (fs.existsSync(outFile) && !outArg) { console.log(`${outFile} はすでにあります。出力先を指定してください`); return 1; }
  fs.writeFileSync(outFile, JSON.stringify(r.form, null, 1) + '\n');
  const lint = lintForm(r.form, path.basename(outFile));
  const nq = r.form.pages.reduce((s, p) => s + p.elements.filter(e => e.type !== 'html').length, 0);
  console.log(`書き出しました：${outFile}（${r.form.pages.length} ページ，設問 ${nq} 個）`);
  if (r.optional.length) { console.log('必須でない設問（フォームのまま。必須にするなら isRequired を true に）：'); for (const s of r.optional) console.log(`  ${s}`); }
  const ws = [...r.warnings, ...lint.warnings];
  if (ws.length) { console.log('確かめてください：'); for (const w of ws) console.log(`  - ${w}`); }
  if (lint.errors.length) { console.log('誤り：'); for (const e of lint.errors) console.log(`  - ${e}`); return 1; }
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { convert };
