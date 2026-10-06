// 1フレーム移動（core/frame.js）：フレームレートの推定・, と . での移動・評価区間の開始と終了をフレームの始まりに揃える・手入力
const { chromium } = require('playwright-core');
const { URL, VID, BROWSER, out } = require('./_env');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss());
  await p.goto(URL); await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('ahann_fps') || k.startsWith('ahann_range')) localStorage.removeItem(k); }); await p.reload();
  await p.selectOption('#mode', 'excel'); await p.setInputFiles('#file', VID);
  await p.waitForFunction(() => AH.S.meta.duration > 0); await p.evaluate(() => document.activeElement && document.activeElement.blur());
  const st = () => p.evaluate(() => ({ t: +AH.video.currentTime.toFixed(4), paused: AH.video.paused, fps: document.getElementById('rgFps').value, info: document.getElementById('frInfo').textContent }));

  // 推定：再生すると 30 fps（テスト動画）と推定する
  await p.keyboard.press('Space'); await p.waitForTimeout(1500);
  await p.keyboard.press('Period'); await p.waitForTimeout(150);   // 再生中に . を押すと止まって1フレーム進む
  await p.click('#rgBtn'); await p.waitForTimeout(100);
  const a = await st();
  check('再生中に表示されたフレームから 30 fps と推定し、欄に「推定」と出る', a.fps === '30' && /推定/.test(a.info), JSON.stringify(a));
  check('再生中に . を押すと止まる', a.paused, JSON.stringify(a));

  // 1フレーム移動：1.0 秒（フレーム30）から . で 31、, を2回で 29
  await p.evaluate(() => AH.seekTo(1)); await p.waitForTimeout(150);
  await p.keyboard.press('Period'); await p.waitForTimeout(150); const b = await st();
  await p.keyboard.press('Comma'); await p.keyboard.press('Comma'); await p.waitForTimeout(150); const c = await st();
  check('. で1フレーム進み、, で1フレーム戻る（フレームの始まりの少し後へ）', Math.abs(b.t - (31 / 30 + 0.001)) < 0.0005 && /フレーム 31/.test(b.info) && Math.abs(c.t - (29 / 30 + 0.001)) < 0.0005 && /フレーム 29/.test(c.info), JSON.stringify([b, c]));
  await p.click('#frFwd'); await p.waitForTimeout(150); const d = await st();
  check('欄のボタンでも1フレーム進む', /フレーム 30/.test(d.info), JSON.stringify(d));

  // 今の時刻を開始・終了にする：フレームの始まりに揃う
  await p.click('#rgNow'); await p.waitForTimeout(100);
  for (let i = 0; i < 9; i++) await p.click('#frFwd');
  await p.evaluate(() => AH.seekTo(10.02)); await p.waitForTimeout(150);   // フレーム300の途中
  await p.click('#rgEndNow'); await p.waitForTimeout(100);
  const r = await p.evaluate(() => ({ ...AH.S.meta.range }));
  check('今の時刻を開始・終了にすると、今表示しているフレームの始まりに揃う', r.start === 1 && r.target === 10, JSON.stringify(r));

  // 手入力：25 fps にするとその間隔で動く。動画ごとに覚える
  await p.fill('#rgFps', '25'); await p.dispatchEvent('#rgFps', 'change');
  await p.evaluate(() => AH.seekTo(2)); await p.waitForTimeout(150);
  await p.keyboard.press('Period'); await p.waitForTimeout(150); const e = await st();
  check('フレームレートを手で 25 にすると 1/25 秒ずつ動き、欄に「手入力」と出る', Math.abs(e.t - (51 / 25 + 0.001)) < 0.0005 && /手入力/.test(e.info), JSON.stringify(e));
  await p.reload(); await p.setInputFiles('#file', VID); await p.waitForFunction(() => AH.S.meta.duration > 0); await p.waitForTimeout(300);
  await p.click('#rgBtn'); await p.waitForTimeout(100);
  const f = await st();
  check('手入力のフレームレートを動画ごとに覚える', f.fps === '25' && /手入力/.test(f.info), JSON.stringify(f));
  await p.locator('#rgPanel').screenshot({ path: out('shot_frame_panel.png') });

  await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('ahann_fps') || k.startsWith('ahann_range')) localStorage.removeItem(k); });
  console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
