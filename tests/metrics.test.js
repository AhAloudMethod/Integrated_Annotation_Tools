// 行動指標の集計（tools/collect/metrics.js）：区間ごとの方式・連続の方式の指標，最終的な値の時系列，割り付けとの照合，実験名ごとの出力
// ブラウザを使わない．手で書いた小さな操作ログを試行の zip にして，日本語を含むパス（tests/out/行動指標テスト/）で確かめる
const fs = require('fs');
const path = require('path');
const { OUT } = require('./_env');
const { makeZip } = require('../core/zip');
const { csvParse } = require('../tools/collect/lib');
const { run } = require('../tools/collect/metrics');

let failed = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? ' ' + info : ''}`); if (!ok) failed++; };
const near = (x, y, tol = 1e-6) => x !== '' && x != null && Math.abs(+x - y) <= tol;

const ROOT = path.join(OUT, '行動指標テスト');
fs.rmSync(ROOT, { recursive: true, force: true });
const fresh = name => { const d = path.join(ROOT, name); fs.mkdirSync(d, { recursive: true }); return d; };

// 実験フォルダ exp の データ/<pid>/annotator/ に試行の zip を作る．
// o：{ pid, exp, trial（0 始まり）, practice, condition, mode, options, range, duration, log, data, csvs（{ 'bins.csv': 本文 }）, redo }
function makeTrial(exp, o) {
  const pid = o.pid || 'P01', name = o.exp || 'exp2', mode = o.mode || 'excel';
  const base = `${pid}_t${String(o.trial + 1).padStart(2, '0')}${o.practice ? 'p' : ''}_v_${mode}`;
  const ex = { name, participant: pid, trial: o.trial, n_trials: 4, practice: !!o.practice, condition: o.condition || '', start_iso: '2026-11-20T01:00:00.000Z', end_iso: `2026-11-20T01:0${o.trial + 1}:00.000Z` };
  if (o.redo) ex.redo = { n: o.redo };
  const meta = { mode, participant: pid, video_file: o.video || 'v.mp4', duration: o.duration || 4, options: o.options || {}, range: o.range || { start: 0, count: 4, bin: 1, target: 4 }, experiment: ex };
  const files = Object.entries(o.csvs || {}).map(([suf, text]) => ({ name: `${base}_${suf}`, data: text }));
  files.push({ name: `${base}_session.json`, data: JSON.stringify({ meta, data: o.data || { points: {}, strokes: [], cells: { v: [], a: [] } }, log: o.log || [] }) });
  const dir = path.join(exp, 'データ', pid, 'annotator');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${base}${o.redo ? `_redo${o.redo}` : ''}.zip`);
  fs.writeFileSync(file, Buffer.from(makeZip(files.map(f => ({ name: f.name, data: Buffer.from(f.data, 'utf8') })))));
  return file;
}
const L = (wall_ms, type, extra = {}) => ({ wall_ms, video_t: extra.video_t ?? 0, type, axis: extra.axis || '', value: extra.value ?? '', detail: extra.detail || '' });
const readCsv = file => { const [head, ...rows] = csvParse(fs.readFileSync(file, 'utf8')).filter(r => r.length > 1 || r[0] !== ''); return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]]))); };
const outDir = (exp, name) => path.join(exp, 'データ', '行動指標', name);

// ---------- 1. 区間ごとの方式（Excel） ----------
const discreteLog = [
  L(10, 'range', { detail: JSON.stringify({ start: 0, count: 4, bin: 1, label: 'countdown', target: 4, edges: [0, 1, 2, 3, 4] }) }),
  L(1000, 'task_start'),
  L(1000, 'play'), L(3000, 'pause'),
  L(3500, 'cell_focus', { axis: 'v', detail: 'bin 0 via=click' }),
  L(4000, 'cell_input', { axis: 'v', value: 5, detail: 'bin 0 (0:00) prev=-' }),
  L(4000, 'cell_focus', { axis: 'v', detail: 'bin 1 via=key' }),
  L(5000, 'cell_input', { axis: 'v', value: 6, detail: 'bin 1 (0:01) prev=-' }),
  L(5000, 'cell_blur', { axis: 'v', detail: 'bin 1' }),
  L(5200, 'play'), L(5700, 'pause'),
  L(5800, 'seek', { video_t: 0.5, detail: 'from 2.0000' }),
  L(6000, 'cell_focus', { axis: 'v', detail: 'bin 0 via=click' }),
  L(6100, 'cell_blur', { axis: 'v', detail: 'bin 0' }),            // 表の作り直し：blur と rebuild の focus の組は選び直しにしない
  L(6100, 'cell_focus', { axis: 'v', detail: 'bin 0 via=rebuild' }),
  L(7000, 'cell_input', { axis: 'v', value: 7, detail: 'bin 0 (0:00) prev=5' }),
  L(8000, 'cell_clear', { axis: 'v', value: '', detail: 'bin 1 (0:01) prev=6' }),
  L(8500, 'cell_input', { axis: 'v', value: 4, detail: 'bin 1 (0:01) prev=-' }),
  L(8800, 'listen_pause', { detail: 'sec=2' }),
  L(9000, 'graph_down', { axis: 'v', detail: 't=2.5000' }),
  L(9400, 'graph_cells', { axis: 'v', value: '3 3', detail: 'bins 2 3 prev - -' }),
  L(10000, 'graph_draw', { axis: 'a', detail: '0.000-1.500' }),
  L(11000, 'graph_draw', { axis: 'a', detail: '1.000-2.000' }),
  L(11500, 'undo'),
  L(13000, 'task_end'),
];
const exp = fresh('実験A');
fs.writeFileSync(path.join(exp, 'experiment.json'), JSON.stringify({ name: 'exp2', participants: { P01: [
  { mode: 'excel', condition: 'A', video: 'v.mp4' }, { mode: 'excel', condition: 'C', video: 'v.mp4' },
] } }));
makeTrial(exp, { trial: 0, condition: 'A', log: discreteLog,
  csvs: { 'bins.csv': 'bin,label,t_start,t_end,valence,arousal\r\n0,0:00,0.000,1.000,7,\r\n1,0:01,1.000,2.000,4,\r\n2,0:02,2.000,3.000,3,\r\n3,0:03,3.000,4.000,0,\r\n' } });
makeTrial(exp, { trial: 1, condition: 'B', log: [L(0, 'task_start'), L(1000, 'cell_input', { axis: 'v', value: 5, detail: 'bin 0 (0:00)' }), L(2000, 'task_end')] });   // 記録を足す前のログ（prev= が無い）
makeTrial(exp, { trial: 2, condition: 'S', mode: 'sam', log: [L(0, 'task_start'), L(1000, 'task_end')] });   // 対象外の方式

// ---------- 2. 連続の方式（DARMA．ジョイスティック） ----------
const strokes = [
  { id: 0, source: 'gamepad', axes: 'va', t_start: 0, t_end: 2, after: 'hold', wall_ms_start: 1500, wall_ms_end: 3500, samples: [[0, 5, 5], [0.5, 6, 5], [1, 7, 5], [1.5, 6.2, 5], [2, 6.2, 5]] },
  { id: 1, source: 'gamepad', axes: 'va', t_start: 1, t_end: 3, after: 'hold', wall_ms_start: 4500, wall_ms_end: 6500, samples: [[1, 5, 5], [2, 8, 5], [3, 8, 5]] },
];
const vAt = t => (t < 0.5 - 1e-4 ? 5 : t < 1 - 1e-4 ? 6 : t < 2 - 1e-4 ? 5 : 8);
const hz = 'frame,t,valence,arousal\r\n' + Array.from({ length: 241 }, (_, f) => `${f},${(f / 60).toFixed(4)},${vAt(f / 60)},5`).join('\r\n') + '\r\n';
const contLog = [L(0, 'task_start'), L(1000, 'play'), L(3500, 'seek', { video_t: 1, detail: 'from 2.0000' }), L(5000, 'pause'), L(6000, 'undo'), L(8000, 'task_end')];
makeTrial(exp, { exp: 'kohai', trial: 0, condition: 'joy', mode: 'darma', log: contLog, data: { points: {}, strokes, cells: { v: [], a: [] } }, csvs: { '60hz.csv': hz } });

const r = run(exp, { keepHead: 0, sway: 0.5, still: 0.5 });
const problems = fs.readFileSync(path.join(outDir(exp, 'exp2'), 'problems.txt'), 'utf8');

// 区間ごとの方式
{
  const tr = readCsv(path.join(outDir(exp, 'exp2'), 'trials.csv')), t = tr.find(x => x.trial === '1');
  check('試行の表：遂行時間・再生時間・それ以外の時間', t && t.task_ms === '12000' && t.play_ms === '2500' && t.other_ms === '9500', JSON.stringify(t));
  check('試行の表：入力 8 回，修正入力 3 回（値を直した・消した・なぞりの描き直し），undo 1 回で修正回数の合計 4', t.n_inputs === '8' && t.n_correction_inputs === '3' && t.n_undo === '1' && t.n_corrections === '4', JSON.stringify(t));
  check('試行の表：評価区間 4 秒，動画 1 秒あたりの判断時間 2.375 秒と修正 1 回', t.range_s === '4' && near(t.judge_s_per_video_s, 2.375) && near(t.corrections_per_video_s, 1), JSON.stringify(t));
  check('試行の表：後ろ向きのシーク 1 回・1.5 秒', t.n_seek_back === '1' && near(t.seek_back_s, 1.5), JSON.stringify(t));
  check('試行の表：提示順と方式の分類', t.order === '1' && t.family === 'discrete' && t.condition === 'A', JSON.stringify(t));
  const ins = readCsv(path.join(outDir(exp, 'exp2'), 'inputs.csv')).filter(x => x.trial === '1');
  check('入力の表：8 行，最初の入力だけに印', ins.length === 8 && ins.map(x => x.is_first).join('') === '10000000', JSON.stringify(ins.map(x => x.is_first)));
  const fix = ins[2];
  check('入力の間隔：そのまま 2000，再生 500 を引いて 1500，間の巻き戻し 1 回', fix.interval_raw_ms === '2000' && fix.interval_ms === '1500' && fix.play_between_ms === '500' && fix.seek_back_between === '1', JSON.stringify(fix));
  check('入力にかかった時間：クリックから（作り直しの組を挟んでも最初のクリックから）', ins[0].select_ms === '500' && fix.select_ms === '1000' && fix.via === 'click', JSON.stringify([ins[0], fix]));
  check('Enter で移った入力は別の列', ins[1].select_ms === '' && ins[1].key_ms === '1000' && ins[1].via === 'key', JSON.stringify(ins[1]));
  check('修正の判定：直した・消した・なぞりの描き直しだけ', ins.map(x => x.is_correction).join('') === '00110001', ins.map(x => x.is_correction).join(''));
  check('入力の時間帯：区間の番号を区切りで直す', ins[0].t_start === '0' && ins[0].t_end === '1' && ins[5].t_start === '2' && ins[5].t_end === '4', JSON.stringify([ins[0], ins[5]]));
  check('グラフの入力にかかった時間：graph_down から 400', ins[5].select_ms === '400' && ins[5].listen_ms === '600', JSON.stringify(ins[5]));
  check('中央値は最初の入力を除く', near(t.median_interval_raw_ms, 1000), t.median_interval_raw_ms);
  const sec = readCsv(path.join(outDir(exp, 'exp2'), 'seconds.csv')).filter(x => x.trial === '1');
  check('1 秒平均：_bins.csv から，発声なし（0）と空欄は値に入れない', sec.length === 4 && sec.map(x => x.valence).join(' ') === '7 4 3 ' && sec.map(x => x.covered_v).join(' ') === '1 1 1 0' && sec[0].arousal === '' && sec[0].covered_a === '0', JSON.stringify(sec));
  check('記録を足す前のログは problems.txt に書く', /t02.*記録を足す前/.test(problems), problems);
  check('対象外の方式は problems.txt に書く', /t03.*sam/.test(problems), problems);
  check('割り付けとの照合：条件の食い違いを書く', /t02.*条件.*B.*C/.test(problems), problems);
  check('割り付けとの照合：割り付けに無い試行を書く', /t03.*割り付けに無い/.test(problems), problems);
}

// 連続の方式
{
  const pk = fs.readFileSync(path.join(outDir(exp, 'kohai'), 'problems.txt'), 'utf8');
  const t = readCsv(path.join(outDir(exp, 'kohai'), 'trials.csv'))[0];
  check('実験名ごとに出力を分ける', !!t && t.condition === 'joy' && t.family === 'continuous' && !fs.readFileSync(path.join(outDir(exp, 'exp2'), 'trials.csv'), 'utf8').includes('joy'));
  check('連続：記録 2 回・4 秒，録り直し 1 回・1 秒', t.n_recordings === '2' && near(t.recorded_s, 4) && t.n_rerecord === '1' && near(t.rerecord_s, 1), JSON.stringify(t));
  check('連続：揺れ 1 回（0.25 回/秒），動かした量 5.8（1.45/秒）', t.n_sway === '1' && near(t.sway_per_s, 0.25) && near(t.movement, 5.8) && near(t.movement_per_s, 1.45), JSON.stringify(t));
  check('連続：修正回数の合計＝録り直し＋undo', t.n_corrections === '2', JSON.stringify(t));
  const rec = readCsv(path.join(outDir(exp, 'kohai'), 'recordings.csv'));
  check('記録の表：2 行，2 件目が録り直し', rec.length === 2 && rec[0].is_rerecord === '0' && rec[1].is_rerecord === '1' && near(rec[1].overlap_s, 1) && rec[1].wall_ms_start === '4500', JSON.stringify(rec));
  check('止めていた時間の割合（0.5 秒の窓で幅 0.5 以下）', near(rec[0].still_ratio, 0.25, 0.03) && near(rec[1].still_ratio, 0.75, 0.03), JSON.stringify(rec.map(x => x.still_ratio)));
  const sec = readCsv(path.join(outDir(exp, 'kohai'), 'seconds.csv'));
  check('最終的な値：後の記録で上書きした時系列の 1 秒平均', sec.length === 4 && near(sec[0].valence, 5.5, 0.02) && near(sec[1].valence, 5, 0.02) && near(sec[2].valence, 8, 0.02) && near(sec[3].valence, 8, 0.02), JSON.stringify(sec.map(x => x.valence)));
  check('覆われた割合：どの記録にも入っていない秒は 0', near(sec[2].covered_v, 1, 0.02) && near(sec[3].covered_v, 0, 0.02), JSON.stringify(sec.map(x => x.covered_v)));
  check('作った時系列と _60hz.csv が合えば problems.txt に書かない', !/食い違/.test(pk), pk);
}

// ---------- 3. 録り直しの始めを残す（--keep-head） ----------
{
  const e2 = fresh('実験B');
  makeTrial(e2, { exp: 'kohai', trial: 0, mode: 'darma', log: contLog, data: { points: {}, strokes, cells: { v: [], a: [] } }, csvs: { '60hz.csv': hz } });
  fs.mkdirSync(path.join(e2, 'ツール'), { recursive: true });
  fs.writeFileSync(path.join(e2, 'ツール', '設定.json'), JSON.stringify({ metrics: { keepHead: 0.6 } }));
  run(e2, {});
  const sec = readCsv(path.join(outDir(e2, 'kohai'), 'seconds.csv'));
  // 1〜1.6 秒は前の値（1〜1.5：7，1.5〜1.6：6.2），1.6〜2 秒は新しい記録の値 5
  check('設定.json の keepHead：録り直しの始め 0.6 秒は前の値を残す', near(sec[1].valence, 0.5 * 7 + 0.1 * 6.2 + 0.4 * 5, 0.03), sec[1].valence);
  const pk = fs.readFileSync(path.join(outDir(e2, 'kohai'), 'problems.txt'), 'utf8');
  check('keepHead が 0 でないときは _60hz.csv と照合しない', !/食い違/.test(pk), pk);
}

// ---------- 4. 同じ試行のやり直しは新しい方を採る．参加者のデータを git に入れない ----------
{
  const e3 = fresh('実験C');
  makeTrial(e3, { trial: 0, log: [L(0, 'task_start'), L(1000, 'task_end')] });
  makeTrial(e3, { trial: 0, redo: 1, log: [L(0, 'task_start'), L(3000, 'task_end')] });
  run(e3, {});
  const tr = readCsv(path.join(outDir(e3, 'exp2'), 'trials.csv'));
  check('やり直した試行は新しい回だけ', tr.length === 1 && tr[0].task_ms === '3000', JSON.stringify(tr));
  const gi = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
  check('.gitignore で zip と行動指標の出力を除く', /^\/tools\/collect\/\*\.zip$/m.test(gi) && /^データ\/$/m.test(gi), '');
}

console.log(r && r.written ? `written ${r.written.length}` : '');
console.log('errors:', failed ? failed + ' failed' : 'none');
process.exitCode = failed ? 1 : 0;
