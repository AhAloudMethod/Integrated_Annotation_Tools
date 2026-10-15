// フレームレートを動画ファイル（MP4・MOV）の情報から読む（core/frame.js の readContainerFps）：開いただけで、再生せずに決まる
const { spawnSync } = require('child_process');
const { chromium } = require('playwright-core');
const { URL, BROWSER, out } = require('./_env');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);

// 短い動画を作る。faststart なしは moov がファイルの末尾に来る
const make = (name, rate, faststart) => {
  const args = ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=160x90:rate=${rate}:duration=2`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p'];
  if (faststart) args.push('-movflags', '+faststart');
  const r = spawnSync('ffmpeg', [...args, out(name)]);
  return !r.error && r.status === 0;
};

(async () => {
  const clips = [['fps60.mp4', '60', true, '60'], ['fps2997_tail.mp4', '30000/1001', false, '29.97'], ['fps24.mov', '24', true, '24']];
  if (!clips.every(([n, r, f]) => make(n, r, f))) { console.log('skip  ファイルからのフレームレート（ffmpeg がありません）'); return; }
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const errs = [];
  const p = await browser.newPage({ viewport: { width: 1366, height: 768 } }); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss());
  await p.goto(URL); await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('ahann_fps')) localStorage.removeItem(k); }); await p.reload();
  await p.selectOption('#mode', 'excel');

  for (const [name, , , want] of clips) {
    await p.setInputFiles('#file', out(name));
    await p.waitForFunction(() => AH.S.meta.duration > 0); await p.waitForTimeout(300);
    const st = await p.evaluate(() => ({ fps: document.getElementById('rgFps').value, info: document.getElementById('frInfo').textContent, paused: AH.video.paused, meta: AH._.fpsMeta() }));
    check(`${name}：開いただけで ${want} fps に決まり、欄に「ファイル」と出る`, st.fps === want && /ファイル/.test(st.info) && st.paused && st.meta.source === 'file', JSON.stringify(st));
  }

  // MP4・MOV でないファイルは読めない（null）。再生中の推定に任せる
  const bad = await p.evaluate(() => AH._.readContainerFps(new File(['not a video'], 'x.mp4')));
  check('MP4・MOV でないファイルからは読まない', bad === null, JSON.stringify(bad));

  await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('ahann_fps')) localStorage.removeItem(k); });
  console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
