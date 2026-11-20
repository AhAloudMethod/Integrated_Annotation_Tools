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

  console.log('errors:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
