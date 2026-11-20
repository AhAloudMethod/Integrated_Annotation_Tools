// 分析者間の一致度（Krippendorff の α）を，時間連続の評価として出す．
// node tools/alpha/alpha.js <実験フォルダ> [--by condition,video] [--scale interval] [--boot 1000] [--block 5] [--seed 1]
// 読む：<実験フォルダ>/データ/全員分/ の 60hz.csv・bins.csv・changepoints.csv（回収ツールの「表にまとめる」が作る）
// 出す：<実験フォルダ>/データ/一致度/ の alpha.csv・settings.txt・problems.txt（毎回作り直す）
// 単位は動画の 1 フレーム（1/60 秒），評定者は分析者（participant）．設計は docs/superpowers/specs/2026-11-20-alpha-agreement-design.md
const fs = require('fs');
const path = require('path');
const { csvParse, csvWrite } = require('../collect/lib');
const A = require('../../core/alpha');

const FPS = 60;
const KEYS = ['participant', 'trial', 'practice', 'condition', 'method', 'video', 'redo'];
const NOT_VALUE = new Set([...KEYS, 'frame', 't', 'bin', 'label', 't_start', 't_end']);
const EXCLUDED = { panas: '項目ごとの回答の方式', ranktrace: '上下限の無い方式', change: '変化の時点を押す方式', affectrank: '変化の時点を押す方式' };

function parseArgs(argv) {
  const o = { by: ['condition', 'video'], scale: 'interval', boot: 1000, block: 5, seed: 1 };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => { if (i + 1 >= argv.length) throw new Error(`${a} の値がありません`); return argv[++i]; };
    if (a === '--by') o.by = v().split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--scale') o.scale = v();
    else if (a === '--boot') o.boot = Number(v());
    else if (a === '--block') o.block = Number(v());
    else if (a === '--seed') o.seed = Number(v());
    else if (a.startsWith('--')) throw new Error(`分からない引数です：${a}`);
    else rest.push(a);
  }
  if (!rest.length) throw new Error('実験フォルダを指定してください（node tools/alpha/alpha.js <実験フォルダ>）');
  if (o.by.some(b => !['condition', 'video'].includes(b)) || !o.by.length) throw new Error('--by は condition・video（カンマ区切りで両方も可）です');
  if (!A.SCALES.includes(o.scale)) throw new Error(`--scale は ${A.SCALES.join('・')} のどれかです`);
  if (!(o.boot >= 0) || !(o.block > 0) || !Number.isFinite(o.seed)) throw new Error('--boot は 0 以上，--block は 0 より大きい数，--seed は数です');
  o.boot = Math.floor(o.boot);
  return { expDir: rest[0], opts: o };
}

// 表を読み，試行（participant + trial）ごとの行に分ける
function readTable(file) {
  if (!fs.existsSync(file)) return null;
  const rows = csvParse(fs.readFileSync(file, 'utf8')).filter(r => !(r.length === 1 && r[0] === ''));
  const head = rows[0] || [], byTrial = new Map();
  for (const r of rows.slice(1)) {
    const rec = {}; head.forEach((c, i) => { rec[c] = r[i] ?? ''; });
    const k = `${rec.participant}\u0000${rec.trial}`;
    if (!byTrial.has(k)) byTrial.set(k, []);
    byTrial.get(k).push(rec);
  }
  return { head, byTrial };
}

const num = s => (s === '' || s == null ? null : (Number.isFinite(+s) ? +s : null));
const usedCols = (head, recs) => head.filter(c => !NOT_VALUE.has(c) && recs.some(r => r[c] !== ''));

// 1 試行の値をフレームごとに出す：{ axis: Map(frame → 値) }．使えなければ理由の文字列
function trialFrames(binRecs, hzRecs, cpRecs, binHead, hzHead) {
  const binCols = usedCols(binHead, binRecs);
  if (binCols.includes('n_changes')) return '変化の時点を押す方式';
  if (binCols.some(c => /_mean$/.test(c)) && !binCols.some(c => /_r9$/.test(c)) && !binCols.some(c => /_from$/.test(c))) return '上下限の無い方式';
  const starts = binRecs.map(r => num(r.t_start)).filter(v => v != null), ends = binRecs.map(r => num(r.t_end)).filter(v => v != null);
  if (!starts.length || !ends.length) return '評価区間が分かりません（bins.csv に t_start・t_end がありません）';
  const t0 = Math.min(...starts), t1 = Math.max(...ends);
  const inRange = t => t >= t0 - 1e-6 && t < t1 - 1e-6;
  const out = {}, notes = [];

  if (hzRecs && hzRecs.length) {
    const series = !!(cpRecs && cpRecs.length);
    const cols = usedCols(hzHead, hzRecs);
    // 連続の方式：最初に動かすまで（初期値）は欠損．軸ごとに，初期値でない最初の変化点の時刻
    const firstMove = {};
    if (series) for (const c of cols.filter(c => !/^va_/.test(c))) {
      const ts = cpRecs.filter(r => r.axis === c && r.initial !== '1').map(r => num(r.t)).filter(v => v != null);
      firstMove[c] = ts.length ? Math.min(...ts) : Infinity;
      if (!ts.length) notes.push(`${c} を一度も動かしていません`);
    }
    const plain = cols.filter(c => !/^va_/.test(c));
    for (const c of cols) {
      const from = !series ? -Infinity : /^va_/.test(c) ? Math.max(...plain.map(p => firstMove[p] ?? Infinity)) : firstMove[c];
      const m = new Map();
      for (const r of hzRecs) {
        const t = num(r.t), v = num(r[c]);
        if (t == null || v == null || !inRange(t) || t < from - 1e-6) continue;
        if (!series && v === 0) continue;   // 区間ごとの方式の 0 は発声なし → 欠損
        m.set(num(r.frame) ?? Math.round(t * FPS), v);
      }
      out[c] = m;
    }
  } else {
    // 区間の値だけの方式（Excel・SAM など）：区間の値をフレームへ展開する
    for (const c of binCols) {
      const m = new Map();
      for (const r of binRecs) {
        const a = num(r.t_start), b = num(r.t_end), v = num(r[c]);
        if (a == null || b == null || v == null || v === 0) continue;   // 0 は発声なし → 欠損
        for (let k = Math.ceil(a * FPS - 1e-6); k / FPS < b - 1e-6; k++) m.set(k, v);
      }
      out[c] = m;
    }
  }
  return { axes: out, notes };
}

function run(expDir, opts) {
  const all = path.join(expDir, 'データ', '全員分'), outDir = path.join(expDir, 'データ', '一致度');
  const bins = readTable(path.join(all, 'bins.csv'));
  if (!bins) throw new Error('データ/全員分/bins.csv がありません．先に回収ツールの「2_全員終わったら_表にまとめる.bat」を実行してください');
  const hz = readTable(path.join(all, '60hz.csv')), cp = readTable(path.join(all, 'changepoints.csv'));
  const problems = [];

  // 採る試行：練習を除き，同じ分析者・条件・動画が 2 回あれば後の試行
  const chosen = new Map();
  for (const [k, recs] of bins.byTrial) {
    const r = { ...recs[0] };
    if (!r.condition) r.condition = r.method;   // 条件名を書かない実験では方式を条件とする
    if (r.practice === '1') continue;
    if (EXCLUDED[r.method]) { problems.push(`${r.participant} の試行 ${r.trial}（${r.method}）：${EXCLUDED[r.method]}なので除きました`); continue; }
    const g = `${r.participant}\u0000${r.condition}\u0000${r.video}`, cur = chosen.get(g);
    if (cur) {
      const later = Number(r.trial) > Number(cur.rec.trial) ? { k, rec: r } : cur, drop = later === cur ? r : cur.rec;
      problems.push(`${r.participant} は条件「${r.condition}」・動画 ${r.video} を 2 回評価しています．後の試行 ${later.rec.trial} を採り，試行 ${drop.trial} を除きました`);
      chosen.set(g, later);
    } else chosen.set(g, { k, rec: r });
  }

  // 条件 → 動画 → 軸 → フレーム → [値]
  const data = new Map();
  for (const { k, rec } of chosen.values()) {
    const res = trialFrames(bins.byTrial.get(k), hz && hz.byTrial.get(k), cp && cp.byTrial.get(k), bins.head, hz ? hz.head : []);
    if (typeof res === 'string') { problems.push(`${rec.participant} の試行 ${rec.trial}（${rec.method}）：${res}．除きました`); continue; }
    for (const n of res.notes) problems.push(`${rec.participant} の試行 ${rec.trial}（${rec.method}）：${n}（その軸は全部欠損になります）`);
    if (!data.has(rec.condition)) data.set(rec.condition, new Map());
    const byVideo = data.get(rec.condition);
    if (!byVideo.has(rec.video)) byVideo.set(rec.video, new Map());
    const byAxis = byVideo.get(rec.video);
    for (const [ax, frames] of Object.entries(res.axes)) {
      if (!byAxis.has(ax)) byAxis.set(ax, { frames: new Map(), raters: new Set() });
      const slot = byAxis.get(ax);
      if (frames.size) slot.raters.add(rec.participant);
      for (const [f, v] of frames) { if (!slot.frames.has(f)) slot.frames.set(f, []); slot.frames.get(f).push(v); }
    }
  }

  const head = ['by', 'condition', 'video', 'axis', 'scale', 'alpha', 'ci_low', 'ci_high', 'n_raters', 'n_units', 'n_values', 'n_clusters', 'n_boot'];
  const rows = [head];
  const fmt = x => (Number.isFinite(x) ? x.toFixed(4) : '');
  const emit = (by, cond, video, ax, all, raters) => {
    const clusters = all.filter(c => c.units > 0);   // 対になる値の無い塊（動画・数秒）は数えない
    const st = A.merge(clusters), a = A.fromStats(st);
    if (raters.size < 2) problems.push(`条件「${cond}」${video ? `・動画 ${video}` : ''}・${ax}：分析者が ${raters.size} 人なので α を出せません`);
    let ci = null;
    if (opts.boot > 0 && Number.isFinite(a)) {
      if (by === 'condition' && clusters.length < 5) problems.push(`条件「${cond}」・${ax}：動画が ${clusters.length} 本（5 本未満）なので，条件ごとの信頼区間は出していません`);
      else ci = A.bootstrap(clusters, { iters: opts.boot, seed: opts.seed });
    }
    rows.push([by, cond, video, ax, opts.scale, fmt(a), ci ? fmt(ci.lo) : '', ci ? fmt(ci.hi) : '', raters.size, st.units, st.n, clusters.length, ci ? ci.n : 0]);
  };
  const conds = [...data.keys()].sort();
  for (const cond of conds) {
    const byVideo = data.get(cond), videos = [...byVideo.keys()].sort();
    const axes = [...new Set(videos.flatMap(v => [...byVideo.get(v).keys()]))];
    for (const ax of axes) {
      if (opts.by.includes('condition')) {
        const clusters = [], raters = new Set();
        for (const v of videos) {
          const slot = byVideo.get(v).get(ax); if (!slot) continue;
          slot.raters.forEach(r => raters.add(r));
          clusters.push(A.clusterStats([...slot.frames.values()], opts.scale));   // 動画が塊
        }
        emit('condition', cond, '', ax, clusters, raters);
      }
      if (opts.by.includes('video')) for (const v of videos) {
        const slot = byVideo.get(v).get(ax); if (!slot) continue;
        const size = Math.max(1, Math.round(opts.block * FPS)), blocks = new Map();   // 数秒の塊
        for (const [f, vals] of slot.frames) { const b = Math.floor(f / size); if (!blocks.has(b)) blocks.set(b, []); blocks.get(b).push(vals); }
        emit('video', cond, v, ax, [...blocks.keys()].sort((a, b) => a - b).map(b => A.clusterStats(blocks.get(b), opts.scale)), slot.raters);
      }
    }
  }
  if (!conds.length) problems.push('α を出せる試行がありません');

  try { fs.rmSync(outDir, { recursive: true, force: true }); } catch (e) {
    throw new Error(`データ/一致度/ を作り直せません（${e.code || e.message}）．Excel などで開いている表を閉じてから，もう一度実行してください`);
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'alpha.csv'), csvWrite(rows));
  fs.writeFileSync(path.join(outDir, 'settings.txt'), [
    `実行日時：${new Date().toISOString()}`,
    `まとめ方：${opts.by.join(',')}`,
    `尺度：${opts.scale}`,
    `単位：動画の 1 フレーム（1/${FPS} 秒）．評定者は分析者．評価区間の外，区間ごとの方式の 0（発声なし），連続の方式で最初に動かすまでの初期値は欠損`,
    `信頼区間：ブートストラップ ${opts.boot} 回（百分位法・95%），乱数の種 ${opts.seed}．条件ごとは動画を，動画ごとは ${opts.block} 秒の塊を単位に再標本化`,
    '',
  ].join('\r\n'));
  fs.writeFileSync(path.join(outDir, 'problems.txt'), (problems.length ? problems : ['なし']).join('\r\n') + '\r\n');
  return { rows: rows.length - 1, problems, outDir };
}

if (require.main === module) {
  try {
    const { expDir, opts } = parseArgs(process.argv.slice(2));
    const r = run(path.resolve(expDir), opts);
    console.log(`α を ${r.rows} 行出しました（${r.outDir}）．`);
    if (r.problems.length) { console.log('確かめること（problems.txt）：'); for (const p of r.problems) console.log(`  ${p}`); }
  } catch (e) {
    console.log(`α を出せませんでした：${e.message}`);
    process.exitCode = 1;
  }
}

module.exports = { parseArgs, run, trialFrames };
