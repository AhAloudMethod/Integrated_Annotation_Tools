const { chromium } = require('playwright-core'); const path = require('path');
const { URL, VID, BROWSER, out } = require('./_env');
(async () => {
  const b = await chromium.launch({ executablePath: BROWSER, headless: true });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL); await p.selectOption('#mode', 'sam');
  await p.setInputFiles('#file', VID); await p.waitForFunction(() => AH.S.meta.duration > 0); await p.waitForTimeout(500);
  await p.click('.samRow.v button[data-v="9"]'); await p.screenshot({ path: out('shot_samimg.png'), fullPage: true }); console.log('imgs in SAM rows:', await p.$$eval('.samBtns img', e => e.length), 'errors:', errs.join('|') || 'none');
  await b.close();
})();
