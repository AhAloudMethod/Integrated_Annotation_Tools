// 回収ツールの「結果を集める」：ダウンロード先の試行の zip，OBS の録画，ゲームのログを参加者ごとに データ/<ID>/ へ集める．
// planCollect は計画を作るだけで，ファイルは何も変えない．録画と試行の紐づけは推測せず，確かめられなければ止める
const fs = require('fs');
const path = require('path');
const { readTrialZip, loadConfig, matchGlob, csvWrite } = require('./lib');

const pad = n => String(n).padStart(2, '0');
const safe = s => String(s).replace(/[\\/:*?"<>|]/g, '_');
const tagOf = t => `t${pad(t.trial + 1)}${t.practice ? 'p' : ''}`;
const toMs = iso => { const v = iso ? Date.parse(iso) : NaN; return isFinite(v) ? v : null; };
const fmt = t => new Date(t).toLocaleString('ja-JP');
const uniq = a => [...new Set(a)];
const stripBom = s => (s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s);
// ブラウザが重複のダウンロードに付ける「 (1)」を除いた名前
const baseName = n => n.replace(/ \(\d+\)(?=\.zip$)/i, '');

// フォルダ直下のファイル．フォルダが無ければ空
function listFiles(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile()).map(e => path.join(dir, e.name)); } catch (_e) { return []; }
}

// ファイルならその更新日時，フォルダなら中のファイル（下の階層も含む）の最も新しい更新日時．ファイルが無ければ null
function newest(p) {
  let st;
  try { st = fs.statSync(p); } catch (e) { throw new Error(`ログ「${p}」の更新日時を読めません（${e.message}）`); }
  if (!st.isDirectory()) return Math.floor(st.mtimeMs);
  let best = null;
  for (const e of fs.readdirSync(p)) { const t = newest(path.join(p, e)); if (t != null && (best == null || t > best)) best = t; }
  return best;
}

// ログのフォルダから include に合うフォルダかファイルを探す．* は / をまたがないので，include の階層の深さまでだけ下りる
function findLogs(log, errors) {
  const depth = log.include.split('/').length, out = [];
  const walk = (dir, rel, d) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return; }
    for (const e of ents) {
      const r = rel ? `${rel}/${e.name}` : e.name, full = path.join(dir, e.name);
      if (d === depth) {
        if (!matchGlob(r, log.include)) continue;
        try { out.push({ src: full, rel: r, time: newest(full), name: log.name }); } catch (err) { errors.push(err.message); }
      }
      else if (e.isDirectory()) walk(full, r, d + 1);
    }
  };
  walk(log.path, '', 1);
  return out.filter(i => i.time != null);
}

// zip が選んだ録画：プレイの録画と基準音声の録画
function refsOf(t) {
  const r = t.record;
  if (!r) return [];
  const out = [{ file: r.file, size: r.size, lastModified: r.lastModified, role: t.practice ? '評価の練習' : '本番' }];
  if (r.refVideo) out.push({ file: r.refVideo, size: r.refSize, lastModified: r.refLastModified, role: '基準音声' });
  return out;
}

function planCollect(expDir, cfg) {
  const warnings = [], errors = [];
  const exFile = path.join(expDir, 'experiment.json');
  let ex;
  try { ex = JSON.parse(stripBom(fs.readFileSync(exFile, 'utf8'))); } catch (e) { throw new Error(`experiment.json を読めません（${e.message}）`); }
  const dataDir = path.join(expDir, 'データ');
  const stateFile = path.join(dataDir, '.collect-state.json');
  let state = { people: [] };
  if (fs.existsSync(stateFile)) {
    // 集めた記録が読めなければ，誰を集め済みとするか決められないので止める
    let bad = '';
    try { state = JSON.parse(stripBom(fs.readFileSync(stateFile, 'utf8'))); } catch (e) { bad = e.message; }
    if (!bad && !(state && Array.isArray(state.people) && state.people.every(p => p && typeof p.pid === 'string' && typeof p.to === 'number' && isFinite(p.to)))) bad = '参加者 ID と時間帯の終わり（to）の形が違います';
    if (bad) return { people: [], left: { outside: 0, before: 0 }, warnings: [], errors: [`${stateFile} を読めません（${bad}）．中身を直すまで集められません`] };
  }
  const donePeople = state.people;
  const done = new Set(donePeople.map(p => p.pid));

  // この実験の試行の zip．ID はファイル名でなく中身から取る．重複のダウンロードより元の名前を先にする．
  // 試行の zip に見える名前なのに読めないものは，ダウンロードの途中か壊れているので止める．
  // end_iso の無い zip（途中で抜けた _partial は end_iso を持たない）は，zip の更新日時を終わりとみなす
  const zips = [];
  for (const f of listFiles(cfg.zips).filter(f => /_t\d+p?_.*\.zip$/i.test(path.basename(f)))) {
    const t = readTrialZip(f);
    if (!t) {
      errors.push(`${path.basename(f)} を読めません．ダウンロードが終わっていないか壊れています．ダウンロードし直すか，この実験の zip でなければ別の場所へ移してください`);
      continue;
    }
    if (t.exp !== ex.name || !t.name.startsWith(`${t.pid}_t`)) continue;
    t.endMs = toMs(t.endIso);
    if (t.endMs == null) t.endMs = Math.floor(fs.statSync(f).mtimeMs);
    zips.push(t);
  }
  zips
    .sort((a, b) => baseName(a.name).localeCompare(baseName(b.name)) || a.name.length - b.name.length || a.name.localeCompare(b.name));

  // 録画のフォルダ直下の録画
  const recs = listFiles(cfg.recordings).filter(f => cfg.recordingExts.includes(path.extname(f).toLowerCase()))
    .map(f => { const st = fs.statSync(f); return { file: f, name: path.basename(f), size: st.size, time: Math.floor(st.mtimeMs) }; });
  // 名前・大きさ・更新日時がすべて合う録画．zip に残っていない値は照合に使わない
  const find = ref => recs.filter(c => c.name === ref.file && (ref.size == null || c.size === ref.size) && (ref.lastModified == null || c.time === ref.lastModified));
  // どれかの zip（集め済みの人の zip も含む）が参照する録画は，時間帯で その他/ に振り分けない
  const referenced = new Set();
  for (const t of zips) for (const ref of refsOf(t)) for (const c of find(ref)) referenced.add(c.file);
  const logItems = cfg.logs.flatMap(l => findLogs(l, errors));

  // 参加者ごとに zip をまとめ，最も早い start の順に並べる
  const byPid = new Map();
  for (const t of zips) { if (!byPid.has(t.pid)) byPid.set(t.pid, []); byPid.get(t.pid).push(t); }
  const targets = [];
  for (const [pid, ts] of byPid) {
    if (done.has(pid)) {
      const recNames = uniq(ts.flatMap(t => refsOf(t).map(r => r.file)));
      warnings.push(`${pid} は集め済みですが，新しい zip が ${ts.length} 個見つかりました（${ts.map(t => t.name).join('，')}）．`
        + `zip も${recNames.length ? `，zip が参照する録画（${recNames.join('，')}）も` : ''}移していません．手で データ/${pid}/ へ移し，files.csv に書き足してください`);
      continue;
    }
    const starts = ts.map(t => toMs(t.startIso)).filter(v => v != null);
    if (!starts.length) { errors.push(`${pid} の zip に開始の時刻がないため，時間帯を決められません`); continue; }
    targets.push({ pid, zips: ts, start: Math.min(...starts), to: Math.max(...ts.map(t => t.endMs)) });
  }
  targets.sort((a, b) => a.start - b.start);
  if (!targets.length) warnings.push('集める対象の参加者がいません');

  // 時間帯：始まりは 1 つ前の参加者の終わり．記録が何も無ければ最初の start の日の 0 時
  let prev = donePeople.length ? Math.max(...donePeople.map(p => p.to)) : null, prevDone = prev != null;
  for (const p of targets) {
    if (prev != null && p.start < prev) {
      if (prevDone) errors.push(`${p.pid} の zip の時刻（${fmt(p.start)}〜）が集め済みの参加者の時間帯（〜${fmt(prev)}）と重なります．集め忘れた参加者が集め済みの参加者より前にいるため，時間帯で振り分けられません．`
        + `${p.pid} の zip と録画とログは手で データ/${p.pid}/ へ移し，files.csv に書き足してから，データ/.collect-state.json に ${p.pid} を足してください`);
      else errors.push(`${p.pid} の zip の時刻（${fmt(p.start)}〜）が 1 つ前の参加者の時間帯（〜${fmt(prev)}）と重なるため，振り分けられません`);
    }
    prevDone = false;
    if (prev != null) p.from = prev;
    else { const d = new Date(p.start); d.setHours(0, 0, 0, 0); p.from = d.getTime(); }
    prev = p.to;
  }

  const owner = new Map(); // 移す録画 → 参加者 ID
  const people = targets.map(p => {
    const dst = (...a) => path.join(dataDir, p.pid, ...a);
    const moves = [];
    for (const t of p.zips) moves.push({ src: t.file, dst: dst('annotator', t.name), kind: 'zip', role: 'annotator', zip: '' });

    // 試行ごとに採る zip：完了したもののうち最後のやり直し．完了したものが無ければ _partial のうち最後のやり直し
    const byTrial = new Map();
    for (const t of p.zips) { if (!byTrial.has(t.trial)) byTrial.set(t.trial, []); byTrial.get(t.trial).push(t); }
    const adopted = [];
    for (const list of byTrial.values()) {
      const complete = list.filter(t => !t.partial), pool = complete.length ? complete : list;
      adopted.push(pool.reduce((a, b) => (b.redo > a.redo || (b.redo === a.redo && b.endMs > a.endMs) ? b : a)));
    }
    adopted.sort((a, b) => a.trial - b.trial);
    const completed = [...byTrial.values()].filter(list => list.some(t => !t.partial)).length;
    const planned = ex.participants && ex.participants[p.pid];
    if (!Array.isArray(planned)) warnings.push(`${p.pid} は experiment.json の participants にありません`);
    else if (completed !== planned.length) warnings.push(`${p.pid}：完了した試行の数（${completed}）が experiment.json の試行の数（${planned.length}）と合いません`);
    const partials = p.zips.filter(t => t.partial);
    if (partials.length) warnings.push(`${p.pid}：途中で抜けた zip（_partial）があります（${partials.map(t => t.name).join('，')}）`);

    // zip が選んだ録画を 1 つに決める．無い・2 つ以上なら止める
    const resolve = (t, ref) => {
      const label = `${p.pid} の ${tagOf(t)} の${ref.role}の録画「${ref.file}」`;
      const m = find(ref);
      if (!m.length) { errors.push(`${label}が録画のフォルダに見つかりません（名前・大きさ・更新日時が合うファイルがありません）`); return null; }
      if (m.length > 1) { errors.push(`${label}に合うファイルが ${m.length} 個あり，決められません`); return null; }
      if (ref.lastModified == null) warnings.push(`${label}は zip に更新日時が残っていないため，名前${ref.size == null ? '' : 'と大きさ'}で照合しました`);
      return m[0];
    };
    const named = new Map(); // 録画 → move
    for (const t of adopted) {
      for (const ref of refsOf(t)) {
        const r = resolve(t, ref);
        if (!r || named.has(r.file)) continue;
        const name = safe(`${p.pid}_${tagOf(t)}_${t.condition || t.method || 'trial'}_${ref.role}${t.partial ? '_partial' : ''}`) + path.extname(r.name);
        named.set(r.file, { src: r.file, dst: dst('recordings', name), kind: 'recording', role: ref.role, zip: t.name });
      }
    }
    // やり直し前などの採らない zip だけが参照する録画は，元の名前で その他/ へ．参照した zip を残す
    const others = new Map(); // 録画 → { r, zips }
    for (const t of p.zips) {
      if (adopted.includes(t)) continue;
      for (const ref of refsOf(t)) {
        const r = resolve(t, ref);
        if (!r || named.has(r.file)) continue;
        if (!others.has(r.file)) others.set(r.file, { r, zips: [] });
        const o = others.get(r.file);
        if (!o.zips.includes(t.name)) o.zips.push(t.name);
      }
    }
    moves.push(...named.values());
    for (const { r, zips: zs } of others.values()) moves.push({ src: r.file, dst: dst('recordings', 'その他', r.name), kind: 'recording', role: 'その他', zip: zs.join(';') });

    // どの zip も参照しない録画とゲームのログは，更新日時で時間帯に振り分ける
    const inWindow = t => p.from < t && t <= p.to;
    for (const r of recs) if (!referenced.has(r.file) && inWindow(r.time)) moves.push({ src: r.file, dst: dst('recordings', 'その他', r.name), kind: 'recording', role: 'その他', zip: '' });
    const logs = logItems.filter(i => inWindow(i.time));
    for (const i of logs) moves.push({ src: i.src, dst: dst('logs', i.name, ...i.rel.split('/')), kind: 'log', role: i.name, zip: '' });
    if (cfg.logs.length && !logs.length) warnings.push(`${p.pid}：時間帯（${fmt(p.from)}〜${fmt(p.to)}）にできたゲームのログが 1 つもありません`);

    for (const m of moves) {
      if (m.kind !== 'recording') continue;
      if (owner.has(m.src) && owner.get(m.src) !== p.pid) errors.push(`録画「${path.basename(m.src)}」を ${owner.get(m.src)} と ${p.pid} の両方の zip が参照しています`);
      else owner.set(m.src, p.pid);
    }
    return { pid: p.pid, from: p.from, to: p.to, moves };
  });

  // 時間帯の外のもの（最後の人の後・最初の人の前）は移さず，数だけ出す
  const left = { outside: 0, before: 0 };
  if (people.length) {
    const first = people[0].from, last = people[people.length - 1].to;
    const times = recs.filter(r => !referenced.has(r.file)).map(r => r.time).concat(logItems.map(i => i.time));
    left.outside = times.filter(t => t > last).length;
    left.before = times.filter(t => t <= first).length;
  }

  // 移し先に同じ名前があれば止める（Windows は大文字小文字を区別しない）
  const seen = new Set();
  for (const m of people.flatMap(p => p.moves)) {
    const key = path.resolve(m.dst).toLowerCase();
    if (seen.has(key)) errors.push(`移し先の名前が重なります：${m.dst}`);
    seen.add(key);
    if (fs.existsSync(m.dst)) errors.push(`移し先にすでに同じ名前があります：${m.dst}`);
  }
  return { people, left, warnings: uniq(warnings), errors: uniq(errors) };
}

const KIND = { zip: 'zip', recording: '録画', log: 'ログ' };

const exists = why => `移し先にすでに同じ名前があります（${why}）．上書きしないので止めました`;

// src（ファイルかフォルダ）の中のファイルが dst に同じ大きさでそろっているか．そろっていなければ理由を返す．
// seen を渡すと，確かめた元のファイルとフォルダを上の階層から順に入れる
function mismatch(src, dst, seen = []) {
  const st = fs.statSync(src);
  seen.push({ path: src, dir: st.isDirectory() });
  if (st.isDirectory()) {
    for (const e of fs.readdirSync(src)) { const why = mismatch(path.join(src, e), path.join(dst, e), seen); if (why) return why; }
    return null;
  }
  let got;
  try { got = fs.statSync(dst); } catch (_e) { return `「${src}」のコピーが「${dst}」にありません`; }
  if (got.size !== st.size) return `「${src}」のコピーの大きさ（${got.size} バイト）が元（${st.size} バイト）と合いません`;
  return null;
}

// src を dst へコピーする．フォルダは下の階層までコピーする．既にある名前には書かない．
// 作ったと確かめたファイルとフォルダだけを made に入れる．ファイルごとに大きさを確かめ，更新日時を元にそろえる
function copyTree(src, dst, copy, made) {
  const st = fs.statSync(src);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (st.isDirectory()) {
    try { fs.mkdirSync(dst); } catch (e) { throw e.code === 'EEXIST' ? new Error(exists(dst)) : e; }
    made.push({ path: dst, dir: true });
    for (const e of fs.readdirSync(src)) copyTree(path.join(src, e), path.join(dst, e), copy, made);
    return;
  }
  try { copy(src, dst); } catch (e) { throw e.code === 'EEXIST' ? new Error(exists(dst)) : e; }
  made.push({ path: dst, dir: false });
  const why = mismatch(src, dst);
  if (why) throw new Error(why);
  fs.utimesSync(dst, st.atime, st.mtime);
}

// .collect-state.json に 1 人分を足す．別名で書いてから置き換え，書きかけのまま残らないようにする
function appendState(dataDir, entry) {
  const file = path.join(dataDir, '.collect-state.json');
  fs.mkdirSync(dataDir, { recursive: true });
  const state = fs.existsSync(file) ? JSON.parse(stripBom(fs.readFileSync(file, 'utf8'))) : { people: [] };
  state.people.push(entry);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

// 1 人分を移す．すべてコピーして大きさを確かめてから元を消す．
// コピーの途中で失敗したら，この実行で作ったコピーだけを消して元はすべて残し，投げる．
// 元は確かめたファイルだけを 1 つずつ消し，空になったフォルダだけを消す．消せずに残ったものを返す
function movePerson(p, copy, unlink) {
  for (const m of p.moves) if (fs.existsSync(m.dst)) throw new Error(`${p.pid} を移せません：${exists(m.dst)}．元のファイルは消していません`);
  const made = [], seen = [];
  try {
    for (const m of p.moves) copyTree(m.src, m.dst, copy, made);
    // 全部コピーした後に元が変わっていないかも確かめる（録画の書き込みが続いていた場合など）
    for (const m of p.moves) { const why = mismatch(m.src, m.dst, seen); if (why) throw new Error(why); }
  } catch (e) {
    const stuck = [];
    for (const d of made.reverse()) { try { if (d.dir) fs.rmdirSync(d.path); else fs.unlinkSync(d.path); } catch (_e) { stuck.push(d.path); } }
    throw new Error(`${p.pid} を移せません：${e.message}．元のファイルは消していません`
      + (stuck.length ? `．作りかけのコピー（${stuck.join('，')}）を消せなかったので，確かめて手で消してから実行し直してください` : ''));
  }
  const kept = [];
  for (const s of seen) if (!s.dir) { try { unlink(s.path); } catch (_e) { kept.push(s.path); } }
  // 確かめた後にできたファイルが中にあれば，そのフォルダは消さずに残す
  for (const s of seen.slice().reverse()) if (s.dir) { try { fs.rmdirSync(s.path); } catch (_e) { kept.push(s.path); } }
  return kept;
}

// 計画に沿って参加者ごとに移し，files.csv と .collect-state.json を書く．途中で失敗したらそこで止める．
// copy と unlink はテストで失敗を差し込むためのもの
function runCollect(expDir, plan, { copy = (s, d) => fs.copyFileSync(s, d, fs.constants.COPYFILE_EXCL), unlink = fs.unlinkSync } = {}) {
  const done = [];
  if (plan.errors.length) return { done, failed: `止める理由があるので何も移していません（${plan.errors.join('／')}）` };
  const dataDir = path.join(expDir, 'データ');
  const lock = path.join(dataDir, '.collect.lock');
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(lock, `${new Date().toISOString()} pid ${process.pid}\n`, { flag: 'wx' });
  } catch (e) {
    if (e.code !== 'EEXIST') return { done, failed: `${lock} を作れません（${e.message}）．何も移していません` };
    return { done, failed: `${lock} があるので何も移していません．もう 1 つの窓で集めている途中か，前回が途中で止まりました．`
      + 'もう 1 つの窓が無いことと，前回止まった参加者のファイルを確かめてから .collect.lock を消し，実行し直してください' };
  }
  try {
    for (const p of plan.people) {
      let kept;
      try { kept = movePerson(p, copy, unlink); } catch (e) { return { done, failed: e.message }; }
      // ここから先は元を消した後なので，書けなくても移したファイルは データ/<pid>/ にある
      const entry = { pid: p.pid, to: p.to, at: new Date().toISOString() }, miss = [];
      try {
        const rows = [['元の場所', '移した先', '種類', '役割', '参照した zip'], ...p.moves.map(m => [m.src, m.dst, m.kind, m.role, m.zip])];
        fs.writeFileSync(path.join(dataDir, p.pid, 'files.csv'), csvWrite(rows));
      } catch (e) { miss.push(`files.csv を書けませんでした（${e.message}）`); }
      try { appendState(dataDir, entry); } catch (e) {
        miss.push(`.collect-state.json に記録できませんでした（${e.message}）．次の実行で集め直さないよう，.collect-state.json の people に ${JSON.stringify(entry)} を手で足してください`);
      }
      if (miss.length) return { done, failed: `${p.pid} のファイルは データ/${p.pid}/ へ移し終えて元は消しましたが，${miss.join('．')}` };
      done.push(p.pid);
      // コピーは確かめ済みなので集めたと記録するが，残った元は確かめてから手で消してもらう
      if (kept.length) return { done, failed: `${p.pid} は移し先にそろいましたが，元の一部を消さずに残しました（${kept.join('，')}）．`
        + '使っているソフトを閉じるか，確かめた後に書き足されたものでないかを見てから，手で消してください' };
    }
    return { done, failed: null };
  } finally {
    try { fs.unlinkSync(lock); } catch (_e) { /* 消せなくても結果は変わらない */ }
  }
}

function printPlan(plan) {
  for (const p of plan.people) {
    const n = k => p.moves.filter(m => m.kind === k).length;
    console.log(`\n■ ${p.pid}（時間帯 ${fmt(p.from)} 〜 ${fmt(p.to)}）  zip ${n('zip')} 個，録画 ${n('recording')} 個，ログ ${n('log')} 個`);
    for (const m of p.moves) console.log(`  [${KIND[m.kind]}] ${m.src}\n      → ${m.dst}`);
  }
  if (plan.people.length) console.log(`\n時間帯の外なので残すもの：最後の参加者の後 ${plan.left.outside} 個，最初の参加者の前 ${plan.left.before} 個`);
  const ws = plan.warnings.filter(w => w !== '集める対象の参加者がいません');
  if (ws.length) console.log('');
  for (const w of ws) console.log(`警告：${w}`);
  if (plan.errors.length) console.log('');
  for (const e of plan.errors) console.log(`止める：${e}`);
}

// 標準入力から 1 行ずつ読む．入力が終わっていれば空を返す
function lineReader() {
  const rl = require('readline').createInterface({ input: process.stdin });
  const lines = [];
  let waiting = null, closed = false;
  rl.on('line', l => { if (waiting) { const w = waiting; waiting = null; w(l); } else lines.push(l); });
  rl.on('close', () => { closed = true; if (waiting) { const w = waiting; waiting = null; w(''); } });
  return {
    ask(q) {
      process.stdout.write(q);
      if (lines.length) return Promise.resolve(lines.shift());
      if (closed) return Promise.resolve('');
      return new Promise(r => { waiting = r; });
    },
    close: () => rl.close(),
  };
}

// node collect.js <実験フォルダ> [--yes]．--yes なら確認も最後の Enter も待たない
async function main(argv) {
  const yes = argv.includes('--yes');
  const expDir = path.resolve(argv.filter(a => a !== '--yes')[0] || path.join(__dirname, '..'));
  const input = yes ? null : lineReader();
  try {
    console.log(`実験フォルダ：${expDir}`);
    const cfg = loadConfig(expDir);
    if (cfg.defaulted) console.log('ツール/設定.json が無いので，既定の置き場（ダウンロード・ビデオ）を使います');
    const plan = planCollect(expDir, cfg);
    printPlan(plan);
    if (plan.errors.length) {
      console.log('\n止める理由があるので，何も移していません．上の「止める：」を直してから実行し直してください');
      process.exitCode = 1;
    }
    else if (!plan.people.length) console.log('\n集める対象の参加者がいません．何も移していません');
    else {
      const ok = yes || /^[yｙ]$/i.test((await input.ask('\nこの計画で移しますか？ 移すなら y を押して Enter：')).trim());
      if (!ok) console.log('取りやめました．何も移していません');
      else {
        const r = runCollect(expDir, plan);
        if (r.done.length) console.log(`\n集めました：${r.done.join('，')}`);
        if (r.failed) { console.log(`\n止めました：${r.failed}`); process.exitCode = 1; }
      }
    }
  } catch (e) {
    console.log(`\n思わぬ失敗で止まりました：${e && e.message ? e.message : e}`);
    process.exitCode = 1;
  }
  if (input) { await input.ask('\nEnter で閉じる'); input.close(); }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { planCollect, runCollect };
