// npm test：全テストを実行する。各テストの出力は tests/out/<名前>.log にも保存する。
// テストは別々のブラウザで動くので、AH_JOBS 本（既定 4）ずつ並べて走らせる。AH_JOBS=1 なら順に走らせる。
// 再生のタイミングを見るテスト（SERIAL）は互いに重ねず 1 本ずつ走らせる（残りの AH_JOBS−1 本の並びと同時に走る）。
// 失敗の判定：終了コードが0以外、または出力に FAIL・ERR・エラー（none 以外）が出たとき
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { OUT, VID } = require('./_env');

if (!fs.existsSync(VID)) {
  console.log('テスト動画がないので ffmpeg で作ります:', VID);
  const r = spawnSync(process.execPath, [path.join(__dirname, 'make-fixture.js')], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(1);
}

const TESTS = ['structure', 'modes', 'features', 'layout', 'restore', 'samimg', 'fixes', 'vwin', 'spec', 'controls', 'voice', 'vosk', 'f0', 'axes', 'pad', 'listen', 'review', 'display', 'frame', 'custom', 'export', 'experiment', 'expcheck'];
const SERIAL = ['modes', 'listen', 'review', 'pad', 'controls', 'frame', 'vosk'];
const only = process.argv.slice(2);
const BAD = [/\bFAIL\b/, /^\s*ERR /m, /ERRORS: (?!none)/, /errors: (?!none)/, /errs: '(?!none)/, /Error:/];
const JOBS = Math.max(1, +process.env.AH_JOBS || 4);

// 1 本走らせ、終わったら出力をまとめて書く（並列でも出力が混ざらない）
function run(name) {
  return new Promise(done => {
    const t0 = Date.now(), p = spawn(process.execPath, [path.join(__dirname, name + '.test.js')], { cwd: __dirname });
    let text = '';
    p.stdout.on('data', d => { text += d; }); p.stderr.on('data', d => { text += d; });
    p.on('close', code => {
      fs.writeFileSync(path.join(OUT, name + '.log'), text);
      const bad = code !== 0 || BAD.some(re => re.test(text));
      process.stdout.write(`\n##### ${name}（${((Date.now() - t0) / 1000).toFixed(0)} 秒）\n${text}>>> ${name}: ${bad ? 'NG' : 'ok'}\n`);
      done(bad);
    });
  });
}
async function pool(names, jobs) {
  let failed = 0; const queue = names.slice();
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => { while (queue.length) if (await run(queue.shift())) failed++; }));
  return failed;
}

(async () => {
  const t0 = Date.now(), names = TESTS.filter(t => !only.length || only.includes(t));
  // 長いテスト（vwin・features・spec）を先に始めると、最後に 1 本だけ残って待つ時間が減る
  const LONG = ['vwin', 'features', 'spec'], par = names.filter(n => !SERIAL.includes(n)).sort((a, b) => (LONG.includes(b) ? 1 : 0) - (LONG.includes(a) ? 1 : 0));
  const failed = JOBS === 1 ? await pool(names, 1)
    : (await Promise.all([pool(par, JOBS - 1), pool(names.filter(n => SERIAL.includes(n)), 1)])).reduce((a, b) => a + b, 0);
  console.log(`\n${failed ? `${failed} 件のテストで問題がありました` : 'すべて ok'}（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`);
  process.exit(failed ? 1 : 0);
})();
