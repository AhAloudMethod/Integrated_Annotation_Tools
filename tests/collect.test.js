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
  const pid = o.pid || 'P01', exp = o.exp || 'exp3', method = o.method || 'custom';
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

console.log('ERRORS:', failed ? `${failed} 件` : 'none');
process.exitCode = failed ? 1 : 0;
