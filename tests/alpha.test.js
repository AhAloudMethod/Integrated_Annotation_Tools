// 一致度（Krippendorff の α）：core/alpha.js の計算と，tools/alpha/alpha.js の表の読み方
// ブラウザを使わない．ダミーの「データ/全員分/」を tests/out/一致度テスト/ に作って確かめる
const fs = require('fs');
const path = require('path');
const { OUT } = require('./_env');
const A = require('../core/alpha');
const { run, parseArgs } = require('../tools/alpha/alpha');
const { csvWrite, csvParse } = require('../tools/collect/lib');

let failed = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? ' ' + info : ''}`); if (!ok) failed++; };
const near = (a, b, tol = 5e-4) => Number.isFinite(a) && Math.abs(a - b) <= tol;

// ---------- 計算 ----------
// Krippendorff (2011) "Computing Krippendorff's Alpha-Reliability" の例題（4 人 × 12 単位，欠損あり）
const N = null;
const K2011 = [[1, 1, N, 1], [2, 2, 3, 2], [3, 3, 3, 3], [3, 3, 3, 3], [2, 2, 2, 2], [1, 2, 3, 4], [4, 4, 4, 4], [1, 1, 2, 1], [2, 2, 2, 2], [N, 5, 5, 5], [N, N, 1, 1], [N, 3, N, N]];
for (const [s, want] of [['nominal', 0.743], ['ordinal', 0.815], ['interval', 0.849], ['ratio', 0.797]]) {
  const a = A.alpha(K2011, s);
  check(`Krippendorff (2011) の例題：${s}`, near(a, want), a.toFixed(4));
}

// 間隔尺度の速い式が，値の対を総当たりした式と合う（小数の値・欠損あり）
function bruteInterval(units) {
  const us = units.map(u => u.filter(v => v != null)).filter(u => u.length >= 2), all = us.flat(), n = all.length;
  let Do = 0; for (const u of us) { let s = 0; for (const a of u) for (const b of u) s += (a - b) ** 2; Do += s / (u.length - 1); }
  let De = 0; for (const a of all) for (const b of all) De += (a - b) ** 2;
  return 1 - (Do / n) / (De / (n * (n - 1)));
}
{
  let seed = 7; const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const units = Array.from({ length: 40 }, () => { const base = 1 + 8 * r(); return Array.from({ length: 4 }, () => (r() < 0.2 ? null : +(base + (r() - 0.5) * 2).toFixed(3))); });
  check('間隔尺度の速い式が総当たりと合う', near(A.alpha(units, 'interval'), bruteInterval(units), 1e-9));
  // 塊に分けて足し合わせても同じ値
  const parts = [units.slice(0, 13), units.slice(13, 29), units.slice(29)];
  for (const s of A.SCALES) check(`塊に分けて足しても同じ（${s}）`, near(A.fromStats(A.merge(parts.map(p => A.clusterStats(p, s)))), A.alpha(units, s), 1e-9));
  const b1 = A.bootstrap(parts.map(p => A.clusterStats(p, 'interval')), { iters: 200, seed: 3 }), b2 = A.bootstrap(parts.map(p => A.clusterStats(p, 'interval')), { iters: 200, seed: 3 });
  check('ブートストラップは種が同じなら同じ区間', b1 && b2 && b1.lo === b2.lo && b1.hi === b2.hi && b1.lo <= b1.hi, b1 ? `${b1.lo.toFixed(3)}〜${b1.hi.toFixed(3)}` : '');
  check('塊が 1 つならブートストラップしない', A.bootstrap([A.clusterStats(units, 'interval')]) === null);
}
check('完全に一致すれば 1', A.alpha([[1, 1], [5, 5], [9, 9, 9]], 'interval') === 1);
check('値が 1 種類なら NaN', Number.isNaN(A.alpha([[5, 5], [5, 5]], 'interval')));

// ---------- 引数 ----------
check('引数の既定', JSON.stringify(parseArgs(['x']).opts) === JSON.stringify({ by: ['condition', 'video'], scale: 'interval', boot: 1000, block: 5, seed: 1 }));
let threw = false; try { parseArgs(['x', '--scale', 'foo']); } catch (_e) { threw = true; }
check('分からない尺度は止める', threw);

// ---------- 表の読み方 ----------
const ROOT = path.join(OUT, '一致度テスト');
fs.rmSync(ROOT, { recursive: true, force: true });
const ALL = path.join(ROOT, 'データ', '全員分');
fs.mkdirSync(ALL, { recursive: true });
const KEYS = ['participant', 'trial', 'practice', 'condition', 'method', 'video', 'redo'];
const key = (p, trial, cond, method, video, practice = '0') => [p, String(trial), practice, cond, method, video, '0'];

// 60hz：連続の方式（slider・darma）．動画は 2 秒．値はフレームで変わり，P1 と P2 は同じ値
const hz = [[...KEYS, 'frame', 't', 'valence', 'arousal']];
const cps = [[...KEYS, 'axis', 't', 'value', 'initial']];
const bins = [[...KEYS, 'bin', 'label', 't_start', 't_end', 'valence', 'arousal', 'valence_mean', 'arousal_mean', 'valence_r9', 'arousal_r9', 'n_changes']];
const binRow = (k, s, a, b, cols) => bins.push([...k, String(s), '', a.toFixed(3), b.toFixed(3), ...['valence', 'arousal', 'valence_mean', 'arousal_mean', 'valence_r9', 'arousal_r9', 'n_changes'].map(c => cols[c] ?? '')]);
for (const p of ['P1', 'P2']) {
  const k = key(p, 1, 'slider', 'darma', 'v1.mp4');
  for (let f = 0; f <= 120; f++) hz.push([...k, String(f), (f / 60).toFixed(4), (1 + (f % 9)).toFixed(3), (9 - (f % 7)).toFixed(3)]);
  cps.push([...k, 'valence', '0', '5', '1'], [...k, 'arousal', '0', '5', '1']);
  cps.push([...k, 'valence', p === 'P1' ? '0.75' : '0.1', '3', '0'], [...k, 'arousal', '0.2', '4', '0']);
  binRow(k, 0, 0.5, 1.0, { valence_mean: '3', arousal_mean: '3', valence_r9: '3', arousal_r9: '3' });   // 評価区間は 0.5〜1.5 秒
  binRow(k, 1, 1.0, 1.5, { valence_mean: '3', arousal_mean: '3', valence_r9: '3', arousal_r9: '3' });
}
// 区間の値だけの方式（excel）：3 区間．P1 は 2 つ目が 0（発声なし）
for (const [p, mid] of [['P1', 0], ['P2', 5]]) {
  const k = key(p, 2, 'excel', 'excel', 'v1.mp4');
  binRow(k, 0, 0, 1, { valence: '3', arousal: '2' }); binRow(k, 1, 1, 2, { valence: String(mid), arousal: String(mid) }); binRow(k, 2, 2, 3, { valence: '7', arousal: '8' });
}
// 練習（除く），PANAS（除く），変化ボタン（除く），同じ分析者・条件・動画の 2 回目（後を採る）
binRow(key('P1', 0, 'excel', 'excel', 'v1.mp4', '1'), 0, 0, 3, { valence: '9', arousal: '9' });
binRow(key('P1', 3, 'panas', 'panas', 'v1.mp4'), 0, 0, 3, { valence: '5', arousal: '5' });
binRow(key('P1', 4, 'button', 'custom', 'v1.mp4'), 0, 0, 3, { n_changes: '2' });
binRow(key('P2', 5, 'button', 'custom', 'v1.mp4'), 0, 0, 3, { n_changes: '1' });
binRow(key('P3', 6, 'excel', 'excel', 'v1.mp4'), 0, 0, 3, { valence: '1', arousal: '1' });
binRow(key('P3', 7, 'excel', 'excel', 'v1.mp4'), 0, 0, 1, { valence: '3', arousal: '2' });
binRow(key('P3', 7, 'excel', 'excel', 'v1.mp4'), 1, 1, 2, { valence: '0', arousal: '0' });
binRow(key('P3', 7, 'excel', 'excel', 'v1.mp4'), 2, 2, 3, { valence: '7', arousal: '8' });
// 条件名の無い試行（condition が空）は方式を条件とする
for (const p of ['P1', 'P2']) binRow(key(p, 8, '', 'sam', 'v1.mp4'), 0, 0, 1, { valence: p === 'P1' ? '4' : '6', arousal: '5' });
fs.writeFileSync(path.join(ALL, '60hz.csv'), csvWrite(hz));
fs.writeFileSync(path.join(ALL, 'changepoints.csv'), csvWrite(cps));
fs.writeFileSync(path.join(ALL, 'bins.csv'), csvWrite(bins));

const r = run(ROOT, { by: ['condition', 'video'], scale: 'interval', boot: 100, block: 0.25, seed: 1 });
const out = csvParse(fs.readFileSync(path.join(ROOT, 'データ', '一致度', 'alpha.csv'), 'utf8')).filter(x => x.length > 1);
const H = out[0], rec = out.slice(1).map(x => Object.fromEntries(H.map((c, i) => [c, x[i]])));
const find = (by, cond, ax) => rec.find(x => x.by === by && x.condition === cond && x.axis === ax);
const sv = find('condition', 'slider', 'valence'), sa = find('condition', 'slider', 'arousal');
// 評価区間 0.5〜1.5 秒 → フレーム 30〜89．P1 の快度は 0.75 秒（フレーム 45）まで初期値なので欠損
check('連続の方式：評価区間と初期値で単位が絞られる（快度）', sv && sv.n_units === '45' && sv.n_values === '90', sv && `${sv.n_units} 単位`);
check('連続の方式：覚醒度は両者 0.2 秒から → 60 単位', sa && sa.n_units === '60', sa && sa.n_units);
check('連続の方式：同じ値なら α = 1', sv && sv.alpha === '1.0000');
const ev = find('condition', 'excel', 'valence');
// P1・P2・P3 の 3 人．2 つ目の区間は P1・P3 が 0（欠損）なので P2 だけ → 対にならない．1・3 つ目は 3 人 × 60 フレーム
check('区間の方式：0 は欠損，区間をフレームへ展開', ev && ev.n_units === '120' && ev.n_values === '360' && ev.n_raters === '3', ev && `${ev.n_units} 単位 ${ev.n_values} 値 ${ev.n_raters} 人`);
check('区間の方式：練習と 1 回目の評価を除くので α = 1', ev && ev.alpha === '1.0000', ev && ev.alpha);
check('動画が 5 本未満なら条件ごとの信頼区間は空', ev && ev.ci_low === '' && ev.n_boot === '0');
const vv = find('video', 'slider', 'valence');
check('動画ごと：塊でブートストラップする', vv && vv.n_clusters === '3' && vv.ci_low !== '', vv && `${vv.n_clusters} 塊`);
const sam = find('condition', 'sam', 'valence');
check('条件名が空なら方式を条件にする', sam && sam.n_units === '60' && sam.n_raters === '2', sam && sam.n_units);
check('除いた方式は出さない', !rec.some(x => x.condition === 'panas' || x.condition === 'button'));
const prob = fs.readFileSync(path.join(ROOT, 'データ', '一致度', 'problems.txt'), 'utf8');
check('problems：PANAS', /panas）：項目ごとの回答の方式なので除きました/.test(prob));
check('problems：変化の時点を押す方式', /custom）：変化の時点を押す方式．除きました/.test(prob));
check('problems：2 回評価', /P3 は条件「excel」・動画 v1\.mp4 を 2 回評価しています．後の試行 7 を採り/.test(prob));
check('problems：信頼区間を出さない理由', /動画が 1 本（5 本未満）/.test(prob));
check('settings.txt がある', fs.existsSync(path.join(ROOT, 'データ', '一致度', 'settings.txt')));
check('全員分が無ければ止める', (() => { try { run(path.join(ROOT, '無い'), parseArgs(['x']).opts); return false; } catch (e) { return /bins\.csv がありません/.test(e.message); } })());
console.log(`problems: ${r.problems.length} 件`);

console.log(failed ? `${failed} 件 FAIL` : 'errors: none');
process.exitCode = failed ? 1 : 0;
