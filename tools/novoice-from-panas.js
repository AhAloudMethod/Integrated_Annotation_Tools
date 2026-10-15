// 発声者の PANAS の書き出し（_panas.csv）から、「発声なし」の区間の一覧（setup.json の novoice）を作る。
//   node tools/novoice-from-panas.js <発声者の _panas.csv> [動画のファイル名]
// 出力：連続する発声なしの区間をまとめた [[始め, 終わり（秒）], …]。動画のファイル名を付けると、setup.json の videos にそのまま入れられる形で出す。
// 他者に見せる動画の setup.json の videos.<動画名>.novoice に貼る（experiment.json ではなく setup.json。README の「実験モード」）。
// 事前に印が付いた区間は、他者が変えられない（modes/panas.js）。評価区間の開始・区切りは、発声者のときと同じにそろえる。
const fs = require('fs');

// CSV を行と列に分ける（ダブルクォートで囲んだ値に対応する。BOM は除く）
function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x !== '')) rows.push(row); row = []; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); if (row.some(x => x !== '')) rows.push(row); }
  return rows;
}

// _panas.csv の本文 → { ranges: [[始め, 終わり], …], bins: 発声なしの区間の数, total: 区間の数 }
function novoiceRanges(text) {
  const rows = parseCSV(text);
  if (!rows.length) throw new Error('空のファイルです');
  const h = rows[0], col = n => h.indexOf(n);
  const iT0 = col('t_start'), iT1 = col('t_end'), iNV = col('no_voice');
  if (iT0 < 0 || iT1 < 0 || iNV < 0) throw new Error('_panas.csv ではないようです（t_start・t_end・no_voice の列がありません。PANAS の書き出しを使ってください）');
  const ranges = []; let bins = 0;
  for (const r of rows.slice(1)) {
    if (r[iNV] !== '1') continue;
    bins++;
    const a = +r[iT0], b = +r[iT1];
    if (!(b > a)) continue;
    const last = ranges[ranges.length - 1];
    if (last && Math.abs(last[1] - a) < 1e-3) last[1] = b; else ranges.push([a, b]);   // 連続する区間はまとめる
  }
  return { ranges: ranges.map(([a, b]) => [+a.toFixed(3), +b.toFixed(3)]), bins, total: rows.length - 1 };
}

if (require.main === module) {
  const [file, video] = process.argv.slice(2);
  if (!file) { console.error('使い方：node tools/novoice-from-panas.js <発声者の _panas.csv> [動画のファイル名]'); process.exit(2); }
  let res;
  try { res = novoiceRanges(fs.readFileSync(file, 'utf8')); } catch (e) { console.error(`${file}：${e.message}`); process.exit(1); }
  console.error(`発声なし ${res.bins} 区間（全 ${res.total} 区間）→ ${res.ranges.length} 件の範囲にまとめました`);
  console.log(video ? JSON.stringify({ [video]: { novoice: res.ranges } }, null, 2) : JSON.stringify(res.ranges));
}
module.exports = { novoiceRanges, parseCSV };
