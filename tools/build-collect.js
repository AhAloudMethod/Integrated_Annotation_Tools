// npm run build-collect：tools/collect/ の一式を ツール/ フォルダに入れた collect-tools.zip をリポジトリ直下に作る．
// 実験者は Pages からこの zip をダウンロードし，実験フォルダで展開する．名前は UTF-8 のフラグ付き（core/zip.js）
const fs = require('fs');
const path = require('path');
const { makeZip } = require('../core/zip');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(__dirname, 'collect');
const OUT = path.join(ROOT, 'collect-tools.zip');

function build() {
  const files = fs.readdirSync(SRC).sort().map(n => ({ name: `ツール/${n}`, data: fs.readFileSync(path.join(SRC, n)) }));
  // 日時を固定し，中身が同じなら同じ zip になるようにする（作り直しで差分が出ない）
  fs.writeFileSync(OUT, Buffer.from(makeZip(files, new Date(2026, 0, 1))));
  return { out: OUT, names: files.map(f => f.name) };
}

if (require.main === module) {
  const r = build();
  console.log(`${path.basename(r.out)} を作りました（${r.names.length} ファイル）`);
}

module.exports = { build, OUT, SRC };
