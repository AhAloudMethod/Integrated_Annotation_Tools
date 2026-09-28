// npm run check：リポジトリ内の全 JS に node --check をかける（node_modules を除く）
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js')) files.push(p);
  }
})(ROOT);

let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { bad++; console.log('NG', path.relative(ROOT, f), '\n' + r.stderr); }
}
console.log(`${files.length} ファイル中 ${bad} 件で構文エラー`);
process.exit(bad ? 1 : 0);
