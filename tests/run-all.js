// npm test：全テストを順に実行する。各テストの出力は tests/out/<名前>.log にも保存する。
// 失敗の判定：終了コードが0以外、または出力に FAIL・ERR・エラー（none 以外）が出たとき
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { OUT, VID } = require('./_env');

if (!fs.existsSync(VID)) {
  console.log('テスト動画がないので ffmpeg で作ります:', VID);
  const r = spawnSync(process.execPath, [path.join(__dirname, 'make-fixture.js')], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(1);
}

const TESTS = ['structure', 'modes', 'features', 'layout', 'restore', 'samimg', 'pip-fallback', 'fixes', 'vwin'];
const only = process.argv.slice(2);
const BAD = [/\bFAIL\b/, /^\s*ERR /m, /ERRORS: (?!none)/, /errors: (?!none)/, /errs: '(?!none)/, /Error:/];

let failed = 0;
for (const name of TESTS.filter(t => !only.length || only.includes(t))) {
  process.stdout.write(`\n##### ${name}\n`);
  const r = spawnSync(process.execPath, [path.join(__dirname, name + '.test.js')], { encoding: 'utf8', cwd: __dirname });
  const text = (r.stdout || '') + (r.stderr || '');
  process.stdout.write(text);
  fs.writeFileSync(path.join(OUT, name + '.log'), text);
  const bad = r.status !== 0 || BAD.some(re => re.test(text));
  if (bad) { failed++; console.log(`>>> ${name}: NG`); } else console.log(`>>> ${name}: ok`);
}
console.log(failed ? `\n${failed} 件のテストで問題がありました` : '\nすべて ok');
process.exit(failed ? 1 : 0);
