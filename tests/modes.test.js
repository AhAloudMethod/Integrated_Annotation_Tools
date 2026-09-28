const { chromium } = require('playwright-core');
const path = require('path');
const { URL, VID, BROWSER, out } = require('./_env');
const only = process.argv[2];
(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
  let modes = ['key', 'emujoy', 'feeltrace', 'rcea', 'darma', 'throttle', 'halolight', 'carma', 'ranktrace', 'excel', 'affectgrid', 'sam', 'affectrank'];
  if (only) modes = only.split(',');
  for (const m of modes) {
    const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', e => errs.push('pageerror ' + e.message));
    page.on('console', msg => { if (msg.type() === 'error') errs.push('console ' + msg.text()); });
    page.on('dialog', d => d.dismiss());
    await page.goto(URL);
    await page.selectOption('#mode', m);
    await page.setInputFiles('#file', VID);
    await page.waitForFunction(() => AH.S.meta.duration > 0);
    await page.waitForTimeout(300);
    const neutral = async () => page.evaluate(() => document.activeElement && document.activeElement.blur());
    const play = async ms => { await page.keyboard.press('Space'); await page.waitForTimeout(ms); await page.keyboard.press('Space'); await page.waitForTimeout(100); };
    const box = async sel => page.locator(sel).first().boundingBox();
    try {
      if (m === 'key') { await page.keyboard.press('ArrowRight'); await page.keyboard.press('Digit7'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+Digit2'); await page.keyboard.press('Numpad8'); }
      if (['emujoy', 'feeltrace', 'halolight', 'rcea'].includes(m)) {
        const sel = m === 'rcea' ? '.rceaPad canvas' : 'canvas.plane';
        const b = await box(sel);
        await page.keyboard.press('Space');
        await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5); await page.mouse.down();
        for (let i = 0; i < 10; i++) { await page.mouse.move(b.x + b.width * (0.5 + 0.04 * i), b.y + b.height * (0.5 - 0.04 * i)); await page.waitForTimeout(60); }
        await page.mouse.up(); await page.waitForTimeout(300); await page.keyboard.press('Space');
        await page.evaluate(() => AH.seekTo(0.5)); await page.waitForTimeout(200);
        await page.keyboard.press('Space'); await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.8); await page.mouse.down(); await page.waitForTimeout(300); await page.mouse.up(); await page.keyboard.press('Space');
      }
      if (m === 'darma') { const b = await box('canvas.plane'); await page.keyboard.press('KeyR'); await page.keyboard.press('Space'); await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.2); await page.mouse.down(); await page.waitForTimeout(500); await page.mouse.up(); await page.waitForTimeout(300); await page.keyboard.press('Space'); await page.keyboard.press('KeyR'); }
      if (m === 'throttle') { await page.keyboard.press('KeyR'); await page.keyboard.press('Space'); await page.keyboard.down('KeyW'); await page.waitForTimeout(400); await page.keyboard.up('KeyW'); await page.keyboard.down('ArrowDown'); await page.waitForTimeout(300); await page.keyboard.up('ArrowDown'); await page.waitForTimeout(300); await page.keyboard.press('Space'); await page.keyboard.press('KeyR'); }
      if (m === 'carma' || m === 'ranktrace') {
        for (const ax of ['v', 'a']) {
          await page.check(`input[name=pass][value=${ax}]`); await page.evaluate(() => AH.seekTo(0)); await page.waitForTimeout(200);
          await neutral();
          await page.keyboard.press('KeyR'); await page.keyboard.press('Space');
          if (m === 'ranktrace') { const b = await box('canvas.trace'); await page.mouse.move(b.x + 50, b.y + 50); for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, ax === 'v' ? -100 : 100); await page.waitForTimeout(120); } }
          else { await page.keyboard.down('ArrowUp'); await page.waitForTimeout(400); await page.keyboard.up('ArrowUp'); }
          await page.waitForTimeout(300); await page.keyboard.press('Space'); await page.keyboard.press('KeyR');
        }
      }
      if (m === 'excel') { await page.click('input[data-ax=v][data-s="0"]'); await page.keyboard.type('7'); await page.keyboard.press('Enter'); await page.keyboard.type('x'); await page.keyboard.type('3'); await page.keyboard.press('ArrowDown'); await page.keyboard.type('8'); await page.keyboard.press('Escape'); await play(1200); await page.fill('textarea', 'メモてすと'); await page.locator('textarea').blur(); }
      if (m === 'affectgrid') { const b = await box('canvas.plane'); await page.check('text=入力後に次の区間へ'); await page.mouse.click(b.x + b.width * 0.85, b.y + b.height * 0.15); await page.waitForTimeout(200); await page.mouse.click(b.x + b.width * 0.2, b.y + b.height * 0.7); }
      if (m === 'sam') { await page.click('.samRow.v button[data-v="9"]'); await page.click('.samRow.a button[data-v="3"]'); await page.keyboard.press('ArrowRight'); await page.click('.samRow.v button[data-v="2"]'); }
      if (m === 'affectrank') { await page.keyboard.press('Space'); await page.waitForTimeout(400); await page.click('.arBtn[title="活発・快"]'); await page.waitForTimeout(400); await page.keyboard.press('Numpad4'); await page.keyboard.press('Space'); await page.keyboard.press('Backspace'); }
      await page.waitForTimeout(300);
      const st = await page.evaluate(() => { const d = AH.S.data; return { pv: d.points.v.map(p => [+p.t.toFixed(2), p.val]).slice(0, 8), pa: d.points.a.map(p => [+p.t.toFixed(2), p.val]).slice(0, 6), strokes: d.strokes.map(s => s.axes + ':' + s.samples.length + ':' + s.end_reason), cv: d.cells.v.slice(0, 4), ca: d.cells.a.slice(0, 4), ev: d.events.map(e => e.label), memo: d.memo, log: AH.S.log.length, undo: AH.S.undo.length }; });
      await page.screenshot({ path: out(`shot_${m}.png`) });
      const dls = []; page.on('download', d => dls.push(d.suggestedFilename()));
      await page.click('#exportBtn'); await page.waitForTimeout(1500);
      const before = await page.evaluate(() => JSON.stringify(AH.S.data)); await neutral(); await page.keyboard.press('Control+z'); const after = await page.evaluate(() => JSON.stringify(AH.S.data));
      console.log('==', m, JSON.stringify(st), '\n   downloads:', dls.join(' '), '\n   undo changed:', before !== after, errs.length ? '\n   ERR ' + errs.join(' | ') : '');
    } catch (e) { console.log('==', m, 'FAIL', e.message.split('\n')[0], errs.join(' | ')); }
    await page.close();
  }
  await browser.close();
})();
