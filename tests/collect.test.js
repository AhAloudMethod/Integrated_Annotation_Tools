// 回収ツール（tools/collect/）：zip と試行の読み込み，設定，集める計画と実行，表へのまとめ
// ブラウザを使わない．ダミーの実験フォルダ・ダウンロード先・録画・ログを日本語を含むパス（tests/out/回収テスト/）に作って確かめる
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { OUT } = require('./_env');
const { makeZip, crc32 } = require('../core/zip');
const lib = require('../tools/collect/lib');
const { unzip, readTrialZip, loadConfig, csvParse, csvWrite, matchGlob } = lib;

let failed = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? ' ' + info : ''}`); if (!ok) failed++; };

const ROOT = path.join(OUT, '回収テスト');
fs.rmSync(ROOT, { recursive: true, force: true });
// テストごとの作業フォルダ（空で作り直す）
const fresh = name => { const d = path.join(ROOT, name); fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); return d; };

// ---------- ダミーを作るヘルパー ----------

// deflate の zip（makeZip と同じ構造で，方式 8）
function makeDeflateZip(files) {
  const parts = [], central = [];
  let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'), data = Buffer.from(f.data), comp = zlib.deflateRawSync(data), crc = crc32(data);
    const common = (b, at) => { b.writeUInt16LE(20, at); b.writeUInt16LE(0x0800, at + 2); b.writeUInt16LE(8, at + 4); b.writeUInt16LE(0, at + 6); b.writeUInt16LE(0, at + 8);
      b.writeUInt32LE(crc, at + 10); b.writeUInt32LE(comp.length, at + 14); b.writeUInt32LE(data.length, at + 18); b.writeUInt16LE(name.length, at + 22); b.writeUInt16LE(0, at + 24); };
    const lh = Buffer.alloc(30 + name.length); lh.writeUInt32LE(0x04034b50, 0); common(lh, 4); name.copy(lh, 30);
    const ch = Buffer.alloc(46 + name.length); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); common(ch, 6); ch.writeUInt32LE(off, 42); name.copy(ch, 46);
    parts.push(lh, comp); central.push(ch); off += lh.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

// annotator の実験モードが書き出す試行の zip を作り，パスを返す．
// o：{ pid, exp, trial（0 始まり）, practice, condition, method, video, redo, partial, start, end（ISO 文字列）,
//      record（{ file, size, last_modified, ref_video, ref_video_size, ref_video_last_modified } か null）,
//      csvs（{ 'bins.csv': 本文 }）, trials（要約の本文．省けば作らない）, deflate, name（ファイル名を変える）, mtime（zip の更新日時 ms）}
function makeTrialZip(dir, o) {
  const pid = o.pid || 'P01', exp = o.exp || 'exp3', method = o.method != null ? o.method : 'custom';
  const video = o.video || (o.record && o.record.file) || 'a.mp4';
  const tag = `_t${String(o.trial + 1).padStart(2, '0')}${o.practice ? 'p' : ''}`;
  const base = `${pid}${tag}_${video.replace(/\.[^.]+$/, '')}_${method}`;
  const ex = { name: exp, participant: pid, trial: o.trial, n_trials: 4, practice: !!o.practice, condition: o.condition || '', start_iso: o.start, end_iso: o.end };
  if (o.record) ex.record = o.record;
  if (o.redo) ex.redo = { n: o.redo };
  if (o.partial) ex.partial = true;
  const files = Object.entries(o.csvs || { 'bins.csv': 'sec,valence\r\n0,1\r\n' }).map(([suf, text]) => ({ name: `${base}_${suf}`, data: text }));
  if (o.trials) files.push({ name: `${pid}_${exp}_trials.csv`, data: o.trials });
  files.push({ name: `${base}_session.json`, data: JSON.stringify({ meta: { mode: method, participant: pid, video_file: video, experiment: ex }, data: {}, log: [] }) });
  const enc = files.map(f => ({ name: f.name, data: typeof f.data === 'string' ? Buffer.from(f.data, 'utf8') : f.data }));
  const buf = o.deflate ? makeDeflateZip(enc) : Buffer.from(makeZip(enc));
  const file = path.join(dir, o.name || `${base}${o.redo ? `_redo${o.redo}` : ''}${o.partial ? '_partial' : ''}.zip`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, buf);
  if (o.mtime) fs.utimesSync(file, new Date(o.mtime), new Date(o.mtime));
  return file;
}

// 大きさ size バイトのダミーの録画（ログ）を作り，更新日時を mtime（ms）にする
function makeFile(file, size, mtime) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(size, 7));
  if (mtime != null) fs.utimesSync(file, new Date(mtime), new Date(mtime));
  return file;
}

// ---------- Task 2：lib.js ----------
{
  const d = fresh('lib');
  const stored = Buffer.from(makeZip([{ name: 'a.txt', data: 'x' }, { name: 'b.csv', data: 'y' }]));
  const deflated = makeDeflateZip([{ name: 'あ.txt', data: Buffer.from('あいう') }]);
  check('格納の zip を読む', unzip(stored).map(e => e.name).join() === 'a.txt,b.csv');
  check('deflate の zip を読む', unzip(deflated)[0].data.toString() === 'あいう' && unzip(deflated)[0].name === 'あ.txt');
  let threw = '';
  try { unzip(Buffer.from('not a zip at all, definitely not')); } catch (e) { threw = e.message; }
  check('zip でなければ「zip ではありません」', threw === 'zip ではありません', threw);

  const rec = { file: '2026-11-09 10-05-00.mkv', size: 123, last_modified: 1700000000000, ref_video: '2026-11-09 10-04-00.mkv', ref_video_size: 45, ref_video_last_modified: 1699999990000 };
  const f = makeTrialZip(d, { pid: 'P_01', trial: 1, condition: 'Sliding Penguin', record: rec, start: '2026-11-09T01:05:00.000Z', end: '2026-11-09T01:10:00.000Z',
    csvs: { 'bins.csv': 'a\r\n1\r\n' }, trials: 'trial\r\n1\r\n2\r\n', deflate: true });
  const t = readTrialZip(f);
  check('試行の zip から参加者・試行・録画を読む', !!t && t.pid === 'P_01' && t.trial === 1 && t.practice === false && t.condition === 'Sliding Penguin'
    && t.method === 'custom' && t.exp === 'exp3' && t.redo === 0 && t.partial === false && t.startIso === '2026-11-09T01:05:00.000Z' && t.endIso === '2026-11-09T01:10:00.000Z'
    && t.record.file === rec.file && t.record.size === 123 && t.record.lastModified === 1700000000000
    && t.record.refVideo === rec.ref_video && t.record.refSize === 45 && t.record.refLastModified === 1699999990000, JSON.stringify(t && { ...t, csvs: undefined }));
  const renamed = path.join(d, 'X_99_t09_whatever.zip'); fs.copyFileSync(f, renamed);
  check('ID はファイル名でなく中身から取る', readTrialZip(renamed).pid === 'P_01');
  check('CSV の種類を接尾辞で分ける', t.csvs.map(c => c.suffix).sort().join() === 'bins.csv,trials.csv', t.csvs.map(c => c.suffix).join());
  const r2 = readTrialZip(makeTrialZip(d, { pid: 'P02', trial: 0, practice: true, redo: 2, partial: true, record: { file: 'x.mkv', size: 1 }, start: 's', end: 'e' }));
  check('練習・やり直しの回数・途中終了と，更新日時の無い古い record を読む', r2.practice && r2.redo === 2 && r2.partial && r2.record.lastModified === null && r2.record.refVideo === null, JSON.stringify(r2.record));
  const plain = path.join(d, 'plain.zip'); fs.writeFileSync(plain, Buffer.from(makeZip([{ name: 'x_session.json', data: JSON.stringify({ meta: { mode: 'excel' } }) }])));
  check('実験モードでない zip は null', readTrialZip(plain) === null);
  const broken = path.join(d, 'broken.zip'); fs.writeFileSync(broken, 'abc');
  check('壊れた zip も null', readTrialZip(broken) === null);

  const e1 = fresh('lib-設定なし');
  const cfg = loadConfig(e1);
  check('設定が無ければ既定を使う', cfg.defaulted && cfg.zips === path.resolve(process.env.USERPROFILE, 'Downloads') && cfg.recordings === path.resolve(process.env.USERPROFILE, 'Videos')
    && cfg.recordingExts.join() === '.mkv,.mp4' && cfg.logs.length === 0, JSON.stringify(cfg));
  const e2 = fresh('lib-設定あり');
  fs.mkdirSync(path.join(e2, 'ツール'));
  fs.writeFileSync(path.join(e2, 'ツール', '設定.json'), '﻿' + JSON.stringify({ zips: 'dl', recordingExts: ['.MKV'], logs: [{ name: 'OVGL', path: '%USERPROFILE%/AppData/LocalLow/OVGL', include: '*/log_*' }] }));
  const cfg2 = loadConfig(e2);
  check('設定の %USERPROFILE% を展開し，BOM を許し，相対パスは実験フォルダから', !cfg2.defaulted && cfg2.logs[0].path === path.resolve(process.env.USERPROFILE, 'AppData/LocalLow/OVGL')
    && cfg2.zips === path.join(e2, 'dl') && cfg2.recordingExts.join() === '.mkv' && cfg2.logs[0].include === '*/log_*', JSON.stringify(cfg2));
  fs.writeFileSync(path.join(e2, 'ツール', '設定.json'), '{ broken');
  let cerr = ''; try { loadConfig(e2); } catch (e) { cerr = e.message; }
  check('設定.json が壊れていれば理由を出して止める', cerr.includes('設定.json'), cerr);

  check('*/log_* は 1 階層下の log_ だけに合う', matchGlob('Dev-SlidingPenguin/log_1', '*/log_*') && matchGlob('A\\log_2', '*/log_*')
    && !matchGlob('Dev-SlidingPenguin/Player.log', '*/log_*') && !matchGlob('log_1', '*/log_*') && !matchGlob('a/b/log_1', '*/log_*'));
  const rows = [['a,b', '"q"', 'x\r\ny'], ['あ', '']];
  check('CSV を書いて読むと戻る', JSON.stringify(csvParse(csvWrite(rows))) === JSON.stringify(rows), JSON.stringify(csvParse(csvWrite(rows))));
  check('CSV は BOM つき・CRLF', csvWrite([['a']]) === '﻿a\r\n');
  check('LF だけの CSV も読む', JSON.stringify(csvParse('a,b\n1,2\n')) === JSON.stringify([['a', 'b'], ['1', '2']]));
}

// ---------- Task 3：planCollect ----------
{
  const { planCollect } = require('../tools/collect/collect');
  // 2026-11-09（d 日）のローカル時刻を ms で返す
  const T = (h, m, s = 0, d = 9) => new Date(2026, 10, d, h, m, s).getTime();
  const iso = t => new Date(t).toISOString();
  const slash = p => p.replace(/\\/g, '/');
  const moves = plan => plan.people.flatMap(p => p.moves);
  const names = plan => moves(plan).map(m => path.basename(m.dst));
  const movedFrom = (plan, src) => moves(plan).find(m => path.resolve(m.src) === path.resolve(src));
  const personOf = (plan, src) => (plan.people.find(p => p.moves.some(m => path.resolve(m.src) === path.resolve(src))) || {}).pid;

  // 実験フォルダ（exp/），ダウンロード先（dl/），録画のフォルダ（rec/），ログ（OVGL/）を作る
  function scene(name, participants) {
    const d = fresh(name), exp = path.join(d, 'exp');
    fs.mkdirSync(path.join(exp, 'ツール'), { recursive: true });
    fs.writeFileSync(path.join(exp, 'experiment.json'), JSON.stringify({ name: 'exp3', participants }));
    fs.writeFileSync(path.join(exp, 'ツール', '設定.json'), JSON.stringify({ zips: '../dl', recordings: '../rec', logs: [{ name: 'OVGL', path: '../OVGL', include: '*/log_*' }] }));
    for (const sub of ['dl', 'rec', 'OVGL']) fs.mkdirSync(path.join(d, sub));
    return { exp, dl: path.join(d, 'dl'), rec: path.join(d, 'rec'), ovgl: path.join(d, 'OVGL'), plan: () => planCollect(exp, loadConfig(exp)) };
  }
  // 録画を作り，zip に残す値（{ file, size, lastModified }）を返す
  const rec = (s, name, size, mtime) => { makeFile(path.join(s.rec, name), size, mtime); return { file: name, size, lastModified: mtime }; };
  // プレイの録画 play と基準音声 ref を選んだ試行の zip を作る
  const trial = (s, o) => makeTrialZip(s.dl, { exp: 'exp3', condition: 'EscapeFish', video: o.condition || 'EscapeFish', ...o, start: iso(o.start), end: o.end != null ? iso(o.end) : undefined,
    record: { file: o.play.file, size: o.play.size, last_modified: o.play.lastModified, ref_video: o.ref.file, ref_video_size: o.ref.size, ref_video_last_modified: o.ref.lastModified } });
  // ログのフォルダ（中に trial_1/x.json）を作る．フォルダ自体の更新日時は dirTime にする
  const log = (s, rel, mtime, dirTime) => {
    const dir = path.join(s.ovgl, rel);
    makeFile(path.join(dir, 'trial_1', 'x.json'), 10, mtime);
    if (dirTime != null) for (const p of [path.join(dir, 'trial_1'), dir]) fs.utimesSync(p, new Date(dirTime), new Date(dirTime));
    return dir;
  };

  // 2 人分．P01 は 10 時台，P02 は 11 時台
  const two = [{ mode: 'custom', video: 'p.mp4', practice: true }, { mode: 'custom', video: 'a.mp4' }];
  const s = scene('plan-2人', { P01: two, P02: two });
  const p1prac = rec(s, 'P1prac.mkv', 100, T(10, 10)), p1ref1 = rec(s, 'P1ref1.mkv', 50, T(10, 5));
  const p1main = rec(s, 'P1main.mkv', 200, T(10, 20)), p1ref2 = rec(s, 'P1ref2.mkv', 60, T(10, 18));
  trial(s, { pid: 'P01', trial: 0, practice: true, play: p1prac, ref: p1ref1, start: T(10, 12), end: T(10, 15) });
  const p1t2 = trial(s, { pid: 'P01', trial: 1, play: p1main, ref: p1ref2, start: T(10, 22), end: T(10, 30) });
  fs.copyFileSync(p1t2, path.join(s.dl, 'P01_t02_EscapeFish_custom (1).zip'));
  const p2prac = rec(s, 'P2prac.mkv', 110, T(11, 10)), p2ref1 = rec(s, 'P2ref1.mkv', 55, T(11, 5));
  trial(s, { pid: 'P02', trial: 0, practice: true, play: p2prac, ref: p2ref1, start: T(11, 12), end: T(11, 15) });
  makeTrialZip(s.dl, { pid: 'P01', exp: 'other', trial: 3, start: iso(T(10, 0)), end: iso(T(10, 1)), name: 'P01_t04_other.zip' });
  makeFile(path.join(s.rec, '2026-11-09 10-00-00.mkv'), 30, T(10, 0, 30));
  makeFile(path.join(s.rec, 'P1free.mkv'), 31, T(10, 1));
  makeFile(path.join(s.rec, 'P2free.MKV'), 32, T(11, 1));
  makeFile(path.join(s.rec, 'memo.txt'), 3, T(10, 2));
  makeFile(path.join(s.rec, 'late.mkv'), 33, T(12, 0));
  makeFile(path.join(s.rec, 'prev.mkv'), 34, T(15, 0, 0, 8));
  const logA = log(s, 'EscapeFish/log_a', T(10, 25));
  const logB = log(s, 'EscapeFish/log_b', T(11, 11), T(15, 0, 0, 8));
  const logLate = log(s, 'EscapeFish/log_late', T(12, 0));
  makeFile(path.join(s.ovgl, 'EscapeFish', 'Player.log'), 5, T(10, 25));

  const before = fs.readdirSync(s.dl).concat(fs.readdirSync(s.rec)).join();
  const p1 = s.plan();
  check('計画ではファイルを変えない', fs.readdirSync(s.dl).concat(fs.readdirSync(s.rec)).join() === before && !fs.existsSync(path.join(s.exp, 'データ')));
  check('2 人分で止める理由が無い', p1.errors.length === 0, JSON.stringify(p1.errors));
  const n1 = names(p1);
  check('1 人分：本番・基準音声・評価の練習の名前を付ける', ['P01_t02_EscapeFish_本番.mkv', 'P01_t02_EscapeFish_基準音声.mkv', 'P01_t01p_EscapeFish_評価の練習.mkv', 'P01_t01p_EscapeFish_基準音声.mkv'].every(n => n1.includes(n)), n1.join());
  const main = movedFrom(p1, path.join(s.rec, 'P1main.mkv'));
  check('本番の録画は recordings/ へ，role と参照した zip を残す', !!main && slash(main.dst).endsWith('データ/P01/recordings/P01_t02_EscapeFish_本番.mkv') && main.kind === 'recording' && main.role === '本番' && main.zip === path.basename(p1t2), JSON.stringify(main));
  check('zip に出ない録画は その他/ に元の名前で', moves(p1).some(m => slash(m.dst).endsWith('データ/P01/recordings/その他/2026-11-09 10-00-00.mkv') && m.role === 'その他'));
  check('2 人分を時間帯で振り分ける', personOf(p1, path.join(s.rec, 'P1free.mkv')) === 'P01' && personOf(p1, path.join(s.rec, 'P2free.MKV')) === 'P02'
    && personOf(p1, path.join(s.rec, 'P2prac.mkv')) === 'P02' && personOf(p1, logA) === 'P01');
  check('時間帯：最初の人は日の 0 時から，次の人は前の人の最後の end から', p1.people.map(p => `${p.pid}:${p.from}-${p.to}`).join() === `P01:${T(0, 0)}-${T(10, 30)},P02:${T(10, 30)}-${T(11, 15)}`, JSON.stringify(p1.people.map(p => [p.pid, p.from, p.to])));
  check('最後の参加者の後の録画とログは残す', p1.left.outside === 2 && !movedFrom(p1, path.join(s.rec, 'late.mkv')) && !movedFrom(p1, logLate), JSON.stringify(p1.left));
  check('最初の参加者の日より前は残す', !movedFrom(p1, path.join(s.rec, 'prev.mkv')) && p1.left.before === 1, JSON.stringify(p1.left));
  const logMoves = moves(p1).filter(m => m.kind === 'log');
  check('ログは include に合うものだけ', logMoves.length === 2 && logMoves.every(m => /log_[ab]$/.test(m.src)) && !names(p1).includes('Player.log')
    && logMoves.some(m => slash(m.dst).endsWith('データ/P01/logs/OVGL/EscapeFish/log_a')), JSON.stringify(logMoves));
  check('ログのフォルダは中のファイルの最も新しい日時で振り分ける（フォルダの日時は使わない）', personOf(p1, logB) === 'P02');
  check('(1) の付いた重複の zip も annotator/ へ', n1.includes('P01_t02_EscapeFish_custom (1).zip') && n1.includes('P01_t02_EscapeFish_custom.zip')
    && moves(p1).filter(m => m.kind === 'zip').every(m => slash(m.dst).includes('/annotator/')) && !n1.includes('P01_t04_other.zip'));
  check('録画の拡張子の大文字小文字を問わず，録画でないファイルは移さない', !!movedFrom(p1, path.join(s.rec, 'P2free.MKV')) && !movedFrom(p1, path.join(s.rec, 'memo.txt')));
  check('試行の数が足りなければ警告', p1.warnings.some(w => w.includes('P02') && w.includes('試行の数')) && !p1.warnings.some(w => w.includes('P01') && w.includes('試行の数')), JSON.stringify(p1.warnings));

  // 移し先にすでに同じ名前がある
  makeFile(path.join(s.exp, 'データ', 'P01', 'recordings', 'P01_t02_EscapeFish_本番.mkv'), 1, null);
  check('移し先に同じ名前があれば止める', s.plan().errors.some(e => e.includes('すでに')));
  fs.rmSync(path.join(s.exp, 'データ'), { recursive: true, force: true });
  // 大きさの違う同名の録画
  makeFile(path.join(s.rec, 'P1main.mkv'), 201, T(10, 20));
  const pSize = s.plan();
  check('大きさが違う同名の録画は止める', pSize.errors.some(e => e.includes('P01') && e.includes('t02') && e.includes('P1main.mkv')), JSON.stringify(pSize.errors));
  makeFile(path.join(s.rec, 'P1main.mkv'), 200, T(10, 21));
  check('更新日時が違う同名の録画も止める', s.plan().errors.some(e => e.includes('P1main.mkv')));
  makeFile(path.join(s.rec, 'P1main.mkv'), 200, T(10, 20));
  fs.rmSync(path.join(s.rec, 'P1ref2.mkv'));
  const pMiss = s.plan();
  check('参照した録画が無ければ止める', pMiss.errors.some(e => e.includes('見つかりません') && e.includes('P1ref2.mkv') && e.includes('t02')), JSON.stringify(pMiss.errors));
  rec(s, 'P1ref2.mkv', 60, T(10, 18));
  check('元に戻せば止める理由が無い', s.plan().errors.length === 0);
  // 名前・大きさ・日時が同じ録画が 2 つ：録画のフォルダの直下だけを探すので同じ名前のファイルは 2 つできない．この検査は置かない

  // 集め済みの参加者
  fs.mkdirSync(path.join(s.exp, 'データ'), { recursive: true });
  fs.writeFileSync(path.join(s.exp, 'データ', '.collect-state.json'), JSON.stringify({ people: [{ pid: 'P01', to: T(10, 30), at: iso(T(13, 0)) }] }));
  const pDone = s.plan();
  check('集め済みの参加者は除き，その人の新しい zip は警告', !pDone.people.some(p => p.pid === 'P01') && pDone.warnings.some(w => w.includes('P01') && w.includes('集め済み') && w.includes('P1main.mkv') && w.includes('P1ref1.mkv'))
    && !moves(pDone).some(m => path.basename(m.src).startsWith('P01_')), JSON.stringify(pDone.warnings));
  check('集め済みの人の後は記録の終わりから始める', pDone.people.length === 1 && pDone.people[0].from === T(10, 30) && pDone.errors.length === 0, JSON.stringify(pDone.people.map(p => [p.pid, p.from])) + JSON.stringify(pDone.errors));
  check('集め済みの人の zip が参照する録画は その他/ にしない', !movedFrom(pDone, path.join(s.rec, 'P1main.mkv')) && !movedFrom(pDone, path.join(s.rec, 'P1free.mkv')));
  // 集め忘れた参加者が集め済みの参加者より前にいる
  const p00 = makeTrialZip(s.dl, { pid: 'P00', trial: 0, start: iso(T(9, 0)), end: iso(T(9, 10)) });
  const pForgot = s.plan();
  check('集め忘れた参加者が集め済みの人より前にいれば，そう説明して止める', pForgot.errors.some(e => e.includes('P00') && e.includes('集め忘れ') && e.includes('重な')), JSON.stringify(pForgot.errors));
  fs.rmSync(p00);
  // 試行の zip に見える名前なのに読めない
  fs.writeFileSync(path.join(s.dl, 'P02_t05_EscapeFish_custom.zip'), 'downloading');
  fs.writeFileSync(path.join(s.dl, 'random.zip'), 'not a zip');
  const pBroken = s.plan();
  check('試行の zip に見える名前で読めない zip は名前を出して止める', pBroken.errors.some(e => e.includes('P02_t05_EscapeFish_custom.zip') && e.includes('読めません'))
    && !pBroken.errors.some(e => e.includes('random.zip')), JSON.stringify(pBroken.errors));
  fs.rmSync(path.join(s.dl, 'P02_t05_EscapeFish_custom.zip'));
  // 集めた記録が壊れている
  const stateFile = path.join(s.exp, 'データ', '.collect-state.json');
  fs.writeFileSync(stateFile, JSON.stringify({ people: [{ pid: 'P01', to: 'x', at: iso(T(13, 0)) }] }));
  const pState = s.plan();
  check('.collect-state.json の to が数でなければ止める', pState.errors.some(e => e.includes('.collect-state.json')) && pState.people.length === 0, JSON.stringify(pState.errors));
  fs.writeFileSync(stateFile, '{ broken');
  check('.collect-state.json が読めなければ止める', s.plan().errors.some(e => e.includes('.collect-state.json')));
}
{
  const { planCollect } = require('../tools/collect/collect');
  const T = (h, m, s = 0, d = 9) => new Date(2026, 10, d, h, m, s).getTime();
  const iso = t => new Date(t).toISOString();
  const slash = p => p.replace(/\\/g, '/');
  const moves = plan => plan.people.flatMap(p => p.moves);
  const names = plan => moves(plan).map(m => path.basename(m.dst));
  function scene(name, participants) {
    const d = fresh(name), exp = path.join(d, 'exp');
    fs.mkdirSync(path.join(exp, 'ツール'), { recursive: true });
    fs.writeFileSync(path.join(exp, 'experiment.json'), JSON.stringify({ name: 'exp3', participants }));
    fs.writeFileSync(path.join(exp, 'ツール', '設定.json'), JSON.stringify({ zips: '../dl', recordings: '../rec', logs: [{ name: 'OVGL', path: '../OVGL', include: '*/log_*' }] }));
    for (const sub of ['dl', 'rec', 'OVGL']) fs.mkdirSync(path.join(d, sub));
    return { exp, dl: path.join(d, 'dl'), rec: path.join(d, 'rec'), plan: () => planCollect(exp, loadConfig(exp)) };
  }
  const rec = (s, name, size, mtime) => { makeFile(path.join(s.rec, name), size, mtime); return { file: name, size, lastModified: mtime }; };
  const trial = (s, o) => makeTrialZip(s.dl, { exp: 'exp3', condition: 'EscapeFish', video: o.condition || 'EscapeFish', ...o, start: iso(o.start), end: o.end != null ? iso(o.end) : undefined,
    record: { file: o.play.file, size: o.play.size, last_modified: o.play.lastModified, ref_video: o.ref.file, ref_video_size: o.ref.size, ref_video_last_modified: o.ref.lastModified } });
  const four = [0, 1, 2, 3].map(() => ({ mode: 'custom', video: 'a.mp4' }));

  // やり直しと途中終了
  const s = scene('plan-やり直し', { P01: four });
  const ref = rec(s, 'ref.mkv', 40, T(10, 5)), old = rec(s, 'old.mkv', 100, T(10, 10)), neu = rec(s, 'new.mkv', 101, T(10, 20));
  const z0 = trial(s, { pid: 'P01', trial: 1, play: old, ref, start: T(10, 11), end: T(10, 15) });
  trial(s, { pid: 'P01', trial: 1, redo: 1, play: neu, ref, start: T(10, 21), end: T(10, 25) });
  const pRefC = rec(s, 'refC.mkv', 41, T(10, 30)), hunt = rec(s, 'hunt.mkv', 102, T(10, 35));
  trial(s, { pid: 'P01', trial: 2, partial: true, condition: 'HunterChameleon', play: hunt, ref: pRefC, start: T(10, 36), mtime: T(10, 40) }); // 途中で抜けた zip に end_iso は無い
  const p = s.plan(), n = names(p);
  check('やり直しで止める理由が無い', p.errors.length === 0, JSON.stringify(p.errors));
  check('やり直した試行は最後のやり直しの録画に名前を付ける', n.includes('P01_t02_EscapeFish_本番.mkv') && slash(moves(p).find(m => m.dst.endsWith('P01_t02_EscapeFish_本番.mkv')).src).endsWith('new.mkv'));
  check('同じ録画を 2 つの zip が参照しても名前は 1 つ', n.filter(x => x === 'P01_t02_EscapeFish_基準音声.mkv').length === 1 && moves(p).filter(m => m.src.endsWith('ref.mkv')).length === 1);
  const om = moves(p).find(m => m.src.endsWith('old.mkv'));
  check('やり直し前だけが参照する録画は その他/ へ', !!om && slash(om.dst).endsWith('recordings/その他/old.mkv') && om.zip === path.basename(z0), JSON.stringify(om));
  check('_partial しか無い試行の録画は _本番_partial', n.includes('P01_t03_HunterChameleon_本番_partial.mkv') && n.includes('P01_t03_HunterChameleon_基準音声_partial.mkv'), n.join());
  check('_partial の zip があれば警告', p.warnings.some(w => w.includes('_partial')), JSON.stringify(p.warnings));
  check('時間帯にゲームのログが無ければ警告', p.warnings.some(w => w.includes('ログ')));
  check('完了した試行の数を数えて警告', p.warnings.some(w => w.includes('試行の数') && w.includes('1') && w.includes('4')));

  // 更新日時の無い古い zip
  const s2 = scene('plan-古いzip', { P01: [{ mode: 'custom', video: 'a.mp4' }] });
  const a = rec(s2, 'a.mkv', 100, T(10, 10)), b = rec(s2, 'b.mkv', 50, T(10, 5));
  trial(s2, { pid: 'P01', trial: 0, play: { file: a.file, size: a.size }, ref: { file: b.file, size: b.size }, start: T(10, 11), end: T(10, 15) });
  const p2 = s2.plan();
  check('更新日時の無い古い zip は名前と大きさで照合し警告する', p2.errors.length === 0 && p2.warnings.some(w => w.includes('更新日時')) && names(p2).includes('P01_t01_EscapeFish_本番.mkv'), JSON.stringify(p2));

  // 時刻が重なる 2 人
  const s3 = scene('plan-重なり', { P01: [{ mode: 'custom', video: 'a.mp4' }], P02: [{ mode: 'custom', video: 'a.mp4' }] });
  trial(s3, { pid: 'P01', trial: 0, play: rec(s3, 'a.mkv', 1, T(10, 0)), ref: rec(s3, 'b.mkv', 2, T(10, 0)), start: T(10, 0), end: T(11, 0) });
  trial(s3, { pid: 'P02', trial: 0, play: rec(s3, 'c.mkv', 3, T(10, 40)), ref: rec(s3, 'd.mkv', 4, T(10, 40)), start: T(10, 30), end: T(11, 30) });
  check('時刻が重なる 2 人は止める', s3.plan().errors.some(e => e.includes('重な')));

  // 名前に使えない文字・条件名が無いとき
  const s4 = scene('plan-名前', { P01: [{ mode: 'custom', video: 'a.mp4' }, { mode: 'custom', video: 'a.mp4' }] });
  trial(s4, { pid: 'P01', trial: 0, condition: 'A/B:C?', video: 'v', play: rec(s4, 'a.mp4', 1, T(10, 0)), ref: rec(s4, 'b.mkv', 2, T(10, 0)), start: T(10, 1), end: T(10, 2) });
  trial(s4, { pid: 'P01', trial: 1, condition: '', video: 'x', method: 'sam', play: rec(s4, 'c.mkv', 3, T(10, 3)), ref: rec(s4, 'd.mkv', 4, T(10, 3)), start: T(10, 4), end: T(10, 5) });
  trial(s4, { pid: 'P01', trial: 2, condition: '', video: 'y', method: '', play: rec(s4, 'e.mkv', 5, T(10, 6)), ref: rec(s4, 'f.mkv', 6, T(10, 6)), start: T(10, 7), end: T(10, 8) });
  const n4 = names(s4.plan());
  check('使えない文字は _ にし，拡張子は残し，条件名が無ければ方式 id', n4.includes('P01_t01_A_B_C__本番.mp4') && n4.includes('P01_t02_sam_本番.mkv'), n4.join());
  check('条件名も方式 id も無ければ trial', n4.includes('P01_t03_trial_本番.mkv'), n4.join());

  // end_iso の無い _partial の zip は，zip の更新日時を時間帯の終わりに使う
  const s7 = scene('plan-partialの終わり', { P01: [{ mode: 'custom', video: 'a.mp4' }, { mode: 'custom', video: 'a.mp4' }], P02: [{ mode: 'custom', video: 'a.mp4' }] });
  const ov7 = path.join(path.dirname(s7.exp), 'OVGL');
  trial(s7, { pid: 'P01', trial: 0, play: rec(s7, 'a.mkv', 1, T(10, 0)), ref: rec(s7, 'b.mkv', 2, T(10, 0)), start: T(10, 1), end: T(10, 30) });
  trial(s7, { pid: 'P01', trial: 1, partial: true, play: rec(s7, 'c.mkv', 3, T(10, 34)), ref: rec(s7, 'd.mkv', 4, T(10, 33)), start: T(10, 35), mtime: T(10, 50) });
  trial(s7, { pid: 'P02', trial: 0, play: rec(s7, 'e.mkv', 5, T(11, 2)), ref: rec(s7, 'f.mkv', 6, T(11, 1)), start: T(11, 3), end: T(11, 10) });
  const logP = path.join(ov7, 'EscapeFish', 'log_p');
  makeFile(path.join(logP, 'x.json'), 5, T(10, 40));
  makeFile(path.join(ov7, 'EscapeFish', 'log_q', 'x.json'), 5, T(11, 5));
  const p7 = s7.plan(), lm7 = p7.people.map(p => [p.pid, p.moves.filter(m => m.kind === 'log').map(m => path.basename(m.src)).join()]);
  check('end の無い _partial の zip の更新日時までをその人の時間帯にする', p7.errors.length === 0 && p7.people[0].to === T(10, 50) && p7.people[1].from === T(10, 50)
    && JSON.stringify(lm7) === JSON.stringify([['P01', 'log_p'], ['P02', 'log_q']]), JSON.stringify({ e: p7.errors, lm7, to: p7.people.map(p => p.to) }));

  // 開始の時刻がまったく無い参加者は止める
  const s8 = scene('plan-時刻なし', { P09: [{ mode: 'custom', video: 'a.mp4' }] });
  makeTrialZip(s8.dl, { pid: 'P09', exp: 'exp3', trial: 0 });
  check('使える時刻の無い参加者は止める', s8.plan().errors.some(e => e.includes('P09') && e.includes('時刻')));

  // 実際のゲームのログの形：OVGL/<ゲーム>/PlayLogs/<項目>
  const s6 = scene('plan-PlayLogs', { P01: [{ mode: 'custom', video: 'a.mp4' }] });
  fs.writeFileSync(path.join(s6.exp, 'ツール', '設定.json'), JSON.stringify({ zips: '../dl', recordings: '../rec', logs: [{ name: 'OVGL', path: '../OVGL', include: '*/PlayLogs/*' }] }));
  const ov = path.join(path.dirname(s6.exp), 'OVGL');
  trial(s6, { pid: 'P01', trial: 0, play: rec(s6, 'a.mkv', 1, T(10, 0)), ref: rec(s6, 'b.mkv', 2, T(10, 0)), start: T(10, 1), end: T(10, 30) });
  makeFile(path.join(ov, 'Sliding-Penguin', 'PlayLogs', 'play_1', 'x.json'), 5, T(10, 10));
  makeFile(path.join(ov, 'iwashi', 'PlayLogs', 'play_2.csv'), 5, T(10, 20));
  makeFile(path.join(ov, 'iwashi', 'Player.log'), 5, T(10, 20));
  makeFile(path.join(ov, 'New-HunterChameleon', 'Saves', 'x'), 5, T(10, 20));
  makeFile(path.join(ov, 'New-HunterChameleon', 'PlayLogs'), 5, T(10, 20)); // 途中の深さのファイルには入らない
  const lm6 = moves(s6.plan()).filter(m => m.kind === 'log');
  check('include が */PlayLogs/* でも，その深さのフォルダとファイルだけを移す', lm6.length === 2
    && lm6.some(m => slash(m.dst).endsWith('logs/OVGL/Sliding-Penguin/PlayLogs/play_1')) && lm6.some(m => slash(m.dst).endsWith('logs/OVGL/iwashi/PlayLogs/play_2.csv')),
  JSON.stringify(lm6.map(m => slash(m.src))));

  // 対象がいない
  const s5 = scene('plan-空', { P01: [] });
  const p5 = s5.plan();
  check('集める対象がいなければ警告して何も移さない', p5.people.length === 0 && p5.errors.length === 0 && p5.warnings.some(w => w.includes('対象')));
}

// ---------- Task 4：runCollect と CLI ----------
{
  const { spawnSync } = require('child_process');
  const { planCollect, runCollect } = require('../tools/collect/collect');
  const CLI = path.join(__dirname, '..', 'tools', 'collect', 'collect.js');
  const T = (h, m, s = 0, d = 9) => new Date(2026, 10, d, h, m, s).getTime();
  const iso = t => new Date(t).toISOString();
  const moves = plan => plan.people.flatMap(p => p.moves);
  const exists = p => fs.existsSync(p);
  function scene(name) {
    const d = fresh(name), exp = path.join(d, 'exp');
    fs.mkdirSync(path.join(exp, 'ツール'), { recursive: true });
    const one = [{ mode: 'custom', video: 'a.mp4' }];
    fs.writeFileSync(path.join(exp, 'experiment.json'), JSON.stringify({ name: 'exp3', participants: { P01: one, P02: one } }));
    fs.writeFileSync(path.join(exp, 'ツール', '設定.json'), JSON.stringify({ zips: '../dl', recordings: '../rec', logs: [{ name: 'OVGL', path: '../OVGL', include: '*/log_*' }] }));
    for (const sub of ['dl', 'rec', 'OVGL']) fs.mkdirSync(path.join(d, sub));
    const s = { exp, dl: path.join(d, 'dl'), rec: path.join(d, 'rec'), ovgl: path.join(d, 'OVGL'), data: path.join(exp, 'データ') };
    s.plan = () => planCollect(exp, loadConfig(exp));
    s.state = () => JSON.parse(fs.readFileSync(path.join(s.data, '.collect-state.json'), 'utf8'));
    return s;
  }
  const rec = (s, name, size, mtime) => { makeFile(path.join(s.rec, name), size, mtime); return { file: name, size, lastModified: mtime }; };
  const trial = (s, o) => makeTrialZip(s.dl, { exp: 'exp3', condition: 'EscapeFish', video: 'EscapeFish', ...o, start: iso(o.start), end: iso(o.end),
    record: { file: o.play.file, size: o.play.size, last_modified: o.play.lastModified, ref_video: o.ref.file, ref_video_size: o.ref.size, ref_video_last_modified: o.ref.lastModified } });
  // P01 は 10 時台，P02 は 11 時台．それぞれ zip・録画 2 つ・どの zip にも出ない録画・ゲームのログ（フォルダ）を持つ
  function two(name) {
    const s = scene(name);
    trial(s, { pid: 'P01', trial: 0, play: rec(s, 'P1main.mkv', 200, T(10, 20)), ref: rec(s, 'P1ref.mkv', 60, T(10, 18)), start: T(10, 22), end: T(10, 30) });
    trial(s, { pid: 'P02', trial: 0, play: rec(s, 'P2main.mkv', 210, T(11, 20)), ref: rec(s, 'P2ref.mkv', 61, T(11, 18)), start: T(11, 22), end: T(11, 30) });
    makeFile(path.join(s.rec, 'P1free.mkv'), 31, T(10, 1));
    makeFile(path.join(s.ovgl, 'EscapeFish', 'log_a', 'trial_1', 'x.json'), 10, T(10, 25));
    makeFile(path.join(s.ovgl, 'EscapeFish', 'log_a', 'y.csv'), 12, T(10, 25));
    makeFile(path.join(s.ovgl, 'EscapeFish', 'log_b', 'x.json'), 11, T(11, 25));
    return s;
  }

  const s = two('run-2人');
  const plan = s.plan();
  check('実行前の計画に止める理由が無い', plan.errors.length === 0 && plan.people.length === 2, JSON.stringify(plan.errors));
  const r = runCollect(s.exp, plan);
  const ms = moves(plan);
  check('runCollect は集めた参加者を返し failed は null', JSON.stringify(r) === JSON.stringify({ done: ['P01', 'P02'], failed: null }), JSON.stringify(r));
  check('実行すると移し先にそろい元は消える', ms.length > 0 && ms.every(m => exists(m.dst) && !exists(m.src)), JSON.stringify(ms.filter(m => !exists(m.dst) || exists(m.src))));
  const logDst = path.join(s.data, 'P01', 'logs', 'OVGL', 'EscapeFish', 'log_a');
  check('ログのフォルダは中のファイルごと移す', fs.statSync(path.join(logDst, 'trial_1', 'x.json')).size === 10 && fs.statSync(path.join(logDst, 'y.csv')).size === 12);
  check('移した録画の大きさと更新日時は元と同じ', fs.statSync(path.join(s.data, 'P01', 'recordings', 'P01_t01_EscapeFish_本番.mkv')).size === 200
    && Math.floor(fs.statSync(path.join(s.data, 'P01', 'recordings', 'P01_t01_EscapeFish_本番.mkv')).mtimeMs) === T(10, 20));
  const csv = csvParse(fs.readFileSync(path.join(s.data, 'P01', 'files.csv'), 'utf8'));
  const p1moves = plan.people[0].moves;
  check('files.csv に元の場所・移した先・参照した zip が並ぶ', csv.length === p1moves.length + 1 && JSON.stringify(csv[0]) === JSON.stringify(['元の場所', '移した先', '種類', '役割', '参照した zip'])
    && p1moves.every(m => csv.some(row => row[0] === m.src && row[1] === m.dst && row[2] === m.kind && row[3] === m.role && row[4] === m.zip)), JSON.stringify(csv));
  const st = s.state();
  check('参加者ごとに .collect-state.json に記録する', st.people.map(p => p.pid).join() === 'P01,P02' && st.people.every((p, i) => p.to === plan.people[i].to && isFinite(Date.parse(p.at))), JSON.stringify(st));
  const again = s.plan();
  check('2 回目の実行では集め済みを集め直さない', again.people.length === 0 && again.errors.length === 0, JSON.stringify(again));
  check('終わったら .collect.lock を消す', !exists(path.join(s.data, '.collect.lock')));
  const s0 = two('run-止める理由');
  const plan0 = s0.plan();
  const r0 = runCollect(s0.exp, { ...plan0, errors: ['x'] });
  check('止める理由がある計画では何もしない', !!r0.failed && r0.done.length === 0 && moves(plan0).every(m => exists(m.src)) && !exists(s0.data), JSON.stringify(r0));

  // 2 人目のコピーで 1 バイト欠けさせる
  const s2 = two('run-大きさ違い');
  const plan2 = s2.plan();
  const shortCopy = (src, dst) => { fs.copyFileSync(src, dst); if (path.basename(src) === 'P2main.mkv') fs.truncateSync(dst, fs.statSync(src).size - 1); };
  const r2 = runCollect(s2.exp, plan2, { copy: shortCopy });
  const p2moves = plan2.people[1].moves;
  check('コピーの大きさが合わなければ元を消さずに止める', !!r2.failed && r2.failed.includes('P2main.mkv') && p2moves.every(m => exists(m.src))
    && JSON.stringify(r2.done) === '["P01"]' && s2.state().people.map(p => p.pid).join() === 'P01', JSON.stringify(r2));
  check('止めた参加者の作りかけのコピーは消し，files.csv も書かない', p2moves.every(m => !exists(m.dst)) && !exists(path.join(s2.data, 'P02', 'files.csv')));
  const redo = s2.plan();
  check('止めた後にもう一度実行すると残りの参加者を集められる', redo.errors.length === 0 && redo.people.map(p => p.pid).join() === 'P02'
    && runCollect(s2.exp, redo).failed === null && p2moves.every(m => exists(m.dst) && !exists(m.src)), JSON.stringify(redo.errors));

  // コピーした後に元が書き換わった（録画の書き込みが続いていたなど）
  const s8 = two('run-元が変わった');
  const plan8 = s8.plan();
  const grow = (src, dst) => { fs.copyFileSync(src, dst); if (path.basename(src) === 'P1ref.mkv') fs.appendFileSync(path.join(s8.rec, 'P1main.mkv'), 'x'); };
  const r8 = runCollect(s8.exp, plan8, { copy: grow });
  check('コピーした後に元が変わっていれば元を消さずに止める', !!r8.failed && r8.failed.includes('P1main.mkv') && r8.done.length === 0
    && moves(plan8).every(m => exists(m.src)) && !exists(path.join(s8.data, '.collect-state.json')), JSON.stringify(r8));

  // コピーの直前に移し先ができた（もう 1 つの窓が同時に集めているなど）
  const s9 = two('run-コピー直前');
  const plan9 = s9.plan();
  const p1main9 = plan9.people[0].moves.find(m => m.src.endsWith('P1main.mkv'));
  const race = (src, dst) => { if (src === p1main9.src) makeFile(dst, 1); fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL); };
  const r9 = runCollect(s9.exp, plan9, { copy: race });
  check('コピーの直前に移し先ができても上書きせず，その移し先を消さずに止める', !!r9.failed && r9.failed.includes('すでに') && r9.done.length === 0
    && fs.statSync(p1main9.dst).size === 1 && moves(plan9).every(m => exists(m.src))
    && plan9.people[0].moves.filter(m => m !== p1main9).every(m => !exists(m.dst)) && !exists(path.join(s9.data, '.collect-state.json')), JSON.stringify(r9));

  // 前の実行の .collect.lock が残っている
  const s10 = two('run-ロック');
  const plan10 = s10.plan();
  makeFile(path.join(s10.data, '.collect.lock'), 1);
  const r10 = runCollect(s10.exp, plan10);
  check('.collect.lock があれば何も移さずに止める', !!r10.failed && r10.failed.includes('.collect.lock') && r10.done.length === 0
    && moves(plan10).every(m => exists(m.src) && !exists(m.dst)) && exists(path.join(s10.data, '.collect.lock')), JSON.stringify(r10));

  // 元のファイルを消せない
  const s11 = two('run-消せない');
  const plan11 = s11.plan();
  const r11 = runCollect(s11.exp, plan11, { unlink: p => { if (path.basename(p) === 'P1free.mkv') throw new Error('使用中'); fs.unlinkSync(p); } });
  const free11 = plan11.people[0].moves.find(m => m.src.endsWith('P1free.mkv'));
  check('元を消せなければ記録したうえで残した元を知らせて止める', !!r11.failed && r11.failed.includes('P1free.mkv') && JSON.stringify(r11.done) === '["P01"]'
    && exists(free11.src) && exists(free11.dst) && s11.state().people.map(p => p.pid).join() === 'P01' && plan11.people[1].moves.every(m => exists(m.src)), JSON.stringify(r11));

  // 確かめた後にゲームがログのフォルダへ書き足した
  const s12 = two('run-ログ書き足し');
  const plan12 = s12.plan();
  const logA12 = path.join(s12.ovgl, 'EscapeFish', 'log_a');
  const r12 = runCollect(s12.exp, plan12, { unlink: p => { if (path.basename(p) === 'y.csv') fs.writeFileSync(path.join(logA12, 'new.txt'), 'n'); fs.unlinkSync(p); } });
  check('ログのフォルダは確かめたファイルだけを消し，後から書かれたファイルは残す', !!r12.failed && r12.failed.includes('log_a') && exists(path.join(logA12, 'new.txt'))
    && !exists(path.join(logA12, 'y.csv')) && !exists(path.join(logA12, 'trial_1')) && JSON.stringify(r12.done) === '["P01"]', JSON.stringify(r12));

  // 元を消した後に .collect-state.json を書けない
  const s13 = two('run-記録できない');
  const plan13 = s13.plan();
  fs.mkdirSync(path.join(s13.data, '.collect-state.json.tmp'), { recursive: true });
  const r13 = runCollect(s13.exp, plan13);
  check('元を消した後に記録できなければ，移し終えたことと手で足すことを知らせる', !!r13.failed && r13.failed.includes('データ/P01/') && r13.failed.includes('手で足して')
    && plan13.people[0].moves.every(m => exists(m.dst) && !exists(m.src)) && r13.done.length === 0, JSON.stringify(r13));

  // 計画の後に移し先ができた
  const s3 = two('run-移し先あり');
  const plan3 = s3.plan();
  const blocker = plan3.people[0].moves.find(m => m.kind === 'recording').dst;
  makeFile(blocker, 1);
  const r3 = runCollect(s3.exp, plan3);
  check('計画の後に移し先ができていれば上書きせずに止める', !!r3.failed && r3.done.length === 0 && fs.statSync(blocker).size === 1 && moves(plan3).every(m => exists(m.src)), JSON.stringify(r3));

  // CLI
  // 失敗したときだけ出力を見せる
  const said = (ok, c) => (ok ? '' : `${c.status} ${c.stdout} ${c.stderr}`);
  const run = (args, input) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', input: input || '', timeout: 20000 });
  const s4 = two('cli-yes');
  const plan4 = s4.plan();
  const c4 = run([s4.exp, '--yes']);
  { const ok = c4.status === 0 && moves(plan4).every(m => exists(m.dst) && !exists(m.src)); check('CLI に --yes を付けると確認せずに動く', ok, said(ok, c4)); }
  { const ok = c4.stdout.includes('P01') && c4.stdout.includes('P01_t01_EscapeFish_本番.mkv') && c4.stdout.includes('→'); check('CLI は計画を日本語で表示する', ok, said(ok, c4)); }
  const c4b = run([s4.exp, '--yes']);
  { const ok = c4b.status === 0 && c4b.stdout.includes('集める対象の参加者がいません'); check('CLI は集める対象がいなければそう言って終わる', ok, said(ok, c4b)); }

  const s5 = two('cli-止める');
  fs.rmSync(path.join(s5.rec, 'P2ref.mkv'));
  const c5 = run([s5.exp, '--yes']);
  { const ok = c5.status === 1 && c5.stdout.includes('P2ref.mkv') && c5.stdout.includes('見つかりません') && exists(path.join(s5.rec, 'P1main.mkv')); check('CLI は止める条件があれば終了コード 1', ok, said(ok, c5)); }

  const s6 = two('cli-確認');
  const c6n = run([s6.exp], 'n\n\n');
  { const ok = c6n.status === 0 && !exists(s6.data) && c6n.stdout.includes('Enter'); check('CLI は y 以外なら何も移さない', ok, said(ok, c6n)); }
  const c6y = run([s6.exp], 'y\n\n');
  { const ok = c6y.status === 0 && s6.state().people.length === 2; check('CLI は y で移す', ok, said(ok, c6y)); }

  const s14 = two('cli-失敗');
  makeFile(path.join(s14.data, '.collect.lock'), 1);
  const c14 = run([s14.exp, '--yes']);
  { const ok = c14.status === 1 && c14.stdout.includes('.collect.lock') && exists(path.join(s14.rec, 'P1main.mkv')); check('CLI は移す途中で止まれば終了コード 1', ok, said(ok, c14)); }

  const c7 = run([path.join(ROOT, '無い実験'), '--yes']);
  { const ok = c7.status === 1 && /experiment\.json/.test(c7.stdout + c7.stderr); check('CLI は思わぬ失敗を日本語で知らせて終了コード 1', ok, said(ok, c7)); }
}

// ---------- Task 5：aggregate ----------
{
  const { aggregate } = require('../tools/collect/aggregate');
  const exp = fresh('まとめ'), A = p => path.join(exp, 'データ', p, 'annotator');
  const T = (h, m) => `2026-11-09T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
  const sum = rows => 'trial,practice,mode\r\n' + rows.join('\r\n') + '\r\n';
  // P01：練習（excel），本番 t02（やり直し 1 回あり），本番 t03 は途中で抜けた zip だけ．bins の列は方式で違う
  makeTrialZip(A('P01'), { pid: 'P01', trial: 0, practice: true, condition: 'EscapeFish', method: 'excel', video: 'p.mkv', start: T(1, 0), end: T(1, 5),
    csvs: { 'bins.csv': 'sec,valence\r\n0,1\r\n1,2\r\n', 'events.csv': 'wall_ms,type\r\n1,a\r\n' }, trials: sum(['1,1,excel']) });
  makeTrialZip(A('P01'), { pid: 'P01', trial: 1, condition: 'EscapeFish', method: 'custom', video: 'm.mkv', start: T(1, 10), end: T(1, 15),
    csvs: { 'bins.csv': 'sec,valence,curve\r\n0,9,9\r\n' }, trials: sum(['1,1,excel', '2,0,custom']) });
  const redo = makeTrialZip(A('P01'), { pid: 'P01', trial: 1, condition: 'EscapeFish', method: 'custom', video: 'm.mkv', redo: 1, start: T(1, 20), end: T(1, 25),
    csvs: { 'bins.csv': 'sec,valence,curve\r\n0,5,6\r\n' }, trials: sum(['1,1,excel', '2,0,custom']) });
  fs.copyFileSync(redo, redo.replace(/\.zip$/, ' (1).zip'));
  makeTrialZip(A('P01'), { pid: 'P01', trial: 2, condition: 'Sliding Penguin', method: 'custom', video: 'q.mkv', partial: true, start: T(1, 30),
    csvs: { 'bins.csv': 'sec,valence,curve\r\n0,7,7\r\n' }, trials: sum(['1,1,excel', '2,0,custom', '3,0,custom']) });
  // P02：本番 1 つ
  makeTrialZip(A('P02'), { pid: 'P02', trial: 0, condition: 'iwashi', method: 'custom', video: 'r.mkv', start: T(2, 0), end: T(2, 5),
    csvs: { 'bins.csv': 'sec,valence,curve\r\n0,3,4\r\n' }, trials: sum(['1,0,custom']) });

  const r = aggregate(exp);
  const read = n => csvParse(fs.readFileSync(path.join(exp, 'データ', '全員分', n), 'utf8'));
  check('種類ごとに 1 つの表になる', r.written.map(f => path.basename(f)).join() === 'bins.csv,events.csv,trials.csv', r.written.map(f => path.basename(f)).join());
  const bins = read('bins.csv'), head = bins[0];
  check('先頭に participant〜redo の列が付く', JSON.stringify(head.slice(0, 7)) === JSON.stringify(['participant', 'trial', 'practice', 'condition', 'method', 'video', 'redo']), JSON.stringify(head));
  const col = (row, c) => row[head.indexOf(c)];
  const p1t2 = bins.filter(x => x[0] === 'P01' && x[1] === '2');
  check('やり直しは最後の回だけ', p1t2.length === 1 && col(p1t2[0], 'valence') === '5' && col(p1t2[0], 'redo') === '1', JSON.stringify(p1t2));
  check('_partial と重複とやり直し前は除き，一覧に出す', !bins.some(x => x[1] === '3') && r.skipped.some(s => s.includes('_partial')) && r.skipped.some(s => s.includes('(1)')) && r.skipped.some(s => s.includes('やり直す前')), JSON.stringify(r.skipped));
  const p1t1 = bins.filter(x => x[0] === 'P01' && x[1] === '1');
  check('方式で列が違えば和集合にして空欄で埋める', head.includes('curve') && p1t1.length === 2 && p1t1.every(x => col(x, 'curve') === '') && col(p1t1[0], 'practice') === '1' && col(p1t1[0], 'method') === 'excel' && col(p1t1[0], 'video') === 'p.mkv', JSON.stringify(p1t1));
  check('試行の番号は 1 始まり，条件名が入る', bins.some(x => x[0] === 'P02' && x[1] === '1' && col(x, 'condition') === 'iwashi'));
  const tr = read('trials.csv');
  check('trials.csv は参加者ごとに最後の zip のものだけ', tr[0].join() === 'participant,trial,practice,mode' && tr.filter(x => x[0] === 'P01').length === 2 && tr.filter(x => x[0] === 'P02').length === 1, JSON.stringify(tr));
  const before = fs.readFileSync(path.join(exp, 'データ', '全員分', 'bins.csv'));
  fs.writeFileSync(path.join(exp, 'データ', '全員分', 'old.csv'), 'x');
  aggregate(exp);
  check('2 回実行しても同じ結果で，全員分/ を作り直す', before.equals(fs.readFileSync(path.join(exp, 'データ', '全員分', 'bins.csv'))) && !fs.existsSync(path.join(exp, 'データ', '全員分', 'old.csv')));
  const cli = require('child_process').spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'collect', 'aggregate.js'), exp, '--yes'], { encoding: 'utf8' });
  check('CLI に --yes を付けると待たずに終わる', cli.status === 0 && cli.stdout.includes('全員分'), cli.stdout + cli.stderr);
}

// ---------- Task 6：bat と配布用の zip ----------
{
  const SRC = path.join(__dirname, '..', 'tools', 'collect'), ZIP = path.join(__dirname, '..', 'collect-tools.zip');
  const bats = fs.readdirSync(SRC).filter(n => n.endsWith('.bat'));
  check('bat は 4 つで，番号順の名前', bats.sort().join() === '0_最初に1回_Node.jsを入れる.bat,1_結果を集める.bat,2_全員終わったら_表にまとめる.bat,3_Driveにあげる.bat', bats.join());
  const bat1 = fs.readFileSync(path.join(SRC, '1_結果を集める.bat'), 'latin1');
  check('集める bat は，集め終えたら --auto で Drive にあげ，失敗したらあげずに止まる', /collect\.js" "%~dp0\.\." --no-pause\r\nif errorlevel 1 \(\r\n  pause\r\n  exit \/b 1\r\n\)\r\nnode "%~dp0upload\.js" "%~dp0\.\." --auto/.test(bat1), bat1);
  check('Drive にあげる bat は upload.js に引数をそのまま渡す', /node "%~dp0upload\.js" "%~dp0\.\." %\*/.test(fs.readFileSync(path.join(SRC, '3_Driveにあげる.bat'), 'latin1')));
  check('bat の中身は ASCII だけ', bats.every(n => fs.readFileSync(path.join(SRC, n)).every(b => b < 0x80)));
  check('bat は Node.js の有無を同じ形で確かめる', bats.slice(1).every(n => fs.readFileSync(path.join(SRC, n), 'latin1').includes('where node >nul 2>nul\r\n')));
  check('bat の改行は CRLF', bats.every(n => { const t = fs.readFileSync(path.join(SRC, n), 'latin1'); return t.includes('\r\n') && !/[^\r]\n/.test(t); }));
  check('bat は自分の 1 つ上を実験フォルダとして渡す', /node "%~dp0collect\.js" "%~dp0\.\."/.test(fs.readFileSync(path.join(SRC, '1_結果を集める.bat'), 'latin1'))
    && /node "%~dp0aggregate\.js" "%~dp0\.\."/.test(fs.readFileSync(path.join(SRC, '2_全員終わったら_表にまとめる.bat'), 'latin1')));
  const sample = JSON.parse(fs.readFileSync(path.join(SRC, '設定.json'), 'utf8'));
  check('設定の見本の logs は空', Array.isArray(sample.logs) && sample.logs.length === 0 && sample.zips && sample.recordings);
  const buf = fs.readFileSync(ZIP), ents = unzip(buf), names = fs.readdirSync(SRC).sort();
  check('配布用の zip が tools/collect/ と一致する（npm run build-collect で作り直す）', ents.map(e => e.name).sort().join() === names.map(n => `ツール/${n}`).join()
    && ents.every(e => e.data.equals(fs.readFileSync(path.join(SRC, e.name.slice('ツール/'.length))))), ents.map(e => e.name).join());
  let flags = true;
  for (let at = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])), p = buf.readUInt32LE(at + 16), k = 0; k < buf.readUInt16LE(at + 10); k++) {
    if (!(buf.readUInt16LE(p + 8) & 0x0800)) flags = false;
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  check('配布用の zip は名前を UTF-8 と示す', flags);
  // 一式を実験フォルダに展開して，ツール/collect.js と ツール/aggregate.js がそこだけで動く
  const exp = fresh('配布の一式'), dl = path.join(exp, '..', '配布の一式-dl'), vids = path.join(exp, '..', '配布の一式-録画');
  fs.rmSync(dl, { recursive: true, force: true }); fs.rmSync(vids, { recursive: true, force: true }); fs.mkdirSync(vids, { recursive: true });
  for (const e of ents) { const f = path.join(exp, e.name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, e.data); }
  fs.writeFileSync(path.join(exp, 'experiment.json'), JSON.stringify({ name: 'exp3', participants: { P01: [{ mode: 'custom' }] } }));
  fs.writeFileSync(path.join(exp, 'ツール', '設定.json'), JSON.stringify({ zips: dl, recordings: vids, logs: [] }));
  makeTrialZip(dl, { pid: 'P01', trial: 0, condition: 'iwashi', start: '2026-11-09T01:00:00.000Z', end: '2026-11-09T01:05:00.000Z' });
  const run = js => require('child_process').spawnSync(process.execPath, [path.join(exp, 'ツール', js), exp, '--yes'], { encoding: 'utf8' });
  const c = run('collect.js'), a = run('aggregate.js');
  check('ツール/ に置いた一式で集めて表にまとめられる', c.status === 0 && a.status === 0 && fs.existsSync(path.join(exp, 'データ', 'P01', 'annotator')) && fs.existsSync(path.join(exp, 'データ', '全員分', 'bins.csv')), c.stdout + c.stderr + a.stdout + a.stderr);
  // --no-pause は確認を残して最後の Enter だけを省く（bat が続けて upload.js を呼ぶため）
  const np = require('child_process').spawnSync(process.execPath, [path.join(exp, 'ツール', 'collect.js'), exp, '--no-pause'], { encoding: 'utf8', input: '' });
  check('collect.js に --no-pause を付けると最後の Enter を待たない', np.status === 0 && np.stdout.includes('集める対象の参加者がいません') && !np.stdout.includes('Enter で閉じる'), np.stdout + np.stderr);
}

// ---------- NASA-TLX の結果（<ID>_t<試行>_tlx.csv）も集めてまとめる ----------
{
  const { planCollect, runCollect } = require('../tools/collect/collect');
  const { aggregate } = require('../tools/collect/aggregate');
  const T = (h, m) => new Date(2026, 10, 9, h, m).getTime();
  const iso = t => new Date(t).toISOString();
  const d = fresh('NASA-TLX'), exp = path.join(d, 'exp'), dl = path.join(d, 'dl');
  fs.mkdirSync(path.join(exp, 'ツール'), { recursive: true }); fs.mkdirSync(dl);
  const two = [{ mode: 'excel', video: 'a.mp4' }, { mode: 'panas', video: 'b.mp4' }];
  fs.writeFileSync(path.join(exp, 'experiment.json'), JSON.stringify({ name: 'exp3', participants: { A01: two, A02: two, B01: two } }));
  fs.writeFileSync(path.join(exp, 'ツール', '設定.json'), JSON.stringify({ zips: '../dl', recordings: '../rec', recordingExts: [] }));
  // NASA-TLX の CSV（1 行）．name は実験名．mtime は答えた時刻
  const tlx = (name, o) => {
    const f = path.join(dl, name);
    fs.writeFileSync(f, '﻿pid,trial,condition,name,end_iso,mental_rating,variant,raw_tlx\n' + `${o.pid},${o.trial},${o.cond || 'Excel'},${o.exp == null ? 'exp3' : o.exp},${iso(o.end)},${o.mental || 50},raw,${o.raw || 40}\n`);
    fs.utimesSync(f, new Date(o.end), new Date(o.end));
    return f;
  };
  for (const [pid, h] of [['A01', 10], ['A02', 11]]) {
    makeTrialZip(dl, { pid, exp: 'exp3', trial: 0, condition: 'Excel', method: 'excel', video: 'a.mp4', start: iso(T(h, 0)), end: iso(T(h, 10)) });
    makeTrialZip(dl, { pid, exp: 'exp3', trial: 1, condition: 'PANAS', method: 'panas', video: 'b.mp4', start: iso(T(h, 12)), end: iso(T(h, 40)) });
  }
  const a1 = tlx('A01_t01_tlx.csv', { pid: 'A01', trial: 1, end: T(10, 12) });
  const a1last = tlx('A01_t02_tlx.csv', { pid: 'A01', trial: 2, cond: 'PANAS', end: T(11, 2) });   // 最後の試行の後に答えるので，時間帯では次の人に入ってしまう
  const other = tlx('A01_t03_tlx.csv', { pid: 'A01', trial: 3, exp: 'other', end: T(10, 50) });
  tlx('A02_t01_tlx.csv', { pid: 'A02', trial: 1, end: T(11, 11), raw: 30 });
  const dup = tlx('A02_t01_tlx (1).csv', { pid: 'A02', trial: 1, end: T(11, 11), raw: 30 });
  const nozip = tlx('B01_t01_tlx.csv', { pid: 'B01', trial: 1, end: T(11, 50) });
  const plan = planCollect(exp, loadConfig(exp));
  const mv = plan.people.flatMap(p => p.moves.map(m => ({ ...m, pid: p.pid })));
  const at = src => mv.find(m => path.resolve(m.src) === path.resolve(src));
  check('NASA-TLX：止める理由が無い', plan.errors.length === 0, JSON.stringify(plan.errors));
  check('NASA-TLX：名前の ID で振り分け，tlx/ へ移す', at(a1) && at(a1).pid === 'A01' && /データ[\\/]A01[\\/]tlx[\\/]A01_t01_tlx\.csv$/.test(at(a1).dst) && at(a1).kind === 'tlx', JSON.stringify(at(a1)));
  check('NASA-TLX：最後の試行の後に答えたものも，その人に入る', at(a1last) && at(a1last).pid === 'A01');
  check('NASA-TLX：「 (1)」の重複も移す', at(dup) && at(dup).pid === 'A02');
  check('NASA-TLX：name 列が別の実験なら移さない', !at(other));
  check('NASA-TLX：zip の無い参加者のものは移さない', !at(nozip));
  const r = runCollect(exp, plan);
  check('NASA-TLX：集める', r.failed === null && fs.existsSync(path.join(exp, 'データ', 'A01', 'tlx', 'A01_t02_tlx.csv')) && !fs.existsSync(a1last), JSON.stringify(r));
  const a = aggregate(exp), rows = csvParse(fs.readFileSync(path.join(exp, 'データ', '全員分', 'tlx.csv'), 'utf8'));
  check('NASA-TLX：全員分/tlx.csv に 1 試行 1 行でまとめる', rows[0][0] === 'participant' && rows.length === 4 && rows.filter(x => x[0] === 'A02').length === 1 && rows.slice(1).map(x => `${x[0]}:${x[rows[0].indexOf('trial')]}`).join() === 'A01:1,A01:2,A02:1', JSON.stringify(rows));
  check('NASA-TLX：重複は除いて一覧に出す', a.skipped.some(s => s.includes('A02_t01_tlx (1).csv')), JSON.stringify(a.skipped));
  tlx('A01_t04_tlx.csv', { pid: 'A01', trial: 4, end: T(12, 0) });
  const later = planCollect(exp, loadConfig(exp));
  check('NASA-TLX：集め済みの人の結果が後から残っていれば警告して移さない', later.warnings.some(w => w.includes('A01') && w.includes('NASA-TLX') && w.includes('A01_t04_tlx.csv')) && !later.people.length, JSON.stringify(later.warnings));
}

// ---------- 全体レビューの後に足した検査 ----------
{
  const R = path.join(__dirname, '..');
  const docs = ['README.md', 'experimenter-guide.html', '.claude/skills/experiment-config/SKILL.md'];
  const bad = docs.filter(d => /[\x00-\x08]/.test(fs.readFileSync(path.join(R, d), 'utf8')));
  check('文書に制御文字が混ざっていない（\0 などのエスケープの化け）', bad.length === 0, bad.join());
  const e = fresh('設定の検査'); fs.mkdirSync(path.join(e, 'ツール'));
  fs.writeFileSync(path.join(e, 'ツール', '設定.json'), JSON.stringify({ recordingExts: ['mkv', '.MP4'] }));
  check('拡張子の点を省いても補う', loadConfig(e).recordingExts.join() === '.mkv,.mp4');
  fs.writeFileSync(path.join(e, 'ツール', '設定.json'), JSON.stringify({ logs: [{ path: 'x' }] }));
  let m = ''; try { loadConfig(e); } catch (err) { m = err.message; }
  check('logs の name が無ければ形を案内して止める', m.includes('logs'), m);
}

// ---------- Drive にあげる（upload.js） ----------
{
  const { loadDrive, findRclone } = require('../tools/collect/upload');
  const UP = path.join(__dirname, '..', 'tools', 'collect', 'upload.js');
  const e = fresh('Drive'), exp = path.join(e, 'exp'), data = path.join(exp, 'データ'), out = path.join(e, 'あげ先');
  fs.mkdirSync(path.join(exp, 'ツール'), { recursive: true });
  const setDrive = drive => fs.writeFileSync(path.join(exp, 'ツール', '設定.json'), JSON.stringify(drive === undefined ? { zips: 'x' } : { zips: 'x', drive }));
  const err = f => { try { f(); return ''; } catch (x) { return x.message; } };
  setDrive(undefined);
  check('Drive：設定に drive が無ければ null', loadDrive(exp) === null);
  setDrive('gdrive:実験/データ');
  check('Drive：リモート名とフォルダを読む', loadDrive(exp) === 'gdrive:実験/データ');
  setDrive('C:/データ');
  check('Drive：1 文字のリモート名（ドライブ名と紛れる）は止める', err(() => loadDrive(exp)).includes('drive'));
  setDrive('データ');
  check('Drive：リモート名が無ければ止める', err(() => loadDrive(exp)).includes('drive'));

  // 本物の rclone で，環境変数で作ったローカルのリモート（uptest:）へあげる．rclone が無ければ飛ばす
  const env = { ...process.env, RCLONE_CONFIG_UPTEST_TYPE: 'local' };
  const run = (...a) => require('child_process').spawnSync(process.execPath, [UP, exp, '--yes', ...a], { encoding: 'utf8', env });
  setDrive(undefined);
  let r = run('--auto');
  check('Drive：--auto なら drive が無くても止めずに終わる', r.status === 0 && r.stdout.includes('drive'), r.stdout + r.stderr);
  r = run();
  check('Drive：--auto でなければ drive が無いと止める', r.status === 1, r.stdout + r.stderr);
  if (!findRclone()) console.log('skip Drive：rclone が無いので，あげる検査を飛ばします');
  else {
    setDrive(`uptest:${out.replace(/\\/g, '/')}`);
    r = run();
    check('Drive：データ/ が無ければ，あげるものが無いとして止めずに終わる', r.status === 0 && !fs.existsSync(out), r.stdout + r.stderr);
    fs.mkdirSync(path.join(data, 'P01', 'recordings'), { recursive: true });
    fs.writeFileSync(path.join(data, 'P01', 'recordings', '本番.mkv'), Buffer.alloc(3000, 7));
    fs.writeFileSync(path.join(data, '.collect-state.json'), '{"people":[]}');
    fs.writeFileSync(path.join(data, '.collect-state.json.tmp'), 'x');
    fs.writeFileSync(path.join(data, '.collect.lock'), 'x');
    r = run();
    check('Drive：.collect.lock があれば，あげずに止める', r.status === 1 && !fs.existsSync(out) && r.stdout.includes('.collect.lock'), r.stdout + r.stderr);
    fs.unlinkSync(path.join(data, '.collect.lock'));
    r = run('--dry-run');
    check('Drive：--dry-run なら何もあげない', r.status === 0 && !fs.existsSync(path.join(out, 'P01')), r.stdout + r.stderr);
    r = run();
    check('Drive：データ/ をあげて照合する', r.status === 0 && fs.readFileSync(path.join(out, 'P01', 'recordings', '本番.mkv')).equals(Buffer.alloc(3000, 7))
      && fs.existsSync(path.join(out, '.collect-state.json')), r.stdout + r.stderr);
    check('Drive：書きかけ（*.tmp）はあげない', !fs.existsSync(path.join(out, '.collect-state.json.tmp')));
    fs.unlinkSync(path.join(data, '.collect-state.json'));
    fs.writeFileSync(path.join(data, 'P01', '追加.csv'), 'a');
    r = run();
    check('Drive：手元で消したものも Drive からは消さず，足したものだけあげる', r.status === 0 && fs.existsSync(path.join(out, '.collect-state.json')) && fs.existsSync(path.join(out, 'P01', '追加.csv')), r.stdout + r.stderr);
  }
}

console.log('ERRORS:', failed ? `${failed} 件` : 'none');
process.exitCode = failed ? 1 : 0;
