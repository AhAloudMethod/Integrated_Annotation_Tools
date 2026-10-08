const { chromium } = require('playwright-core');
const path = require('path');
const { URL, VID, BROWSER, out } = require('./_env');
(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 }, acceptDownloads: true });
  const errs = [];
  const newPage = async (mode, accept = false) => {
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(mode + ' pageerror ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push(mode + ' console ' + m.text()); });
    page.on('dialog', d => (page._accept ? d.accept() : d.dismiss()));
    page._accept = accept;
    await page.goto(URL); await page.evaluate(() => AH._.setTimeline(true));   // 評価グラフは既定で閉じているので開く
    await page.fill('#pid', 'T1'); await page.selectOption('#mode', mode);
    await page.setInputFiles('#file', VID); await page.waitForFunction(() => AH.S.meta.duration > 0); await page.waitForTimeout(300);
    return page;
  };
  const blur = p => p.evaluate(() => document.activeElement && document.activeElement.blur());
  const st = p => p.evaluate(() => { const d = AH.S.data; return { mode: AH.S.meta.mode, pv: d.points.v.map(x => [+x.t.toFixed(2), x.val]).slice(0, 10), pa: d.points.a.map(x => [+x.t.toFixed(2), x.val]).slice(0, 6), cv: d.cells.v.slice(0, 8), ca: d.cells.a.slice(0, 8), strokes: d.strokes.map(s => (s.source || '') + ':' + s.axes), undo: AH.S.undo.length }; });
  const tlLane = async (p, axis, fx, fy) => { const b = await p.locator('#tl').boundingBox(); const top = axis === 'v' ? 8 : (b.height - 28) / 2 + 8, bot = axis === 'v' ? (b.height - 28) / 2 - 8 : b.height - 36; return { x: b.x + 44 + fx * (b.width - 52), y: b.y + top + (1 - fy) * (bot - top) }; };

  // 1. 方式の切り替えと復帰
  let p = await newPage('key');
  await blur(p); await p.keyboard.press('ArrowRight'); await p.keyboard.press('Digit8');
  await p.selectOption('#mode', 'emujoy'); await p.waitForTimeout(200);
  const afterSwitch = await st(p);
  p._accept = true;
  await p.selectOption('#mode', 'key'); await p.waitForTimeout(200);
  console.log('1 switch ->emujoy', JSON.stringify(afterSwitch.pv), '| back ->key', JSON.stringify((await st(p)).pv), 'modeSel', await p.$eval('#mode', e => e.disabled));
  await p.close();

  // 2. グラフで編集（連続）
  p = await newPage('emujoy');
  let a0 = await tlLane(p, 'v', 0.25, 0.9), a1 = await tlLane(p, 'v', 0.5, 0.1);
  await p.mouse.move(a0.x, a0.y); await p.mouse.down(); await p.mouse.move((a0.x + a1.x) / 2, a0.y, { steps: 5 }); await p.mouse.move(a1.x, a1.y, { steps: 5 }); await p.mouse.up();
  const s2 = await st(p);
  const vals = await p.evaluate(() => [1, 3.5, 4.5, 5.5, 7, 9].map(t => AH.valueAt('v', t)));
  // 下端の帯でシーク
  const b = await p.locator('#tl').boundingBox(); await p.mouse.click(b.x + 44 + 0.75 * (b.width - 52), b.y + b.height - 6);
  const t2 = await p.evaluate(() => AH.video.currentTime);
  await blur(p); await p.keyboard.press('Control+z');
  console.log('2 graph series: npts', (await p.evaluate(() => AH.S.data.points.v.length)), 'vals@1,3.5,4.5,5.5,7,9', JSON.stringify(vals), 'strokes', s2.strokes.join(' '), 'seek->', t2.toFixed(2), 'afterUndo pts', await p.evaluate(() => AH.S.data.points.v.length));
  await p.close();

  // 3. 評価区間 + 区間方式 + グラフで編集（区間）
  p = await newPage('affectgrid');
  await p.click('#rgBtn'); await p.fill('#rgStart', '2'); await p.press('#rgStart', 'Tab'); await p.fill('#rgBin', '2'); await p.press('#rgBin', 'Tab'); await p.click('#rgFit');
  const rg = await p.evaluate(() => AH.S.meta.range);
  await p.click('#rgBtn');
  await p.evaluate(() => AH.seekTo(4.5)); await p.waitForTimeout(200);
  const gb = await p.locator('canvas.plane').boundingBox(); await p.mouse.click(gb.x + gb.width * 0.8, gb.y + gb.height * 0.2);
  a0 = await tlLane(p, 'a', 2 / 12 + 0.01, 0.1); a1 = await tlLane(p, 'a', 8 / 12, 0.1);
  await p.mouse.move(a0.x, a0.y); await p.mouse.down(); await p.mouse.move(a1.x, a1.y, { steps: 8 }); await p.mouse.up();
  const s3 = await st(p);
  const labels = await p.$$eval('.strip .sc .lab', els => els.map(e => e.textContent));
  const dls = []; p.on('download', d => dls.push(d)); await p.click('#exportBtn'); await p.waitForTimeout(1200);
  const binsDl = dls.find(d => d.suggestedFilename().endsWith('_bins.csv')); const fs = require('fs'); const bp = out('bins.csv'); await binsDl.saveAs(bp);
  console.log('3 range', JSON.stringify(rg), 'labels', labels.join(' '), '\n  cells v', JSON.stringify(s3.cv), 'a', JSON.stringify(s3.ca), '\n  bins.csv:', fs.readFileSync(bp, 'utf8').split('\n').slice(0, 4).join(' | '));
  await p.close();

  // 4. カスタム：いくつかの組み合わせ
  const custom = async (cfg, act, label) => {
    const q = await newPage('custom');
    for (const [k, v] of Object.entries(cfg)) { const sel = q.locator('select[aria-label=' + { time: '時間', rep: 'インタフェース', input: '入力', dims: '次元', scale: '尺度', values: '値' }[k] + ']'); await sel.selectOption(v); await q.waitForTimeout(100); }
    await blur(q);
    await act(q);
    await q.waitForTimeout(300);
    const s = await st(q), opt = await q.evaluate(() => AH.S.meta.options), note = await q.$eval('.cfgNote', e => e.textContent), help = await q.$eval('#modeHelp', e => e.textContent.slice(0, 60));
    await q.screenshot({ path: out(`shot3_${label}.png`) });
    console.log('4', label, JSON.stringify({ time: opt.time, rep: opt.rep, input: opt.input, dims: opt.dims, scale: opt.scale }), note, '\n   ', JSON.stringify({ pv: s.pv, pa: s.pa, cv: s.cv, ca: s.ca, strokes: s.strokes }), '\n    help:', help);
    await q.close();
  };
  await custom({ rep: 'sam' }, async q => { await q.click('.samRow.v button[data-v="7"]'); await q.keyboard.press('ArrowRight'); await q.keyboard.press('ArrowRight'); await q.click('.samRow.a button[data-v="2"]'); }, 'sam_cont');
  await custom({ time: 'disc' }, async q => { const b = await q.locator('canvas.plane').boundingBox(); await q.mouse.click(b.x + b.width * 0.85, b.y + b.height * 0.2); }, 'plane_disc');
  await custom({ rep: 'sliders', input: 'keyboard' }, async q => { await q.keyboard.press('KeyR'); await q.keyboard.press('Space'); await q.keyboard.down('KeyW'); await q.waitForTimeout(300); await q.keyboard.up('KeyW'); await q.keyboard.down('ArrowDown'); await q.waitForTimeout(300); await q.keyboard.up('ArrowDown'); await q.waitForTimeout(200); await q.keyboard.press('KeyR'); await q.keyboard.press('Space'); }, 'sliders_kb');
  await custom({ rep: 'sliders', scale: 'rel' }, async q => { await q.keyboard.press('KeyR'); await q.keyboard.press('Space'); const b = await q.locator('canvas.bars').boundingBox(); await q.mouse.move(b.x + b.width * 0.25, b.y + 100); for (let i = 0; i < 3; i++) { await q.mouse.wheel(0, -100); await q.waitForTimeout(100); } await q.mouse.move(b.x + b.width * 0.75, b.y + 100); await q.mouse.wheel(0, 100); await q.waitForTimeout(200); await q.keyboard.press('KeyR'); await q.keyboard.press('Space'); }, 'sliders_rel');
  await custom({ rep: 'grid', dims: 'a' }, async q => { const b = await q.locator('canvas.plane').boundingBox(); await q.mouse.click(b.x + b.width * 0.2, b.y + b.height * 0.2); }, 'grid_cont_aonly');
  await custom({ rep: 'circle' }, async q => { await q.keyboard.press('Space'); const b = await q.locator('canvas.plane').boundingBox(); await q.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await q.mouse.down(); await q.mouse.move(b.x + b.width * 0.95, b.y + b.height * 0.05, { steps: 10 }); await q.waitForTimeout(300); await q.mouse.up(); await q.keyboard.press('Space'); }, 'circle_mouse');
  // プリセット読み込み
  p = await newPage('custom'); await p.selectOption('.cfg > select', 'feeltrace'); await p.waitForTimeout(200);
  console.log('4 preset feeltrace ->', JSON.stringify(await p.evaluate(() => AH.S.meta.options)), await p.$eval('.cfgNote', e => e.textContent));
  await p.close();

  // 5. 既存方式の回帰（簡易）
  for (const m of ['excel', 'sam', 'affectrank', 'carma', 'ranktrace', 'rcea', 'halolight', 'throttle', 'darma', 'feeltrace']) {
    const q = await newPage(m); await q.screenshot({ path: out(`shot4_${m}.png`) }); await q.close();
  }
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})();
