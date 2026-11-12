// 全員分の表にまとめる：データ/<参加者>/annotator/ の zip の CSV を，種類（ファイル名の接尾辞）ごとに 1 つの表へ縦につなぐ．
// node aggregate.js <実験フォルダ> [--yes]．毎回 データ/全員分/ を作り直す
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { readTrialZip, csvParse, csvWrite } = require('./lib');

const KEYS = ['participant', 'trial', 'practice', 'condition', 'method', 'video', 'redo'];
const SUMMARY = 'trials.csv';   // 要約は zip ごとに「その時点までの全試行」が入る

const endOf = t => Date.parse(t.endIso) || 0;
// 新しい回を採る．同じ回（ブラウザが付けた「 (1)」の重複など）なら名前の短い元のファイルを採る
const later = (a, b) => {
  if (b.redo !== a.redo) return b.redo > a.redo ? b : a;
  if (endOf(b) !== endOf(a)) return endOf(b) > endOf(a) ? b : a;
  return b.name.length < a.name.length ? b : a;
};

// 参加者ごとの zip から，試行ごとに採用する 1 つを選ぶ．除いたもの（途中終了・やり直し前・重複）は skipped へ
function adopt(trials, skipped) {
  const byTrial = new Map();
  for (const t of trials) {
    if (t.partial) { skipped.push(`${t.name}（途中で抜けた試行）`); continue; }
    const k = `${t.pid}\u0000${t.trial}`;
    byTrial.set(k, [...(byTrial.get(k) || []), t]);
  }
  const out = [];
  for (const group of byTrial.values()) {
    const pick = group.reduce(later);
    out.push(pick);
    for (const t of group) if (t !== pick) skipped.push(`${t.name}（${t.redo === pick.redo && t.endIso === pick.endIso ? '同じ zip の重複' : 'やり直す前'}）`);
  }
  return out.sort((a, b) => a.pid.localeCompare(b.pid) || a.trial - b.trial);
}

// NASA-TLX の結果（データ/<参加者>/tlx/*.csv．1 ファイル 1 行）を読む．同じ試行が 2 つ以上あれば end_iso の最も遅いものを採り，
// 同じ時刻なら名前の短い元のファイルを採る（「結果をもう一度保存する」で増えた「 (1)」など）
const TLX = 'tlx.csv';
function readTlx(dataDir, people, skipped) {
  const out = [];
  for (const p of people) {
    const dir = path.join(dataDir, p, 'tlx');
    if (!fs.existsSync(dir)) continue;
    const byTrial = new Map();
    for (const f of fs.readdirSync(dir).filter(n => /\.csv$/i.test(n)).sort()) {
      let rows;
      try { rows = csvParse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_e) { skipped.push(`${p}/tlx/${f}（読めません）`); continue; }
      const head = rows[0] || [], row = rows[1];
      if (!row || !head.includes('trial')) { skipped.push(`${p}/tlx/${f}（NASA-TLX の結果の形ではありません）`); continue; }
      const get = c => row[head.indexOf(c)] || '';
      const cand = { name: f, end: Date.parse(get('end_iso')) || 0, table: { prefix: { participant: p }, rows } };
      const k = get('trial'), cur = byTrial.get(k);
      if (!cur) { byTrial.set(k, cand); continue; }
      const keep = cand.end !== cur.end ? (cand.end > cur.end ? cand : cur) : (cand.name.length < cur.name.length ? cand : cur);
      skipped.push(`${p}/tlx/${(keep === cand ? cur : cand).name}（同じ試行の NASA-TLX の重複か，答え直す前のもの）`);
      byTrial.set(k, keep);
    }
    out.push(...[...byTrial.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([, v]) => v.table));
  }
  return out;
}

// 表を和集合の列でつなぐ．tables：[{ prefix: { 列: 値 }, rows: string[][]（先頭が見出し） }]
function stack(tables, keys) {
  const cols = [];
  for (const { rows } of tables) for (const c of rows[0] || []) if (!cols.includes(c) && !keys.includes(c)) cols.push(c);
  const out = [[...keys, ...cols]];
  for (const { prefix, rows } of tables) {
    const head = rows[0] || [];
    for (const r of rows.slice(1)) {
      if (r.length === 1 && r[0] === '') continue;
      const rec = {}; head.forEach((c, i) => { rec[c] = r[i]; });
      out.push([...keys.map(k => prefix[k]), ...cols.map(c => rec[c] ?? '')]);
    }
  }
  return out;
}

function aggregate(expDir) {
  const dataDir = path.join(expDir, 'データ'), outDir = path.join(dataDir, '全員分');
  const skipped = [], all = [];
  const people = fs.existsSync(dataDir) ? fs.readdirSync(dataDir, { withFileTypes: true }).filter(d => d.isDirectory() && d.name !== '全員分').map(d => d.name) : [];
  for (const p of people) {
    const zdir = path.join(dataDir, p, 'annotator');
    if (!fs.existsSync(zdir)) continue;
    for (const f of fs.readdirSync(zdir).filter(n => /\.zip$/i.test(n)).sort()) {
      const t = readTrialZip(path.join(zdir, f));
      if (t) all.push(t); else skipped.push(`${f}（実験モードの zip として読めません）`);
    }
  }
  const adopted = adopt(all, skipped);
  const bySuffix = new Map();
  const add = (suf, table) => bySuffix.set(suf, [...(bySuffix.get(suf) || []), table]);
  for (const t of adopted) {
    const prefix = { participant: t.pid, trial: String(t.trial + 1), practice: t.practice ? '1' : '0', condition: t.condition, method: t.method, video: t.video, redo: String(t.redo) };
    for (const c of t.csvs) if (c.suffix !== SUMMARY) add(c.suffix, { prefix, rows: csvParse(c.text) });
  }
  // 要約は参加者ごとに最も遅く終えた zip のものだけ（試行の列はすでに入っているので，参加者だけを足す）
  const lastByPid = new Map();
  for (const t of adopted) if (t.csvs.some(c => c.suffix === SUMMARY)) lastByPid.set(t.pid, lastByPid.has(t.pid) && endOf(lastByPid.get(t.pid)) > endOf(t) ? lastByPid.get(t.pid) : t);
  const summaries = [...lastByPid.values()].map(t => ({ prefix: { participant: t.pid }, rows: csvParse(t.csvs.find(c => c.suffix === SUMMARY).text) }));
  const tlx = readTlx(dataDir, people, skipped);

  try { fs.rmSync(outDir, { recursive: true, force: true }); } catch (e) {
    throw new Error(`データ/全員分/ を作り直せません（${e.code || e.message}）．Excel などで開いている表を閉じてから，もう一度押してください`);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const [suf, tables] of [...bySuffix].sort((a, b) => a[0].localeCompare(b[0]))) {
    const file = path.join(outDir, suf); fs.writeFileSync(file, csvWrite(stack(tables, KEYS))); written.push(file);
  }
  if (summaries.length) { const file = path.join(outDir, SUMMARY); fs.writeFileSync(file, csvWrite(stack(summaries, ['participant']))); written.push(file); }
  if (tlx.length) { const file = path.join(outDir, TLX); fs.writeFileSync(file, csvWrite(stack(tlx, ['participant']))); written.push(file); }
  return { written: written.sort(), skipped, adopted: adopted.length };
}

async function main() {
  const args = process.argv.slice(2), yes = args.includes('--yes'), expDir = args.find(a => a !== '--yes');
  try {
    if (!expDir) throw new Error('実験フォルダを指定してください（node aggregate.js <実験フォルダ>）');
    const r = aggregate(path.resolve(expDir));
    console.log(`${r.adopted} 試行の結果を，種類ごとに 1 つの表にまとめました（データ/全員分/）．`);
    for (const f of r.written) console.log(`  ${path.basename(f)}`);
    if (r.skipped.length) { console.log('まとめに使わなかったファイル：'); for (const s of r.skipped) console.log(`  ${s}`); }
    if (!r.adopted) console.log('まとめる結果がありません．先に 1_結果を集める.bat で結果を集めてください．');
  } catch (e) {
    console.log(`まとめられませんでした：${e.message}`);
    process.exitCode = 1;
  }
  if (!yes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise(r => rl.question('Enter で閉じます．', () => { rl.close(); r(); }));
  }
}

if (require.main === module) main();

module.exports = { aggregate };
