// 回収ツールの「Drive にあげる」：データ/ を rclone で Google Drive などへコピーし，中身（MD5）が合うか確かめる．
// rclone copy なので Drive 側のファイルは消さない（手元で消したものも Drive には残る）．
// あげ先は ツール/設定.json の "drive"（rclone のリモート名とフォルダ．例 "gdrive:実験名/データ"）
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const stripBom = s => (s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s);
// 集めている途中の印や書きかけのファイルはあげない
const EXCLUDES = ['.collect.lock', '*.tmp'];

// あげ先．設定.json に "drive" が無ければ null
function loadDrive(expDir) {
  const file = path.join(expDir, 'ツール', '設定.json');
  let c;
  try { c = JSON.parse(stripBom(fs.readFileSync(file, 'utf8'))); } catch (e) { throw new Error(`ツール/設定.json を読めません（${e.message}）`); }
  if (c.drive === undefined) return null;
  // 1 文字のリモート名は rclone が Windows のドライブ（C: など）として扱うので認めない
  if (typeof c.drive !== 'string' || !/^[^:\\/]{2,}:/.test(c.drive)) {
    throw new Error('ツール/設定.json の "drive" に，あげ先を "リモート名:フォルダ" の形で書いてください（例 "gdrive:実験名/データ"．リモート名は 2 文字以上）');
  }
  return c.drive;
}

// PATH の rclone か，winget で入れた rclone を探す
function findRclone() {
  const r = spawnSync('rclone', ['version'], { encoding: 'utf8' });
  if (!r.error && r.status === 0) return 'rclone';
  const base = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  try {
    for (const pkg of fs.readdirSync(base).filter(n => /^Rclone\.Rclone/i.test(n))) {
      for (const sub of fs.readdirSync(path.join(base, pkg))) {
        const exe = path.join(base, pkg, sub, 'rclone.exe');
        if (fs.existsSync(exe)) return exe;
      }
    }
  } catch (_e) { /* 見つからなければ呼んだ側で止める */ }
  return null;
}

function rclone(exe, args) {
  console.log(`\n> rclone ${args.join(' ')}`);
  const r = spawnSync(exe, args, { stdio: 'inherit' });
  if (r.error) throw new Error(`rclone を起動できません（${r.error.message}）`);
  return r.status;
}

// node upload.js <実験フォルダ> [--yes] [--dry-run] [--auto]．
// --yes：最後の Enter を待たない．--dry-run：あげるものを見るだけ．--auto：設定に "drive" が無ければ何もせずに終わる（1_結果を集める.bat から呼ぶ）
async function main(argv) {
  const yes = argv.includes('--yes'), dry = argv.includes('--dry-run'), auto = argv.includes('--auto');
  const expDir = path.resolve(argv.filter(a => !a.startsWith('--'))[0] || path.join(__dirname, '..'));
  try {
    const remote = loadDrive(expDir);
    if (remote === null && auto) { console.log('\nツール/設定.json に "drive" が無いので，Drive にはあげません'); return; }
    console.log(`\n===== Drive にあげる =====\n実験フォルダ：${expDir}`);
    if (remote === null) throw new Error('ツール/設定.json に "drive" がありません．あげ先を "リモート名:フォルダ" の形で書いてください（例 "gdrive:実験名/データ"）');
    const dataDir = path.join(expDir, 'データ');
    if (!fs.existsSync(dataDir)) { console.log('データ/ がまだ無いので，あげるものがありません'); return; }
    if (fs.existsSync(path.join(dataDir, '.collect.lock'))) throw new Error('データ/.collect.lock があります．集めている途中か前回止まったので，あげません');
    const exe = findRclone();
    if (!exe) throw new Error('rclone が見つかりません．winget install Rclone.Rclone で入れ，rclone config でリモートを作ってください');
    console.log(`あげ先：${remote}${dry ? '（試しに見るだけ．何もあげません）' : ''}`);

    const ex = EXCLUDES.flatMap(e => ['--exclude', e]);
    const copyArgs = ['copy', dataDir, remote, ...ex, '--progress', '--stats-one-line'];
    if (dry) copyArgs.push('--dry-run');
    if (rclone(exe, copyArgs) !== 0) throw new Error('rclone copy が失敗しました．ネットワークかログインを確かめてもう一度実行してください（あげ終わったものは次は飛ばします）');
    if (dry) { console.log('\n試しに見ただけです．何もあげていません'); return; }

    // 手元のファイルがすべて Drive に同じ中身であるか（Drive にだけあるものは問わない）
    if (rclone(exe, ['check', dataDir, remote, ...ex, '--one-way']) !== 0) {
      throw new Error('あげた後の照合で合わないファイルがありました．上の表示を見て，もう一度実行してください');
    }
    console.log(`\nあげ終わりました．手元のファイルはすべて ${remote} に同じ中身であります`);
  } catch (e) {
    console.log(`\n止めました：${e && e.message ? e.message : e}`);
    process.exitCode = 1;
  } finally {
    if (!yes) {
      process.stdout.write('\nEnter で閉じる');
      await new Promise(r => { process.stdin.once('data', r); process.stdin.once('end', r); });
      process.stdin.pause();
    }
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { loadDrive, findRclone };
