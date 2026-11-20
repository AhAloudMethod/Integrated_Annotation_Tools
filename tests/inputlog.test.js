// 入力の過程の操作ログ（実験2 の行動指標：入力の間隔・修正回数・入力にかかった時間）：
// セルの直す前の値（prev=）、セルから離れた時刻（cell_blur）
const { chromium } = require('playwright-core');
const { URL, VID, BROWSER } = require('./_env');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const errs = [];
  const open = async (opts = {}) => {
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss());
    await p.goto(URL); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('ahann_tl', '1'); localStorage.setItem('ahann_f0', '0'); }); await p.reload();
    await p.selectOption('#mode', 'custom');
    await p.setInputFiles('#file', VID); await p.waitForFunction(() => AH.S.meta.duration > 0); await p.waitForTimeout(150);
    await p.evaluate(o => { Object.assign(AH.S.meta.options, { rep: 'excel', time: 'disc', values: 'int', curve: 'off', ...o }); AH.remount(); AH.refresh(); }, opts);
    await p.waitForTimeout(150);
    return p;
  };
  const logs = (p, type) => p.evaluate(t => AH.S.log.filter(e => e.type === t), type);
  const typeIn = async (p, ax, s, key) => { await p.click(`input[data-ax=${ax}][data-s="${s}"]`); await p.keyboard.press(key); await p.waitForTimeout(80); };

  // ---- 1. セルの直す前の値
  {
    const p = await open();
    await typeIn(p, 'v', 1, 'Digit6');
    await typeIn(p, 'v', 1, 'Digit4');
    const inp = await logs(p, 'cell_input');
    check('cell_input の detail の末尾に直す前の値（空欄は -）を足す', inp.length === 2 && /^bin 1 \(.*\) prev=-$/.test(inp[0].detail) && /^bin 1 \(.*\) prev=6$/.test(inp[1].detail), JSON.stringify(inp.map(e => e.detail)));
    await p.click('input[data-ax=v][data-s="1"]'); await p.keyboard.press('Backspace'); await p.waitForTimeout(80);
    const clr = await logs(p, 'cell_clear');
    check('cell_clear の detail の末尾に直す前の値を足す', clr.length === 1 && /prev=4$/.test(clr[0].detail), JSON.stringify(clr.map(e => e.detail)));
    await typeIn(p, 'v', 2, 'Digit5');
    await typeIn(p, 'a', 2, 'Digit3');
    await typeIn(p, 'v', 2, 'Digit0');   // 発声なし：2 軸とも 0（setCells）
    const last = (await logs(p, 'cell_input')).pop();
    check('2 軸まとめて変えたときは直す前の値を軸の順に / で区切る', last.axis === 'va' && last.value === '0/0' && /prev=5\/3$/.test(last.detail), JSON.stringify(last));
    await p.close();
  }

  // ---- 2. セルから離れた時刻
  {
    const p = await open();
    await p.click('input[data-ax=a][data-s="3"]'); await p.keyboard.press('Escape'); await p.waitForTimeout(80);
    const bl = await logs(p, 'cell_blur');
    check('セルから離れると cell_blur を残す（軸と区間）', bl.length === 1 && bl[0].axis === 'a' && bl[0].detail === 'bin 3', JSON.stringify(bl));
    await p.close();
  }

  // グラフの座標：時刻 t・値 v（lane は v か a）の画面上の位置（tests/curve.test.js と同じ計算）
  const graph = async p => {
    const g = await p.evaluate(() => { const c = document.getElementById('tl'), r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: c.clientWidth, h: c.clientHeight, D: AH.S.meta.duration }; });
    const H2 = g.h - 28, lane = ax => (ax === 'v' ? { y0: 8, y1: H2 / 2 - 8 } : { y0: H2 / 2 + 8, y1: H2 - 8 });
    const at = (ax, t, v) => { const L = lane(ax); return [g.x + 44 + t / g.D * (g.w - 52), g.y + L.y1 - (v - 1) / 8 * (L.y1 - L.y0)]; };
    at.ruler = t => [g.x + 44 + t / g.D * (g.w - 52), g.y + g.h - 10];
    return at;
  };
  const drag = async (p, a, b, steps = 12, button = 'left') => { await p.mouse.move(...a); await p.mouse.down({ button }); await p.mouse.move(...b, { steps }); await p.mouse.up({ button }); await p.waitForTimeout(150); };

  // ---- 3. グラフを押した時刻と、クリックで入れた値・直す前の値
  {
    const p = await open();
    await typeIn(p, 'v', 2, 'Digit3');
    await p.evaluate(() => document.activeElement.blur());
    const g = await graph(p);
    await drag(p, g('v', 2.5, 8), g('v', 3.5, 8));
    const dn = await logs(p, 'graph_down'), gc = await logs(p, 'graph_cells');
    check('グラフで値を入れるために押すと graph_down を 1 回残し（軸と押した位置の時刻）、graph_cells より前', dn.length === 1 && dn[0].axis === 'v' && /^t=2\.\d{4}$/.test(dn[0].detail) && gc.length === 1 && dn[0].wall_ms <= gc[0].wall_ms, JSON.stringify({ dn, gc }));
    check('graph_cells の value に区間の順の新しい値、detail の末尾に直す前の値を足す', gc[0].value === '8 8' && gc[0].detail === 'bins 2 3 prev 3 -', JSON.stringify(gc[0]));
    await drag(p, g.ruler(1), g.ruler(1), 1);
    await drag(p, g('v', 4.2, 5), g('v', 4.2, 5), 1, 'right');
    check('目盛りの欄のシークと右クリックの区切りでは graph_down を残さない', (await logs(p, 'graph_down')).length === 1, JSON.stringify(await logs(p, 'graph_down')));
    await p.close();
  }

  // ---- 4. 書き込み（strokes）の書き始めの時刻
  {
    const p = await open({ curve: 'on' });
    await p.evaluate(() => AH.seekTo(1.5)); await p.waitForTimeout(120);
    await p.click('.curveBox .mark'); await p.waitForTimeout(100);
    const g = await graph(p);
    await drag(p, g('v', 1.2, 8), g('v', 1.8, 2));
    const st = await p.evaluate(() => AH.S.data.strokes.slice(-1)[0]);
    check('変化の区間をなぞった書き込みに wall_ms_start を足す（wall_ms_end 以下）', st && typeof st.wall_ms_start === 'number' && st.wall_ms_start <= st.wall_ms_end, JSON.stringify(st && { s: st.wall_ms_start, e: st.wall_ms_end, src: st.source }));
    check('変化の区間を押しても graph_down は 1 回', (await logs(p, 'graph_down')).length === 1, JSON.stringify(await logs(p, 'graph_down')));
    await p.close();
  }
  {
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss());
    await p.goto(URL); await p.evaluate(() => localStorage.clear()); await p.reload();
    await p.selectOption('#mode', 'emujoy');
    await p.setInputFiles('#file', VID); await p.waitForFunction(() => AH.S.meta.duration > 0); await p.waitForTimeout(150);
    const st = await p.evaluate(async () => { AH._.startStroke(0.5); await new Promise(r => setTimeout(r, 60)); AH._.endStroke('test'); return AH.S.data.strokes.slice(-1)[0]; });
    check('連続の方式の書き込みに wall_ms_start を足す（wall_ms_end 以下）', st && typeof st.wall_ms_start === 'number' && st.wall_ms_start <= st.wall_ms_end, JSON.stringify(st && { s: st.wall_ms_start, e: st.wall_ms_end }));
    await p.close();
  }

  console.log('errors:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
