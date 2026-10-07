// Vosk の日本語モデルを用意する：公式の zip をダウンロードし、ツールが読める .tar.gz に作り直す
//   npm run vosk-model            … models/vosk-model-small-ja-0.22.tar.gz を作る
//   npm run vosk-model -- <zip>   … ダウンロード済みの zip から作る
// できた .tar.gz を、ツールの「設定」→ 音声認識モデル「Vosk」→「モデルを選ぶ」で選ぶ（初回だけ。以降はブラウザに保存される）
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const NAME = 'vosk-model-small-ja-0.22';
const URL = `https://alphacephei.com/vosk/models/${NAME}.zip`;
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'models');
const OUT = path.join(OUT_DIR, NAME + '.tar.gz');
// Windows 10 以降の tar.exe（bsdtar）は zip も展開できる。ほかの OS は tar と unzip を使う
const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} ${args.join(' ')} が失敗しました`);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const work = fs.mkdtempSync(path.join(OUT_DIR, 'tmp-'));
  try {
    let zip = process.argv[2] ? path.resolve(process.argv[2]) : path.join(work, NAME + '.zip');
    if (!process.argv[2]) {
      console.log('ダウンロード中:', URL, '（約50MB）');
      const res = await fetch(URL);
      if (!res.ok) throw new Error('ダウンロードに失敗しました: HTTP ' + res.status);
      fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    }
    console.log('展開中:', zip);
    if (process.platform === 'win32') run(TAR, ['-xf', zip], work); else run('unzip', ['-q', zip], work);
    const dir = fs.readdirSync(work).find(d => fs.statSync(path.join(work, d)).isDirectory());
    if (!dir) throw new Error('zip の中にモデルのフォルダが見つかりません');
    console.log('作成中:', OUT);
    run(TAR, ['-czf', OUT, dir], work);
    console.log('できました:', OUT, `（${(fs.statSync(OUT).size / 1e6).toFixed(0)}MB）`);
    console.log('ツールの「設定」→ 音声認識モデル「Vosk」→「モデルを選ぶ」でこのファイルを選んでください。');
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
})().catch(e => { console.error(e.message); process.exit(1); });
