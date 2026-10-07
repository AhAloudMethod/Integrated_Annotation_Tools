// 実験フォルダの検査：npm run exp-check -- <フォルダ（または experiment.json）>
// ブラウザで実験フォルダを開いたときと同じ規則（core/exp-check.js）で、experiment.json と setup.json（あれば）を検査する。
// 参加者ごとの順と、動画ごとの評価区間、誤り・警告を出す。誤りがあれば終了コード 1
const fs = require('fs');
const path = require('path');
const { check, merge, rangeFor } = require('../core/exp-check');

const ROOT = path.resolve(__dirname, '..');
// 方式は index.html が読み込むもの（modes/_shared.js を除く）。表示名は各ファイルの登録（id と同じ行の label）
function modeList() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return [...html.matchAll(/<script src="modes\/(\w+)\.js"><\/script>/g)].map(m => m[1]).filter(id => id !== '_shared').map(id => {
    const src = fs.readFileSync(path.join(ROOT, 'modes', id + '.js'), 'utf8');
    const m = src.match(new RegExp(`id: '${id}'[^\\n]*?label: '([^']*)'`));
    return { id, label: m ? m[1] : id };
  });
}
// 評価軸の組は core/axes.js の SETS のキー
function axesList() {
  const src = fs.readFileSync(path.join(ROOT, 'core', 'axes.js'), 'utf8');
  return [...src.matchAll(/^ {4}(\w+): \{\r?\n {6}label:/gm)].map(m => m[1]);
}

function main(arg) {
  if (!arg) { console.log('使い方：npm run exp-check -- <実験フォルダ>'); return 2; }
  let file = path.resolve(arg);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'experiment.json');
  if (!fs.existsSync(file)) { console.log(`見つかりません：${file}`); return 1; }
  const dir = path.dirname(file);
  const read = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));   // ツールが書き出すファイルは BOM で始まる
  let exp, setup = null;
  try { exp = read(file); } catch (e) { console.log(`experiment.json を JSON として読めません：${e.message}`); return 1; }
  const sf = path.join(dir, 'setup.json');
  if (fs.existsSync(sf)) { try { setup = read(sf); } catch (e) { console.log(`setup.json を JSON として読めません：${e.message}`); return 1; } }
  const modes = modeList();
  const { errors, warnings } = check(exp, { modes: modes.map(m => m.id), axes: axesList(), has: p => fs.existsSync(path.join(dir, p)) && fs.statSync(path.join(dir, p)).isFile() }, setup);
  const cfg = merge(exp, setup);

  console.log(`実験：${(cfg && cfg.name) || '（名前なし）'}（${file}）`);
  console.log(setup ? 'setup.json：あり' : 'setup.json：なし（通常の画面の「実験用の設定を書き出す」で作る）');
  if (cfg && cfg.participants && typeof cfg.participants === 'object') {
    console.log('\n参加者ごとの順（[練] は練習）');
    for (const [pid, ts] of Object.entries(cfg.participants)) {
      if (!Array.isArray(ts)) continue;
      console.log(`  ${pid}: ${ts.map(t => (t && t.practice ? '[練]' : '') + (t ? `${t.mode}/${t.video}` : '?')).join(' → ')}`);
    }
  }
  // 試行で使う動画ごとの評価区間（試行の range が優先）
  if (cfg && cfg.participants && typeof cfg.participants === 'object' && !Array.isArray(cfg.participants)) {
    const used = new Map();
    for (const ts of Object.values(cfg.participants)) if (Array.isArray(ts)) for (const t of ts) if (t && t.video && !t.range && !used.has(t.video)) used.set(t.video, rangeFor(cfg, t));
    if (used.size) {
      console.log('\n動画ごとの評価区間');
      for (const [v, r] of used) console.log(`  ${v}: ${r.edges ? `${r.edges[0]}〜${r.edges[r.edges.length - 1]} 秒（${r.edges.length - 1} 区間）` : r.start != null || r.end != null ? `${r.start ?? 0}〜${r.end ?? '最後'} 秒，${r.bin ?? 1} 秒ごと` : '動画全体，1 秒ごと'}`);
    }
  }
  if (errors.length) { console.log(`\n誤り（${errors.length} 件）`); for (const e of errors) console.log('  - ' + e); }
  if (warnings.length) { console.log(`\n警告（${warnings.length} 件）`); for (const w of warnings) console.log('  - ' + w); }
  console.log(errors.length ? '\n結果：誤りがあります（このままでは実験を始められません）' : warnings.length ? '\n結果：始められます（警告を確かめてください）' : '\n結果：問題ありません');
  return errors.length ? 1 : 0;
}

if (require.main === module) process.exitCode = main(process.argv[2]);
module.exports = { modeList, axesList, main };
