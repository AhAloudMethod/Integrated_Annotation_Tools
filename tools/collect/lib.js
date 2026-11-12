// 回収ツールの共通処理：zip の読み込み，試行の zip の読み取り，設定，CSV，パターンの判定．
// ツール/ に置くだけで動かすため，Node の標準モジュールだけを使い，annotator の core/ には頼らない
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// zip の項目を読む（格納 0 と deflate 8）．名前は UTF-8 として読む．[{ name, data }]
function unzip(buf) {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xFFFF); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('zip ではありません');
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = [];
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('zip の目次が壊れています');
    const method = buf.readUInt16LE(at + 10), csize = buf.readUInt32LE(at + 20);
    const nlen = buf.readUInt16LE(at + 28), xlen = buf.readUInt16LE(at + 30), clen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.slice(at + 46, at + 46 + nlen).toString('utf8');
    at += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.slice(start, start + csize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(`${name} の圧縮方式（${method}）は読めません`);
    out.push({ name, data });
  }
  return out;
}

const num = v => (typeof v === 'number' && isFinite(v) ? v : null);

// 実験モードの試行の zip を読む．実験モードの zip でなければ null
function readTrialZip(file) {
  let entries;
  try { entries = unzip(fs.readFileSync(file)); } catch (_e) { return null; }
  const se = entries.find(e => e.name.endsWith('_session.json'));
  if (!se) return null;
  let s;
  try { s = JSON.parse(se.data.toString('utf8').replace(/^\uFEFF/, '')); } catch (_e) { return null; }
  const m = s && s.meta, ex = m && m.experiment;
  if (!ex || typeof ex.participant !== 'string' || typeof ex.trial !== 'number') return null;
  const r = ex.record;
  return {
    file,
    name: path.basename(file),
    pid: ex.participant,
    exp: ex.name,
    trial: ex.trial,
    practice: !!ex.practice,
    condition: ex.condition || '',
    method: m.mode || '',
    video: m.video_file || '',
    redo: (ex.redo && ex.redo.n) || 0,
    partial: !!ex.partial,
    startIso: ex.start_iso || null,
    endIso: ex.end_iso || null,
    record: r && r.file ? {
      file: r.file,
      size: num(r.size),
      lastModified: num(r.last_modified),
      refVideo: r.ref_video || null,
      refSize: num(r.ref_video_size),
      refLastModified: num(r.ref_video_last_modified),
    } : null,
    csvs: entries.filter(e => /\.csv$/i.test(e.name)).map(e => ({ suffix: e.name.slice(e.name.lastIndexOf('_') + 1), text: e.data.toString('utf8') })),
  };
}

const expand = p => p.replace(/%([^%]+)%/g, (all, k) => (process.env[k] !== undefined ? process.env[k] : all));

// <実験フォルダ>/ツール/設定.json を読む．無ければ既定を使う
function loadConfig(expDir) {
  const file = path.join(expDir, 'ツール', '設定.json');
  const def = { zips: '%USERPROFILE%/Downloads', recordings: '%USERPROFILE%/Videos', recordingExts: ['.mkv', '.mp4'], logs: [] };
  let c = {}, defaulted = true;
  if (fs.existsSync(file)) {
    try { c = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { throw new Error(`ツール/設定.json を読めません（${e.message}）`); }
    defaulted = false;
  }
  const dir = p => path.resolve(expDir, expand(p));
  for (const k of ['zips', 'recordings']) if (c[k] !== undefined && typeof c[k] !== 'string') throw new Error(`ツール/設定.json の ${k} はフォルダのパス（文字列）で書いてください`);
  if (c.logs !== undefined && (!Array.isArray(c.logs) || c.logs.some(l => !l || typeof l.name !== 'string' || !l.name || typeof l.path !== 'string' || !l.path)))
    throw new Error('ツール/設定.json の logs は [{ "name": "名前", "path": "フォルダ", "include": "パターン" }] の形で書いてください');
  if (c.fromFirstRecording !== undefined && typeof c.fromFirstRecording !== 'boolean') throw new Error('ツール/設定.json の fromFirstRecording は true か false で書いてください');
  const ext = x => { const s = String(x).toLowerCase(); return s.startsWith('.') ? s : '.' + s; };   // "mkv" と書いても .mkv として扱う
  return {
    zips: dir(c.zips || def.zips),
    recordings: dir(c.recordings || def.recordings),
    recordingExts: (Array.isArray(c.recordingExts) ? c.recordingExts : def.recordingExts).map(ext),
    logs: (Array.isArray(c.logs) ? c.logs : def.logs).map(l => ({ name: l.name, path: dir(l.path), include: l.include || '*' })),
    fromFirstRecording: c.fromFirstRecording === true,
    defaulted,
  };
}

function csvParse(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function csvWrite(rows) {
  const esc = v => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '\uFEFF' + rows.map(r => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

// * は / 以外の 0 文字以上．rel は / か \ で区切った相対パス
function matchGlob(rel, pattern) {
  const re = new RegExp('^' + pattern.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
  return re.test(rel.replace(/\\/g, '/'));
}

module.exports = { unzip, readTrialZip, loadConfig, csvParse, csvWrite, matchGlob };
