// npm run build-skill-zips：.claude/skills/ の skill を 1 つずつ zip にし，.claude/skills/claude-web-zip/ に置く．
// ウェブ版・デスクトップ版の Claude（claude.ai）に Skill としてアップロードするためのもの．
// zip を開くと <skill 名>/ が 1 つ出る形にする．claude.ai ではリポジトリを読めないので，skill が読むものを同梱する．
//   experiment-script-common を使う skill：<skill 名>/experiment-script-common/
//   リポジトリのファイルを読む skill：<skill 名>/annotator/（README.md，index.html，core/，modes/ など）
const fs = require('fs');
const path = require('path');
const { makeZip } = require('../core/zip');

const ROOT = path.resolve(__dirname, '..');
const SKILLS = path.join(ROOT, '.claude', 'skills');
const OUT = path.join(SKILLS, 'claude-web-zip');
const COMMON = 'experiment-script-common';
// リポジトリから同梱するもの（annotator/ の下に同じ相対パスで入れる）
const REPO = ['README.md', 'index.html', 'evaluator-manual.html', 'evaluator-quick-excel.html', 'experimenter-guide.html', 'core', 'modes', 'tlx', 'tools/exp-check.js', 'collect-tools.zip'];
const USES_REPO = new Set(['annotator-guide', 'experiment-config']);

function walk(abs, rel) {
  if (fs.statSync(abs).isFile()) return [{ abs, rel }];
  return fs.readdirSync(abs).sort().flatMap(n => walk(path.join(abs, n), `${rel}/${n}`));
}
function skillNames() {
  return fs.readdirSync(SKILLS).sort().filter(n => fs.existsSync(path.join(SKILLS, n, 'SKILL.md')));
}
function build() {
  fs.mkdirSync(OUT, { recursive: true });
  return skillNames().map(name => {
    const files = walk(path.join(SKILLS, name), name);
    const md = fs.readFileSync(path.join(SKILLS, name, 'SKILL.md'), 'utf8');
    if (md.includes(COMMON)) files.push(...walk(path.join(SKILLS, COMMON), `${name}/${COMMON}`));
    if (USES_REPO.has(name)) for (const r of REPO) files.push(...walk(path.join(ROOT, r), `${name}/annotator/${r}`));
    const out = path.join(OUT, `${name}.zip`);
    // 日時を固定し，中身が同じなら同じ zip になるようにする（作り直しで差分が出ない）
    fs.writeFileSync(out, Buffer.from(makeZip(files.map(f => ({ name: f.rel, data: fs.readFileSync(f.abs) })), new Date(2026, 0, 1))));
    return { out, n: files.length };
  });
}

if (require.main === module) {
  for (const r of build()) console.log(`${path.relative(ROOT, r.out)}（${r.n} ファイル）`);
}

module.exports = { build, OUT };
