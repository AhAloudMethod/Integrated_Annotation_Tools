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

  // 矢印キー：←→ は前・次の区間の始めへ（不揃いの区間でも）、Ctrl+←→ は 1 フレーム、Shift+←→ は 0.1 秒
  await p.keyboard.press('Escape'); await p.selectOption('#mode', 'excel'); await p.waitForTimeout(150);
  await p.evaluate(() => { AH._.setRange({ edges: [1, 2.5, 4, 7, 10], start: 1, target: 10, count: 4 }); AH.seekTo(3); document.activeElement.blur(); }); await p.waitForTimeout(150);
  const tAt = () => p.evaluate(() => +AH.video.currentTime.toFixed(3));
  await p.keyboard.press('ArrowRight'); await p.waitForTimeout(120); const k1 = await tAt();
  await p.keyboard.press('ArrowRight'); await p.waitForTimeout(120); const k2 = await tAt();
  await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(120); await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(120); const k3 = await tAt();
  await p.evaluate(() => AH.seekTo(0.3)); await p.waitForTimeout(120);
  await p.keyboard.press('ArrowRight'); await p.waitForTimeout(120); const k4 = await tAt();
  check('←→ で前・次の区間の始めへ移り、評価区間の前からは最初の区間へ', k1 === 4.001 && k2 === 7.001 && k3 === 2.501 && k4 === 1.001, JSON.stringify([k1, k2, k3, k4]));
  const fr0 = await p.evaluate(() => AH._.frameAt(AH.video.currentTime));
  await p.keyboard.press('Control+ArrowRight'); await p.waitForTimeout(120); const fr1 = await p.evaluate(() => AH._.frameAt(AH.video.currentTime));
  await p.keyboard.press('Control+ArrowLeft'); await p.keyboard.press('Control+ArrowLeft'); await p.waitForTimeout(120); const fr2 = await p.evaluate(() => AH._.frameAt(AH.video.currentTime));
  await p.keyboard.press('Shift+ArrowRight'); await p.waitForTimeout(120); const k5 = await tAt();
  check('Ctrl+←→ で 1 フレーム、Shift+←→ で 0.1 秒動く', fr1 === fr0 + 1 && fr2 === fr0 - 1 && Math.abs(k5 - (fr2 / 25 + 0.001 + 0.1)) < 0.002, JSON.stringify({ fr0, fr1, fr2, k5 }));
  // Excel のセルの中：←→ はセルの移動のまま、Ctrl+←→ は 1 フレーム
  await p.click('input[data-ax=v][data-s="1"]');
  await p.keyboard.press('Control+ArrowRight'); await p.waitForTimeout(120); const fr3 = await p.evaluate(() => [AH._.frameAt(AH.video.currentTime), document.activeElement.dataset.s]);
  await p.keyboard.press('ArrowRight'); const fs4 = await p.evaluate(() => document.activeElement.dataset.s);
  check('セルの中では Ctrl+←→ で 1 フレーム動き、←→ はセルを移る', fr3[0] === fr2 + 3 && fr3[1] === '1' && fs4 === '2', JSON.stringify({ fr3, fs4 }));

  await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('ahann_fps') || k.startsWith('ahann_range')) localStorage.removeItem(k); });
  console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
