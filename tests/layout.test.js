const { chromium } = require('playwright-core');
const path = require('path');
const { URL, VID, BROWSER, out } = require('./_env');
(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const errs = [];
  const page = async () => { const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss()); await p.goto(URL); return p; };

  // 練習モード：EMuJoy（動画なしでドラッグ）
  let p = await page();
  await p.selectOption('#mode', 'emujoy');
  let b = await p.locator('canvas.plane').boundingBox();
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await p.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.2, { steps: 5 });
  const during = await p.evaluate(() => ({ pen: [AH.pen.v, AH.pen.a], now: document.querySelector('.nowRow b').textContent }));
  await p.mouse.up();
  const after = await p.evaluate(() => ({ now: document.querySelector('.nowRow b').textContent, status: document.getElementById('status').textContent }));
  await p.setInputFiles('#file', VID); await p.waitForFunction(() => AH.S.meta.duration > 0); await p.waitForTimeout(200);
  const loaded = await p.evaluate(() => ({ pv: AH.S.data.points.v.map(x => x.val), log: AH.S.log.map(l => l.type).join(','), armed: AH.S.armed }));
  console.log('emujoy practice: during', JSON.stringify(during), 'after', JSON.stringify(after), '\n  after load', JSON.stringify(loaded));
  await p.close();

  // 練習モード：スロットル（記録オンなしでキー操作）
  p = await page(); await p.selectOption('#mode', 'throttle');
  await p.keyboard.down('KeyW'); await p.waitForTimeout(400); await p.keyboard.up('KeyW');
  await p.keyboard.down('ArrowDown'); await p.waitForTimeout(300); await p.keyboard.up('ArrowDown');
  await p.screenshot({ path: out('shot5_throttle_practice.png') });
  const hint = await p.evaluate(() => document.getElementById('hint').hidden);
  console.log('throttle practice: hint hidden', hint, 'pts', await p.evaluate(() => AH.S.data.points.v.length));
  await p.keyboard.press('KeyR'); const armedPractice = await p.evaluate(() => AH.S.armed);
  await p.setInputFiles('#file', VID); await p.waitForFunction(() => AH.S.meta.duration > 0); await p.waitForTimeout(200);
  console.log('  armed in practice', armedPractice, '-> after load armed', await p.evaluate(() => AH.S.armed));
  await p.close();

  // 練習モード：CARMA のスライダー・RankTrace のホイール・カスタム（SAM×連続、スライダー×キーボード）・AffectRank
  p = await page(); await p.selectOption('#mode', 'carma'); b = await p.locator('canvas.bars').boundingBox();
  await p.mouse.move(b.x + b.width / 2, b.y + 60); await p.mouse.down(); await p.mouse.move(b.x + b.width / 2, b.y + 80); await p.mouse.up();
  await p.waitForTimeout(100);
  console.log('carma practice ok (no error)'); await p.close();
  p = await page(); await p.selectOption('#mode', 'ranktrace'); b = await p.locator('canvas.trace').boundingBox();
  await p.mouse.move(b.x + 50, b.y + 50); await p.mouse.wheel(0, -100); await p.waitForTimeout(100); console.log('ranktrace practice ok'); await p.close();
  p = await page(); await p.selectOption('#mode', 'affectrank'); await p.click('.arBtn[title="快"]'); console.log('affectrank practice events', await p.evaluate(() => AH.S.data.events.length)); await p.close();

  // 動画の大きさ
  p = await page(); await p.selectOption('#mode', 'emujoy'); await p.setInputFiles('#file', VID); await p.waitForFunction(() => AH.S.meta.duration > 0);
  for (const v of [35, 70]) {
    await p.evaluate(v => { const el = document.getElementById('vidSize'); el.value = v; el.dispatchEvent(new Event('input')); }, v);
    await p.waitForTimeout(200);
    const w = await p.evaluate(() => ({ stage: Math.round(document.getElementById('stage').getBoundingClientRect().width), side: Math.round(document.querySelector('.side').getBoundingClientRect().width), plane: Math.round(document.querySelector('canvas.plane').getBoundingClientRect().width) }));
    await p.screenshot({ path: out(`shot5_size${v}.png`) });
    console.log('size', v, JSON.stringify(w));
  }
  // 小窓レイアウト（headless では PiP が使えないのでクラスで再現）
  await p.evaluate(() => { document.body.classList.add('pip'); window.dispatchEvent(new Event('resize')); });
  await p.waitForTimeout(200); await p.screenshot({ path: out('shot5_pip.png') });
  console.log('pipEnabled', await p.evaluate(() => document.pictureInPictureEnabled), 'pipBtn hidden', await p.$eval('#pipBtn', e => e.hidden));
  await p.close();
  // 小窓レイアウト：RCEA（動画上のジョイスティック）
  p = await page(); await p.selectOption('#mode', 'rcea'); await p.setInputFiles('#file', VID); await p.waitForFunction(() => AH.S.meta.duration > 0);
  await p.evaluate(() => { document.body.classList.add('pip'); window.dispatchEvent(new Event('resize')); }); await p.waitForTimeout(200);
  await p.screenshot({ path: out('shot5_pip_rcea.png') }); await p.close();
  console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
