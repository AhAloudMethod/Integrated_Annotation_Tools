const { chromium } = require('playwright-core');
const path = require('path');
const { URL, VID, BROWSER, out } = require('./_env');
(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const open = async (accept) => {
    const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('dialog', d => (accept ? d.accept() : d.dismiss()));
    await page.goto(URL);
    await page.fill('#pid', 'P99'); await page.selectOption('#mode', 'carma');
    await page.setInputFiles('#file', VID);
    await page.waitForFunction(() => AH.S.meta.duration > 0); await page.waitForTimeout(300);
    return { page, errs };
  };
  let { page, errs } = await open(false);
  await page.check('input[name=pass][value=a]');
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('KeyR'); await page.keyboard.press('Space');
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(400); await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(200); await page.keyboard.press('Space');
  const a = await page.evaluate(() => ({ log: AH.S.log.map(l=>l.type).join(','), paused: AH.video.paused, opt: AH.S.meta.options, pa: AH.S.data.points.a.length, undo: AH.S.undo.length }));
  await page.close();
  ({ page, errs } = await open(true));
  const b = await page.evaluate(() => ({ opt: AH.S.meta.options, pa: AH.S.data.points.a.length, undo: AH.S.undo.length, checked: document.querySelector('input[name=pass]:checked').value, last: AH.S.log.at(-1).type }));
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('Control+z');
  const c = await page.evaluate(() => AH.S.data.points.a.length);
  console.log('before', JSON.stringify(a), '\nrestored', JSON.stringify(b), '\nafter undo pa', c, errs.join('|'));
  await page.close();
  // screenshots after tweaks
  for (const m of ['sam', 'affectrank', 'throttle', 'affectgrid', 'darma', 'halolight']) {
    const p = await ctx.newPage(); p.on('dialog', d => d.dismiss());
    await p.goto(URL); await p.selectOption('#mode', m); await p.setInputFiles('#file', VID);
    await p.waitForFunction(() => AH.S.meta.duration > 0); await p.waitForTimeout(300);
    if (m === 'halolight') { const bx = await p.locator('canvas.plane').boundingBox(); await p.mouse.move(bx.x + bx.width * 0.7, bx.y + bx.height * 0.4); await p.mouse.down(); await p.waitForTimeout(100); }
    await p.screenshot({ path: out(`shot2_${m}.png`) }); await p.close();
  }
  await browser.close();
})();
