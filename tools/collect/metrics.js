// 行動指標を出す：データ/<参加者>/annotator/ の試行の zip から，実験名ごとに データ/行動指標/<実験名>/ へ
// trials.csv・inputs.csv（区間ごとの方式）・recordings.csv（連続の方式）・seconds.csv・problems.txt を書く．毎回作り直す．
// node metrics.js <実験フォルダ> [--keep-head 秒] [--sway 幅] [--still 幅] [--yes]．引数が無ければ ツール/設定.json の metrics を使う
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { readTrialZip, csvWrite } = require('./lib');
const { adopt } = require('./aggregate');
const { analyzeTrial } = require('./metrics-calc');

const DEF = { keepHead: 0, sway: 0.5, still: 0.5 };
const KEY = ['participant', 'trial', 'condition', 'video', 'mode', 'order'];
const TRIAL_COLS = [...KEY, 'family', 'range_s', 'task_ms', 'play_ms', 'review_ms', 'other_ms', 'n_seek_back', 'seek_back_s', 'n_undo', 'n_redo',
  'n_corrections', 'judge_s_per_video_s', 'corrections_per_video_s',
  'n_inputs', 'n_correction_inputs', 'median_interval_ms', 'median_interval_raw_ms', 'median_select_ms', 'median_key_ms', 'median_listen_ms',
  'n_recordings', 'recorded_s', 'n_rerecord', 'rerecord_s', 'n_sway', 'sway_per_s', 'movement', 'movement_per_s', 'still_ratio', 'n_click', 'n_delete'];
const INPUT_COLS = [...KEY, 'wall_ms', 'video_t', 'type', 'axis', 'value', 't_start', 't_end', 'is_first', 'interval_ms', 'interval_raw_ms', 'play_between_ms', 'seek_back_between',
  'is_correction', 'select_ms', 'key_ms', 'via', 'listen_ms'];
const REC_COLS = [...KEY, 'id', 'source', 'axes', 't_start', 't_end', 'length_s', 'wall_ms_start', 'wall_ms_end', 'is_rerecord', 'overlap_s', 'n_sway', 'movement', 'still_ratio'];
const SEC_COLS = [...KEY, 'second', 't_start', 't_end', 'valence', 'arousal', 'covered_v', 'covered_a'];

const fmt = x => (x == null || (typeof x === 'number' && !isFinite(x)) ? '' : typeof x === 'boolean' ? (x ? '1' : '0') : typeof x === 'number' ? String(+x.toFixed(4)) : String(x));
const table = (cols, rows) => csvWrite([cols, ...rows.map(r => cols.map(c => fmt(r[c])))]);

// ツール/設定.json の metrics と引数を合わせる（引数が優先）
function options(expDir, cli) {
  const file = path.join(expDir, 'ツール', '設定.json');
  let m = {};
  if (fs.existsSync(file)) {
    try { m = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')).metrics || {}; } catch (e) { throw new Error(`ツール/設定.json を読めません（${e.message}）`); }
  }
  const o = { ...DEF };
  for (const k of Object.keys(DEF)) {
    const v = cli[k] != null ? cli[k] : m[k];
    if (v == null) continue;
    if (typeof v !== 'number' || !isFinite(v) || v < 0) throw new Error(`${k} は 0 以上の数で書いてください（${JSON.stringify(v)}）`);
    o[k] = v;
  }
  return o;
}

// 割り付け（実験フォルダの experiment.json の participants）と照合する
function checkAssignment(expDir, name, trials) {
  const file = path.join(expDir, 'experiment.json');
  if (!fs.existsSync(file)) return ['experiment.json が無いので，割り付けと照合していません'];
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (e) { return [`experiment.json を読めないので，割り付けと照合していません（${e.message}）`]; }
  if (j.name !== name) return [`experiment.json の実験名（${j.name}）がこの実験（${name}）と違うので，割り付けと照合していません`];
  const out = [], P = j.participants || {}, seen = new Map();
  for (const t of trials) {
    const e = (P[t.pid] || [])[t.trial];
    (seen.get(t.pid) || seen.set(t.pid, new Set()).get(t.pid)).add(t.trial);
    if (!e) { out.push(`${t.name}：割り付けに無い試行です`); continue; }
    const diff = (label, a, b) => { if (a !== b) out.push(`${t.name}：割り付けと${label}が違います（zip：${a}，割り付け：${b}）`); };
    diff('方式', t.method, e.mode || '');
    diff('条件', t.condition, e.condition || '');
    diff('練習か', t.practice ? 'はい' : 'いいえ', e.practice ? 'はい' : 'いいえ');
    if (e.video && !e.record) diff('動画', t.video, path.basename(e.video));
  }
  for (const [pid, got] of seen) (P[pid] || []).forEach((_e, i) => { if (!got.has(i)) out.push(`${pid}：割り付けの試行 ${i + 1} の zip がありません`); });
  return out;
}

function run(expDir, cli = {}) {
  expDir = path.resolve(expDir);
  const opts = options(expDir, cli);
  const dataDir = path.join(expDir, 'データ'), unread = [];
  const people = fs.existsSync(dataDir) ? fs.readdirSync(dataDir, { withFileTypes: true }).filter(d => d.isDirectory() && d.name !== '全員分' && d.name !== '行動指標').map(d => d.name) : [];
  const byExp = new Map();
  for (const p of people) {
    const zdir = path.join(dataDir, p, 'annotator');
    if (!fs.existsSync(zdir)) continue;
    for (const f of fs.readdirSync(zdir).filter(n => /\.zip$/i.test(n)).sort()) {
      const t = readTrialZip(path.join(zdir, f));
      if (!t) { unread.push(`${f}（実験モードの zip として読めません）`); continue; }
      const k = t.exp || '名前なし';
      byExp.set(k, [...(byExp.get(k) || []), t]);
    }
  }
  const written = [], summary = [];
  for (const [name, all] of byExp) {
    const skipped = [], trials = adopt(all, skipped);
    const problems = [`設定：keepHead=${opts.keepHead} 秒，sway=${opts.sway}，still=${opts.still}`, ...skipped.map(s => `${s}：使いませんでした`), ...unread.map(s => `${s}：使いませんでした`)];
    // 提示順：参加者ごとに，練習を除いた試行の順番
    const order = new Map();
    for (const pid of new Set(trials.map(t => t.pid))) trials.filter(t => t.pid === pid && !t.practice).sort((a, b) => a.trial - b.trial).forEach((t, i) => order.set(t, i + 1));
    const T = [], I = [], R = [], S = [];
    for (const t of trials) {
      if (t.practice) continue;
      const key = { participant: t.pid, trial: t.trial + 1, condition: t.condition, video: t.video, mode: t.method, order: order.get(t) };
      const r = analyzeTrial(t, opts);
      problems.push(...r.problems);
      if (!r.row) continue;
      T.push({ ...key, ...r.row });
      for (const x of r.inputs) I.push({ ...key, ...x });
      for (const x of r.recordings) R.push({ ...key, ...x });
      for (const x of r.seconds) S.push({ ...key, ...x });
    }
    problems.push(...checkAssignment(expDir, name, trials));
    const out = path.join(dataDir, '行動指標', name);
    try {
      fs.rmSync(out, { recursive: true, force: true });
      fs.mkdirSync(out, { recursive: true });
      const put = (f, text) => { fs.writeFileSync(path.join(out, f), text); written.push(path.join(out, f)); };
      put('trials.csv', table(TRIAL_COLS, T));
      if (I.length) put('inputs.csv', table(INPUT_COLS, I));
      if (R.length) put('recordings.csv', table(REC_COLS, R));
      put('seconds.csv', table(SEC_COLS, S));
      put('problems.txt', '﻿' + problems.join('\r\n') + '\r\n');
    } catch (e) {
      throw new Error(`データ/行動指標/${name}/ を作り直せません（${e.code || e.message}）．Excel などで開いている表を閉じてから，もう一度押してください`);
    }
    summary.push({ name, trials: T.length, problems: problems.length - 1 });
  }
  return { written, summary, unread };
}

async function main() {
  const args = process.argv.slice(2), yes = args.includes('--yes'), cli = {};
  const num = flag => { const i = args.indexOf(flag); return i >= 0 ? Number(args[i + 1]) : null; };
  for (const [flag, k] of [['--keep-head', 'keepHead'], ['--sway', 'sway'], ['--still', 'still']]) { const v = num(flag); if (v != null) cli[k] = v; }
  const expDir = args.find((a, i) => !a.startsWith('--') && !['--keep-head', '--sway', '--still'].includes(args[i - 1]));
  try {
    if (!expDir) throw new Error('実験フォルダを指定してください（node metrics.js <実験フォルダ>）');
    const r = run(expDir, cli);
    if (!r.summary.length) console.log('集計する結果がありません．先に 1_結果を集める.bat で結果を集めてください．');
    for (const s of r.summary) console.log(`${s.name}：${s.trials} 試行の行動指標を データ/行動指標/${s.name}/ に出しました．${s.problems ? `確かめることが ${s.problems} 件あります（problems.txt）．` : ''}`);
  } catch (e) {
    console.log(`行動指標を出せませんでした：${e.message}`);
    process.exitCode = 1;
  }
  if (!yes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise(r => rl.question('Enter で閉じます．', () => { rl.close(); r(); }));
  }
}

if (require.main === module) main();

module.exports = { run, options, checkAssignment };
