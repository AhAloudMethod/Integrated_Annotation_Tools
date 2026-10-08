// 実験フォルダの検査（core/exp-check.js と npm run exp-check）。ブラウザは使わない
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { out } = require('./_env');
const { modeList, axesList } = require('../tools/exp-check');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
const TOOL = path.join(__dirname, '..', 'tools', 'exp-check.js');

// 実験フォルダを作る（動画は中身の無いファイル。検査はファイルがあるかだけを見る）。setup は setup.json（ツールの書き出しと同じく BOM つき）
function folder(name, cfg, videos, setup) {
  const dir = out(name);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  for (const v of videos) fs.writeFileSync(path.join(dir, v), '');
  fs.writeFileSync(path.join(dir, 'experiment.json'), JSON.stringify(cfg, null, 1));
  if (setup) fs.writeFileSync(path.join(dir, 'setup.json'), '\uFEFF' + JSON.stringify(setup, null, 2));
  return dir;
}
const run = dir => { const r = spawnSync(process.execPath, [TOOL, dir], { encoding: 'utf8' }); return { code: r.status, text: r.stdout + r.stderr }; };

const M = ['excel', 'sam', 'emujoy', 'feeltrace'], V = ['a.mp4', 'b.mp4', 'c.mp4', 'd.mp4'];
// 直交する 2 つのラテン方格（方式の順と動画の順）。どの位置にもどの方式・動画も 1 回ずつ、方式と動画の組も 1 回ずつ
const LM = [[0, 1, 2, 3], [1, 0, 3, 2], [2, 3, 0, 1], [3, 2, 1, 0]];
const LV = [[0, 1, 2, 3], [2, 3, 0, 1], [3, 2, 1, 0], [1, 0, 3, 2]];
const SETUP = { settings: { grid: false }, videos: Object.fromEntries([...V, 'practice.mp4'].map((v, k) => [v, { start: 0.5 + k, end: 10, bin: 1, duration: 12 }])) };
const balanced = Object.fromEntries(LM.map((row, p) => [`P0${p + 1}`, row.flatMap((m, k) => [
  { mode: M[m], video: 'practice.mp4', practice: true }, { mode: M[m], video: V[LV[p][k]] }])]));

{
  check('方式の一覧は index.html の読み込み順で、表示名も取れる', modeList().length === 15 && modeList()[0].id === 'key' && modeList().find(m => m.id === 'change').label.startsWith('変化ボタン'), JSON.stringify(modeList().map(m => m.id)));
  check('評価軸の組は core/axes.js から取る', JSON.stringify(axesList()) === '["va","pana","thayer"]', JSON.stringify(axesList()));
}
{
  const r = run(folder('expc_ok', { name: 'ok', participants: balanced }, [...V, 'practice.mp4'], SETUP));
  check('釣り合った順と setup.json は誤りも警告も無く、終了コード 0', r.code === 0 && r.text.includes('問題ありません') && !r.text.includes('警告') && r.text.includes('setup.json：あり'), r.text);
  check('動画ごとの評価区間を出す', r.text.includes('a.mp4: 0.5〜10 秒，1 秒ごと') && r.text.includes('practice.mp4: 4.5〜10 秒'));
  const r0 = run(folder('expc_nosetup', { name: 'ok', participants: balanced }, [...V, 'practice.mp4']));
  check('setup.json が無ければ、動画全体で評価するという警告を出す', r0.code === 0 && r0.text.includes('setup.json：なし') && r0.text.includes('動画ごとの評価区間（setup.json の videos）がありません'), r0.text);
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
  // setup.json の誤り：評価区間の無い動画、動画より長い終了、設定の値の型、使えない項目
  const su = { settings: { grid: 'yes', videoSize: 100 }, videos: { 'a.mp4': { start: 0, end: 13, duration: 12 }, 'b.mp4': { edges: [0, 3, 2] } }, other: 1 };
  const r3 = run(folder('expc_setup', { name: 's', participants: { P01: [{ mode: 'excel', video: 'a.mp4' }, { mode: 'sam', video: 'b.mp4' }, { mode: 'key', video: 'c.mp4' }] } }, ['a.mp4', 'b.mp4', 'c.mp4'], su));
  check('setup.json の誤りを出す（評価区間の無い動画・動画より長い終了・edges・値の型・使えない項目）', r3.code === 1 && r3.text.includes('動画「c.mp4」の評価区間がありません') && r3.text.includes('終了（13 秒）が動画の長さ（12 秒）を超えています')
    && r3.text.includes('edges は 2 つ以上の増えていく秒の配列です') && r3.text.includes('grid は true か false です') && r3.text.includes('videoSize は 25〜80 の数です') && r3.text.includes('setup.json の「other」は使えない項目です'), r3.text);
  // survey：URL の文字列・URL か { url, label } の配列・false は通し、空の配列や url の無いものは誤り
  const sv = (survey, t) => run(folder('expc_sv', { name: 'sv', survey, participants: { P01: [{ mode: 'excel', video: 'a.mp4', ...t }] } }, ['a.mp4'], { videos: { 'a.mp4': { start: 0, end: 5 } } }));
  const svOk = [sv('https://x.test/a'), sv(['https://x.test/a', { url: 'https://x.test/b?p={pid}', label: 'SUS' }]), sv(null, { survey: false })];
  check('survey は URL・URL か { url, label } の配列・false を通す', svOk.every(r => r.code === 0), svOk.map(r => r.text).join('\n'));
  const svBad = [sv([]), sv([{ label: 'SUS' }]), sv(['https://x.test/a', 3]), sv(null, { survey: { url: 'https://x.test/a' } })];
  const fin = finalSurvey => run(folder('expc_fin', { name: 'fin', finalSurvey, participants: { P01: [{ mode: 'excel', video: 'a.mp4' }] } }, ['a.mp4'], { videos: { 'a.mp4': { start: 0, end: 5 } } }));
  const finOk = fin(['https://x.test/final?p={pid}', { url: 'https://x.test/f2', label: '最後に' }]), finBad = fin(3);
  check('finalSurvey も survey と同じ規則で検査する', finOk.code === 0 && finBad.code === 1 && finBad.text.includes('全体：finalSurvey は URL の文字列'), finOk.text + finBad.text);
  check('survey の空の配列・url の無いもの・文字列でない要素・配列でないオブジェクトは誤り', svBad.every(r => r.code === 1 && r.text.includes('survey は URL の文字列')), svBad.map(r => r.text).join('\n'));
  // experiment.json の settings・試行の range は setup.json より優先する
  const r4 = run(folder('expc_over', { name: 'o', settings: { grid: true }, participants: { P01: [{ mode: 'excel', video: 'c.mp4', range: { start: 1, end: 5 } }] } }, ['c.mp4'], { videos: { 'a.mp4': { start: 0, end: 5 } } }));
  check('試行の range があれば、setup.json に無い動画でも誤りにしない', r4.code === 0, r4.text);
  const r2 = run(out('expc_none'));
  check('experiment.json が無ければ終了コード 1', r2.code === 1 && r2.text.includes('見つかりません'), r2.text);
}
console.log('ERRORS: none');
