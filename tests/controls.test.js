// 記録オフのレバー・スライダー：再生中でも動かせる（記録済みの値に引き戻されない）。シークすると記録済みの値に追従する
const { chromium } = require('playwright-core');
const { URL, VID, BROWSER } = require('./_env');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const errs = [];
  const open = async mode => {
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss());
    await p.goto(URL); await p.selectOption('#mode', mode); await p.setInputFiles('#file', VID);
    await p.waitForFunction(() => AH.S.meta.duration > 0); await p.evaluate(() => document.activeElement && document.activeElement.blur());
    return p;
  };
  const peek = p => p.evaluate(() => AH.mode.peek());

  // スロットル：記録オフのまま再生中に W を押すとレバーが上がり、離してもその位置に留まる
  {
    const p = await open('throttle');
    await p.keyboard.press('Space'); await p.waitForTimeout(200);
    await p.keyboard.down('KeyW'); await p.waitForTimeout(500); await p.keyboard.up('KeyW');
    const moved = await peek(p);
    await p.waitForTimeout(400);
    const stay = await peek(p);
    await p.keyboard.press('Space');
    const pts = await p.evaluate(() => AH.S.data.points.v.length);
    check('再生中・記録オフでもレバーが動く', moved.v > 6, JSON.stringify(moved));
    check('再生中・記録オフで離した位置に留まる', Math.abs(stay.v - moved.v) < 0.05, JSON.stringify(stay));
    check('記録オフの操作は記録されない', pts === 1, 'points=' + pts);
    // シークすると記録済みの値（何も書いていないので 5）に追従する
    await p.evaluate(() => AH.seekTo(8)); await p.waitForTimeout(300);
    const after = await peek(p);
    check('シークすると記録済みの値に追従する', after.v === 5, JSON.stringify(after));
    // 記録オンで再生中に動かすと記録される
    await p.keyboard.press('KeyR'); await p.keyboard.press('Space');
    await p.keyboard.down('KeyW'); await p.waitForTimeout(400); await p.keyboard.up('KeyW'); await p.waitForTimeout(200);
    await p.keyboard.press('Space'); await p.keyboard.press('KeyR');
    const rec = await p.evaluate(() => AH.valueAt('v', AH.video.currentTime - 0.05));
    check('記録オンでは再生中の操作が記録される', rec > 6, 'value=' + rec);
    await p.close();
  }

  // CARMA・RankTrace も再生中・記録オフで動かせる
  {
    const p = await open('carma');
    await p.keyboard.press('Space'); await p.waitForTimeout(200);
    await p.keyboard.down('ArrowUp'); await p.waitForTimeout(400); await p.keyboard.up('ArrowUp'); await p.waitForTimeout(300);
    const c = await peek(p); await p.keyboard.press('Space');
    check('CARMA：再生中・記録オフでも動いて留まる', c.v > 6, JSON.stringify(c));
    await p.close();
  }
  {
    const p = await open('ranktrace');
    await p.keyboard.press('Space'); await p.waitForTimeout(200);
    const b = await p.locator('canvas.trace').boundingBox(); await p.mouse.move(b.x + 60, b.y + 60);
    for (let i = 0; i < 3; i++) { await p.mouse.wheel(0, -100); await p.waitForTimeout(80); }
    await p.waitForTimeout(300); const r = await peek(p); await p.keyboard.press('Space');
    check('RankTrace：再生中・記録オフでも動いて留まる', r.v === 1.5, JSON.stringify(r));
    await p.close();
  }
  // カスタム（スライダー×キーボード）
  {
    const p = await open('custom');
    await p.locator('select[aria-label=インタフェース]').selectOption('sliders'); await p.locator('select[aria-label=入力]').selectOption('keyboard');
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    await p.keyboard.press('Space'); await p.waitForTimeout(200);
    await p.keyboard.down('KeyW'); await p.waitForTimeout(400); await p.keyboard.up('KeyW'); await p.waitForTimeout(300);
    const c = await peek(p); await p.keyboard.press('Space');
    check('カスタム（スライダー×キーボード）：再生中・記録オフでも動いて留まる', c.v > 6, JSON.stringify(c));
    await p.close();
  }

  console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
