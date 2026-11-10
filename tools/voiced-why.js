// 発声の帯が出ない理由を調べる：npm run voiced-why -- <録画> [--from 秒] [--to 秒] [--csv 出力.csv]
// ブラウザと同じ計算（core/f0-calc.js）で，10 ms ごとの窓を次のどれかに振り分け，秒数と区間を出す。
//   帯あり／音量が最大の何 % 未満（既定の 0% では出ない）／周期がはっきりしない（YIN が 0.15 未満にならない）／70 Hz 未満／短すぎる（0.05 秒未満）／
//   下限（-60 dBFS）未満で周期がある（小さい声）／下限未満で周期も無い
// あわせて，下限（最大の何 % と絶対の dBFS）と YIN のしきい値（0.15）を変えたときに帯が何秒になるかを出す。音声は ffmpeg（PATH にあること）で 16kHz・モノラルにする。
// ブラウザは音声を自分で 16kHz にするので，ffmpeg との差で値はわずかに変わる
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const C = require('../core/f0-calc');

const WIDE = [40, 2000];   // 範囲の外の声を見つけるときに探す範囲（Hz）
const ABS_DB = Math.round(20 * Math.log10(C.FLOOR_ABS));
const REASONS = {
  voiced: '帯あり',
  short: '短すぎる（0.05 秒未満）',
  range: `高さが ${C.FMIN} Hz 未満`,   // ${C.FMAX} Hz を超える声は半分の高さに読まれて帯になるので，外れるのは低いほうだけ
  aperiodic: `周期がはっきりしない（YIN ≥ ${C.YIN_TH}）`,
  below: `音量が最大の ${C.FLOOR_REL * 100}% 未満`,   // 既定（0%）では出ない
  quiet: `${ABS_DB} dBFS 未満だが周期がある（小さい声）`,
  silent: `${ABS_DB} dBFS 未満で周期も無い（無音・雑音）`,
};
const LOW = 0.0003;   // 絶対の下限を下げたときを調べる最小（-70 dBFS）。これより小さい窓は YIN を求めない
const db = v => (v > 0 ? 20 * Math.log10(v) : -Infinity);
const fmtDb = v => (Number.isFinite(db(v)) ? db(v).toFixed(1) : '-inf');
const sec = n => (n * C.HOP).toFixed(2);
const median = a => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };

function decode(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(C.SR), '-f', 'f32le', '-'], { maxBuffer: 2 ** 31 });
  if (r.error) throw new Error('ffmpeg を起動できません（PATH にありますか）：' + r.error.message);
  if (r.status !== 0) throw new Error('ffmpeg で音声を読めません：' + String(r.stderr).trim());
  const b = r.stdout;
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 4)));
}

// 窓ごとの値と理由。th・rel を変えたときの帯の秒数も出す
function diagnose(samples, { th = C.YIN_TH, rel = C.FLOOR_REL } = {}) {
  const rms = C.rmsFrames(samples), n = rms.length;
  let peak = 0, peakK = 0; for (let k = 0; k < n; k++) if (rms[k] > peak) { peak = rms[k]; peakK = k; }
  const floor = C.floorOf(rms, rel);
  const f0 = new Float32Array(n).fill(NaN), dmin = new Float32Array(n).fill(NaN), wide = new Float32Array(n).fill(NaN);
  for (let k = 0; k < n; k++) {
    if (rms[k] < LOW) continue;
    const y = C.yinDetail(samples, C.frameOff(k), C.SR, C.WIN, C.FMIN, C.FMAX, th);
    dmin[k] = y.dmin; if (rms[k] < C.FLOOR_ABS) continue;
    if (rms[k] >= floor) f0[k] = y.f0;
    if (!(y.f0 > 0)) wide[k] = C.yin(samples, C.frameOff(k), C.SR, C.WIN, WIDE[0], WIDE[1], th);
  }
  const spans = C.spans(f0);
  const inBand = new Uint8Array(n);
  for (const [t0, t1] of spans) for (let k = Math.round(t0 / C.HOP); k < n && k * C.HOP < t1 - C.WIN / C.SR - 1e-9; k++) inBand[k] = 1;
  const reason = Array.from({ length: n }, (_x, k) => {
    if (inBand[k]) return 'voiced';
    if (rms[k] < C.FLOOR_ABS) return dmin[k] < th ? 'quiet' : 'silent';
    if (rms[k] < floor) return 'below';
    if (f0[k] > 0) return 'short';
    if (wide[k] > 0 && (wide[k] < C.FMIN || wide[k] > C.FMAX)) return 'range';
    return 'aperiodic';
  });
  // 下限としきい値を変えたら帯は何秒か
  const bandSec = (r, t, abs = C.FLOOR_ABS) => {
    const fl = C.floorOf(rms, r, Math.max(abs, LOW)), g = new Float32Array(n);
    for (let k = 0; k < n; k++) g[k] = rms[k] >= fl && dmin[k] < t ? 1 : NaN;   // 探す範囲で dmin < t なら YIN は声ありとする
    return C.spans(g).reduce((s, [a, b]) => s + (b - a - C.WIN / C.SR), 0);   // 窓の数で数える（振り分けの秒と同じ数え方）
  };
  return { n, rms, peak, peakK, floor, f0, dmin, wide, spans, reason, bandSec };
}

// 大きな音の上位（0.5 秒以上離れたもの）。効果音などで基準が上がっていないかを見る
function loudest(rms, top = 5) {
  const idx = Array.from(rms.keys()).sort((a, b) => rms[b] - rms[a]), out = [];
  for (const k of idx) { if (out.every(j => Math.abs(j - k) >= 50)) out.push(k); if (out.length >= top) break; }
  return out;
}

// 帯の無い所のうち音のある区間（0.2 秒以上）と，その主な理由
function gaps(d, from, to) {
  const out = [];
  for (let k = from; k < to;) {
    if (d.reason[k] === 'voiced' || d.reason[k] === 'silent') { k++; continue; }   // 小さい声（quiet）は区間に入れる
    let e = k;
    // 0.1 秒未満の無音はつなぐ（声の途切れで区間が細切れにならないように）
    while (e < to && d.reason[e] !== 'voiced') {
      if (d.reason[e] === 'silent') { let g = e; while (g < to && d.reason[g] === 'silent') g++; if (g - e >= 10 || g >= to || d.reason[g] === 'voiced') break; e = g; } else e++;
    }
    if (e - k >= 20) {
      const cnt = {}; for (let j = k; j < e; j++) if (d.reason[j] !== 'silent') cnt[d.reason[j]] = (cnt[d.reason[j]] || 0) + 1;
      const main = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
      const loud = []; const dm = [];
      for (let j = k; j < e; j++) if (d.reason[j] !== 'silent') { loud.push(d.rms[j]); if (d.dmin[j] >= 0) dm.push(d.dmin[j]); }
      out.push({ k, e, main, rms: median(loud), dmin: median(dm) });
    }
    k = e;
  }
  return out;
}

function report(file, d, from, to) {
  const L = [];
  const t = k => (k * C.HOP).toFixed(2);
  L.push(`録画：${path.basename(file)}（${t(d.n)} 秒）` + (from > 0 || to < d.n ? `　調べた範囲：${t(from)}〜${t(to)} 秒` : ''));
  L.push(`最大の音量：${fmtDb(d.peak)} dBFS（${t(d.peakK)} 秒）`);
  const relFloor = d.peak * C.FLOOR_REL;
  L.push(`声なしにする下限：${fmtDb(d.floor)} dBFS（${relFloor >= C.FLOOR_ABS ? `最大の ${C.FLOOR_REL * 100}% で決まる` : `${ABS_DB} dBFS（${C.FLOOR_ABS}）で決まる`}）`);
  L.push('大きな音の上位：' + loudest(d.rms).map(k => `${t(k)} 秒 ${fmtDb(d.rms[k])} dB`).join('，'));
  L.push('');
  L.push('■ 窓の振り分け（秒）');
  const cnt = {}; for (let k = from; k < to; k++) cnt[d.reason[k]] = (cnt[d.reason[k]] || 0) + 1;
  for (const [key, label] of Object.entries(REASONS)) L.push(`  ${sec(cnt[key] || 0).padStart(8)}  ${label}`);
  L.push('');
  L.push('■ 値を変えたときの帯の長さ（秒，録画全体。行が下限，列が YIN のしきい値）');
  const THS = [0.15, 0.2, 0.25, 0.3], RELS = [0, 0.01, 0.02, 0.05];
  L.push('           ' + THS.map(x => String(x).padStart(8)).join(''));
  for (const r of RELS) L.push(`  ${(r * 100 + '%').padStart(9)} ` + THS.map(x => d.bandSec(r, x).toFixed(1).padStart(8)).join(''));
  L.push(`  （下限 0% は ${ABS_DB} dBFS だけで切る。既定は 0%・0.15）`);
  L.push('');
  L.push(`■ 絶対の下限（既定 ${ABS_DB} dBFS）を変えたときの帯の長さ（秒，下限 ${C.FLOOR_REL * 100}%）`);
  L.push('           ' + THS.map(x => String(x).padStart(8)).join(''));
  for (const a of [0.003, 10 ** (-55 / 20), C.FLOOR_ABS, LOW]) L.push(`  ${(Math.round(db(a)) + ' dB').padStart(9)} ` + THS.map(x => d.bandSec(C.FLOOR_REL, x, a).toFixed(1).padStart(8)).join(''));   // 0.003 は以前の既定（-50 dB）
  L.push('');
  L.push('■ 帯の無い所で音のある区間（0.2 秒以上）');
  const gs = gaps(d, from, to);
  if (!gs.length) L.push('  ありません');
  for (const g of gs) {
    const main = g.main.map(([key, c]) => `${REASONS[key]} ${Math.round(c / (g.e - g.k) * 100)}%`).join('，');
    L.push(`  ${t(g.k)}〜${t(g.e)} 秒：${main}（音量の中央 ${fmtDb(g.rms)} dB，YIN の最小の中央 ${Number.isFinite(g.dmin) ? g.dmin.toFixed(2) : '-'}）`);
  }
  return L.join('\n');
}

function writeCsv(out, d) {
  const rows = ['t,rms,db,yin_dmin,f0_hz,f0_wide_hz,reason'];
  for (let k = 0; k < d.n; k++) {
    rows.push([(k * C.HOP + C.WIN / C.SR / 2).toFixed(3), d.rms[k].toFixed(5), fmtDb(d.rms[k]), Number.isFinite(d.dmin[k]) ? d.dmin[k].toFixed(3) : '',
      d.f0[k] > 0 ? d.f0[k].toFixed(1) : '', d.wide[k] > 0 ? d.wide[k].toFixed(1) : '', d.reason[k]].join(','));
  }
  fs.writeFileSync(out, '﻿' + rows.join('\n') + '\n');
}

function main(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (['--from', '--to', '--csv'].includes(argv[i])) args[argv[i].slice(2)] = argv[++i]; else args._.push(argv[i]);
  }
  const file = args._[0];
  if (!file) { console.log('使い方：npm run voiced-why -- <録画> [--from 秒] [--to 秒] [--csv 出力.csv]'); return 2; }
  if (!fs.existsSync(file)) { console.log(`見つかりません：${file}`); return 1; }
  const d = diagnose(decode(file));
  const from = Math.max(0, Math.floor((+args.from || 0) / C.HOP)), to = Math.min(d.n, args.to != null ? Math.ceil(+args.to / C.HOP) : d.n);
  console.log(report(file, d, from, to));
  if (args.csv) { writeCsv(args.csv, d); console.log(`\n窓ごとの値：${path.resolve(args.csv)}`); }
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { diagnose, decode, gaps, report };
