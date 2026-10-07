// 実験フォルダの検査（core/exp-check.js と npm run exp-check）。ブラウザは使わない
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { out } = require('./_env');
const { modeList, axesList } = require('../tools/exp-check');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
const TOOL = path.join(__dirname, '..', 'tools', 'exp-check.js');

// 実験フォルダを作る（動画は中身の無いファイル。検査はファイルがあるかだけを見る）
function folder(name, cfg, videos) {
  const dir = out(name);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  for (const v of videos) fs.writeFileSync(path.join(dir, v), '');
  fs.writeFileSync(path.join(dir, 'experiment.json'), JSON.stringify(cfg, null, 1));
  return dir;
}
const run = dir => { const r = spawnSync(process.execPath, [TOOL, dir], { encoding: 'utf8' }); return { code: r.status, text: r.stdout + r.stderr }; };

const M = ['excel', 'sam', 'emujoy', 'feeltrace'], V = ['a.mp4', 'b.mp4', 'c.mp4', 'd.mp4'];
// 直交する 2 つのラテン方格（方式の順と動画の順）。どの位置にもどの方式・動画も 1 回ずつ、方式と動画の組も 1 回ずつ
const LM = [[0, 1, 2, 3], [1, 0, 3, 2], [2, 3, 0, 1], [3, 2, 1, 0]];
const LV = [[0, 1, 2, 3], [2, 3, 0, 1], [3, 2, 1, 0], [1, 0, 3, 2]];
const balanced = Object.fromEntries(LM.map((row, p) => [`P0${p + 1}`, row.flatMap((m, k) => [
  { mode: M[m], video: 'practice.mp4', practice: true }, { mode: M[m], video: V[LV[p][k]] }])]));

{
  check('方式の一覧は index.html の読み込み順で、表示名も取れる', modeList().length === 15 && modeList()[0].id === 'key' && modeList().find(m => m.id === 'change').label.startsWith('変化ボタン'), JSON.stringify(modeList().map(m => m.id)));
  check('評価軸の組は core/axes.js から取る', JSON.stringify(axesList()) === '["va","pana","thayer"]', JSON.stringify(axesList()));
}
{
  const r = run(folder('expc_ok', { name: 'ok', participants: balanced }, [...V, 'practice.mp4']));
  check('釣り合った順は誤りも警告も無く、終了コード 0', r.code === 0 && r.text.includes('問題ありません') && !r.text.includes('警告'), r.text);
  check('参加者ごとの順を出す（練習に [練] を付ける）', r.text.includes('P01: [練]excel/practice.mp4 → excel/a.mp4 → [練]sam/practice.mp4'));
}
{
  // 全員が同じ順で、方式と動画の組も固定。練習も無い参加者がいる
  const same = Object.fromEntries([1, 2, 3, 4].map(p => [`P0${p}`, M.map((m, k) => ({ mode: m, video: V[k] }))]));
  same.P01 = [{ mode: 'excel', video: 'practice.mp4', practice: true }, ...same.P01];
  const r = run(folder('expc_skew', { name: 'skew', participants: same }, [...V, 'practice.mp4']));
  check('偏った順は警告を出すが、始められる（終了コード 0）', r.code === 0 && r.text.includes('本番の 1 番目に現れる方式が偏っています（excel 4，sam 0') && r.text.includes('方式「excel」と組む動画が偏っています')
    && r.text.includes('P02：本番の前に練習が無い方式があります') && r.text.includes('始められます'), r.text);
}
{
  const r = run(folder('expc_err', { participants: { P01: [{ mode: 'nosuch', video: 'x.mp4' }] }, settings: { axes: 'xyz' } }, []));
  check('誤りがあれば一覧を出し、終了コード 1', r.code === 1 && r.text.includes('name（実験名）がありません') && r.text.includes('方式「nosuch」はありません') && r.text.includes('動画「x.mp4」')
    && r.text.includes('axes は va・pana・thayer'), r.text);
  const r2 = run(out('expc_none'));
  check('experiment.json が無ければ終了コード 1', r2.code === 1 && r2.text.includes('見つかりません'), r2.text);
}
console.log('ERRORS: none');
