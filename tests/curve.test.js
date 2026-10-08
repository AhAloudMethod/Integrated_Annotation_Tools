// 区間内で変化（カスタムの Excel で値を「区間内で変化」。core/curve.js）：値は連続の方式と同じ系列に持ち、
// 表のセルは区間の始め→終わりと形を出すだけ。グラフで描く・テンプレート・形の変更・発声なし・区切りでの切り分け・書き出し
const { chromium } = require('playwright-core');
const { URL, VID, BROWSER } = require('./_env');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true });
  const errs = [];
  const open = async (opts = {}) => {
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss());
    await p.goto(URL); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('ahann_tl', '1'); }); await p.reload();
    await p.selectOption('#mode', 'custom');
    await p.setInputFiles('#file', VID); await p.waitForFunction(() => AH.S.meta.duration > 0); await p.waitForTimeout(150);
    await p.evaluate(o => { Object.assign(AH.S.meta.options, { rep: 'excel', values: 'curve', ...o }); AH.remount(); AH.refresh(); }, opts);
    await p.waitForTimeout(150);
    return p;
  };
  // グラフの座標：時刻 t・値 v（lane は v か a）の画面上の位置（core/timeline.js の geom と同じ計算）
  const graph = async p => {
    const g = await p.evaluate(() => { const c = document.getElementById('tl'), r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: c.clientWidth, h: c.clientHeight, D: AH.S.meta.duration, f0: !!document.body.classList.contains('f0') }; });
    const H2 = g.h - 28 - (g.f0 ? 56 : 0);
    const lane = ax => (ax === 'v' ? { y0: 8, y1: H2 / 2 - 8 } : { y0: H2 / 2 + 8, y1: H2 - 8 });
    return (ax, t, v) => { const L = lane(ax); return [g.x + 44 + t / g.D * (g.w - 52), g.y + L.y1 - (v - 1) / 8 * (L.y1 - L.y0)]; };
  };
  const cells = (p, ax) => p.evaluate(ax => [...document.querySelectorAll(`table.xl.curve td[data-ax=${ax}]`)].map(td => td.textContent), ax);
  const drag = async (p, a, b, steps = 12) => { await p.mouse.move(...a); await p.mouse.down(); await p.mouse.move(...b, { steps }); await p.mouse.up(); await p.waitForTimeout(150); };

  // ---- 1. 土台：系列のモデル、表は表示だけ、グラフで描くと区間の始め→終わりと「描」を出す
  {
    const p = await open();
    const st = await p.evaluate(() => ({ model: AH.mode.model, inputs: document.querySelectorAll('table.xl.curve input').length, cols: document.querySelectorAll('table.xl.curve td[data-ax=v]').length, wm: AH.mode.writeMode() }));
    check('区間内で変化：系列のモデルで、表のセルは表示だけ（入力欄が無い）、書き込みは記録オン・押している間ではない', st.model === 'series' && st.inputs === 0 && st.cols === 12 && st.wm === null, JSON.stringify(st));
    await p.evaluate(() => { document.getElementById('graphEdit').checked = false; });   // グラフの編集の設定をオフにしても描ける
    const at = await graph(p);
    await drag(p, at('v', 1.005, 8), at('v', 1.99, 3));   // 区間 1（1〜2 秒）の始めから終わりまで
    const c = await cells(p, 'v');
    const src = await p.evaluate(() => AH.S.data.strokes.map(s => s.source).join());
    check('グラフをなぞると系列を描き、区間のセルに始め→終わりと「描」を出す（設定のグラフ編集がオフでも描ける）', /^[78]→[34]描$/.test(c[1]) && c[0] === '' && src === 'graph', JSON.stringify({ c: c.slice(0, 3), src }));
    await p.click('table.xl.curve td[data-ax=v][data-s="5"]'); await p.waitForTimeout(150);
    check('セルをクリックするとその区間の始めへ移る', await p.evaluate(() => AH.curSec() === 5 && Math.abs(AH.video.currentTime - 5.001) < 0.01));
    await p.keyboard.press('Digit7'); await p.waitForTimeout(100);
    check('数字キーでは何も入らない', (await cells(p, 'v'))[5] === '');
    await p.close();
  }

  console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
