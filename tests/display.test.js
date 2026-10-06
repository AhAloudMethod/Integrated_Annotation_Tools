// やり直し（Ctrl+Y）・四角の平面でスティックを角まで届かせる・区切りの線・RCEA の軸のラベル
const { chromium } = require('playwright-core');
const { URL, VID, BROWSER, out } = require('./_env');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
const JOY = 'Test Joystick (Vendor: 1234 Product: 0001)';

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await ctx.addInitScript(() => {
    window.__pads = [];
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => { const a = [null, null, null, null]; for (const p of window.__pads) a[p.index] = p; return a; } });
    window.__connect = (id, index) => { const p = { id, index, connected: true, mapping: '', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 8 }, () => ({ pressed: false, touched: false, value: 0 })) }; window.__pads.push(p); return p; };
  });
  const open = async mode => {
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss());
    await p.goto(URL); await p.evaluate(() => { localStorage.removeItem('ahann_grid'); localStorage.removeItem('ahann_pad_square'); }); await p.reload();
    await p.selectOption('#mode', mode); await p.setInputFiles('#file', VID);
    await p.waitForFunction(() => AH.S.meta.duration > 0); await p.evaluate(() => document.activeElement && document.activeElement.blur());
    return p;
  };
  const setChk = async (p, id, on) => { await p.click('#setBtn'); await (on ? p.check('#' + id) : p.uncheck('#' + id)); await p.click('#setBtn'); await p.waitForTimeout(100); };

  // ---- やり直し：Ctrl+Z で戻したものを Ctrl+Y・Ctrl+Shift+Z でやり直す。新しく書くとやり直しは消える
  {
    const p = await open('throttle');
    const n = () => p.evaluate(() => AH.S.data.points.v.length);
    await p.keyboard.press('KeyR'); await p.keyboard.press('Space'); await p.waitForFunction(() => !AH.video.paused && AH.video.currentTime > 0.05);
    await p.keyboard.down('KeyW'); await p.waitForTimeout(400); await p.keyboard.up('KeyW');
    await p.keyboard.press('Space'); await p.keyboard.press('KeyR'); await p.waitForTimeout(100);
    const n1 = await n();
    await p.keyboard.press('Control+z'); const n0 = await n();
    await p.keyboard.press('Control+y'); const n2 = await n();
    await p.keyboard.press('Control+z'); await p.keyboard.press('Control+Shift+z'); const n3 = await n();
    check('Ctrl+Z で戻し、Ctrl+Y（Ctrl+Shift+Z）でやり直す', n1 > 1 && n0 === 1 && n2 === n1 && n3 === n1, JSON.stringify([n1, n0, n2, n3]));
    await p.keyboard.press('Control+z');
    await p.evaluate(() => { AH.pushUndo(); AH.placePoint('v', 2, 3); });
    await p.keyboard.press('Control+y');
    const r = await p.evaluate(() => ({ n: AH.S.data.points.v.length, redo: AH.S.redo.length, log: AH.S.log.filter(l => l.type === 'redo').length }));
    check('新しく値を変えると、やり直しの履歴は消える（操作ログ redo）', r.n === 2 && r.redo === 0 && r.log === 2, JSON.stringify(r));
    await p.close();
  }

  // ---- 四角の平面：スティックを斜めに倒し切ると角（9・9）に届く。設定でオフなら従来どおり。円の方式は広げない
  {
    const p = await open('darma');
    await p.evaluate(id => window.__connect(id, 0), JOY); await p.waitForTimeout(150);
    const val = async (x, y) => { await p.evaluate(([x, y]) => { window.__pads[0].axes[0] = x; window.__pads[0].axes[1] = y; }, [x, y]); await p.waitForTimeout(100); return p.evaluate(() => { const s = AH.mode.sample(); return [s.v, s.a]; }); };
    const diag = await val(0.7071, -0.7071), half = await val(0.5, 0), mid = await val(0.35, -0.35);
    check('DARMA：斜めに倒し切ると角（9・9）、横に半分なら 7（方向はそのまま）', diag[0] === 9 && diag[1] === 9 && half[0] === 7 && half[1] === 5 && Math.abs(mid[0] - 7) < 0.05, JSON.stringify([diag, half, mid]));
    await setChk(p, 'padSquare', false);
    const off = await val(0.7071, -0.7071);
    const log = await p.evaluate(() => AH.S.log.filter(l => l.type === 'pad_square').map(l => l.value).join());
    check('設定でオフにすると広げない（7.83・7.83）。操作ログ pad_square', off[0] === 7.83 && off[1] === 7.83 && log === 'off', JSON.stringify([off, log]));
    await setChk(p, 'padSquare', true);
    await p.selectOption('#mode', 'rcea'); await p.waitForTimeout(150);
    const circ = await val(0.7071, -0.7071);
    check('RCEA（円）は広げない（7.83・7.83）', circ[0] === 7.83 && circ[1] === 7.83, JSON.stringify(circ));
    await p.close();
  }

  // ---- 区切りの線：設定でオンにすると平面・円・レバーの絵が変わる（オフに戻すと元どおり）
  {
    const p = await open('emujoy');
    for (const mode of ['emujoy', 'rcea', 'feeltrace', 'throttle', 'carma', 'halolight']) {
      await p.selectOption('#mode', mode); await p.waitForTimeout(200);
      const sel = mode === 'throttle' || mode === 'carma' ? 'canvas.bars' : 'canvas.plane';
      const img = () => p.$eval('#panel ' + sel, c => c.toDataURL());
      const a = await img(); await setChk(p, 'gridShow', true); const b = await img(); await setChk(p, 'gridShow', false); const c = await img();
      check(`${mode}：区切りの線のオン・オフで入力面が変わる`, a !== b && a === c);
    }
    const log = await p.evaluate(() => AH.S.log.filter(l => l.type === 'grid_display').length);
    check('区切りの線の切り替えは操作ログ grid_display に残る（最後の方式のセッションに2回）', log === 2, String(log));
    await setChk(p, 'gridShow', true);
    await p.selectOption('#mode', 'rcea'); await p.waitForTimeout(200);
    await p.locator('#panel').screenshot({ path: out('shot_rcea_labels.png') });
    await p.selectOption('#mode', 'emujoy'); await p.waitForTimeout(200);
    await p.locator('#panel').screenshot({ path: out('shot_emujoy_grid.png') });
    await setChk(p, 'gridShow', false);
    await p.close();
  }

  { const p = await ctx.newPage(); await p.goto(URL); await p.evaluate(() => { localStorage.removeItem('ahann_grid'); localStorage.removeItem('ahann_pad_square'); }); await p.close(); }
  console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
