const { chromium } = require('playwright-core'); const path = require('path');
const { URL, VID, BROWSER, out } = require('./_env');
(async () => {
  const b = await chromium.launch({ executablePath: BROWSER, headless: true });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const run = async (noApi) => {
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    if (noApi) await p.addInitScript(() => { delete HTMLVideoElement.prototype.requestPictureInPicture; Object.defineProperty(Document.prototype, 'pictureInPictureEnabled', { get: () => undefined }); });
    await p.goto(URL); await p.selectOption('#mode', 'emujoy');
    await p.setInputFiles('#file', VID); await p.waitForFunction(() => AH.S.meta.duration > 0);
    const label0 = await p.$eval('#pipBtn', e => e.textContent);
    await p.click('#pipBtn'); const helpShown = !(await p.$eval('#pipHelp', e => e.hidden));
    if (noApi) { await p.screenshot({ path: out('shot6_fxhelp.png'), clip: { x: 0, y: 0, width: 1400, height: 400 } }); await p.click('#pipCollapse'); }
    const collapsed = await p.evaluate(() => document.body.classList.contains('pip')), label1 = await p.$eval('#pipBtn', e => e.textContent);
    if (noApi) { await p.click('#pipBack'); }
    const back = await p.evaluate(() => document.body.classList.contains('pip'));
    console.log(noApi ? 'Firefox相当' : 'Chrome/Edge', { label0, helpShown, collapsed, label1, back, log: await p.evaluate(() => AH.S.log.filter(l => l.type === 'pip').map(l => l.value + '/' + l.detail).join(',')), errs: errs.join('|') || 'none' });
    await p.close();
  };
  await run(true); await run(false);
  await b.close();
})();
