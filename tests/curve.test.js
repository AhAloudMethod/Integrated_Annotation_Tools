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

  // ---- 2. テンプレート：区間の中で始めの高さから終わりの高さへドラッグすると、選んだ形の曲線が入る。形のボタンで形を変える
  {
    const p = await open();
    const tools = await p.$$eval('.curveBox .tool', bs => bs.map(b => b.textContent));
    await p.click('.curveBox .tool:text("テンプレート")');
    const at = await graph(p);
    await drag(p, at('v', 3.5, 7), at('v', 3.6, 3));
    const mid = () => p.evaluate(() => AH.valueAt('v', 3.5));
    const c1 = (await cells(p, 'v'))[3], m1 = await mid();
    const sh1 = await p.evaluate(() => JSON.stringify(AH.S.data.shapes) + '|' + AH.S.data.strokes.map(s => s.source + ':' + s.shape).join());
    check('両方のときは入れ方の切り替えを出し、テンプレートは押した高さ→離した高さの直線を区間に入れる', tools.join() === '描く,テンプレート' && /^[67]→[34]直$/.test(c1) && m1 > 4.5 && m1 < 5.5 && /"shape":"line"/.test(sh1) && /template:line/.test(sh1), JSON.stringify({ tools, c1, m1, sh1 }));
    await p.evaluate(() => AH.seekTo(3.2)); await p.waitForTimeout(100);
    await p.click('.curveBox .shape:text("前半で変化")');
    const c2 = (await cells(p, 'v'))[3], m2 = await mid();
    check('形のボタンで今の区間を前半で変化にする（始めと終わりの値はそのまま）', c2 === c1.replace('直', '前') && m2 < m1 - 0.5, JSON.stringify({ c2, m1, m2 }));
    await p.keyboard.press('Control+z'); await p.waitForTimeout(100);
    check('形の変更は Ctrl+Z の 1 回で戻る', (await cells(p, 'v'))[3] === c1 && Math.abs((await mid()) - m1) < 1e-9);
    await p.keyboard.press('Control+z'); await p.waitForTimeout(100);
    check('テンプレートの入力も Ctrl+Z の 1 回で戻る', (await cells(p, 'v'))[3] === '' && (await mid()) === 5);
    // 後半で変化を選んでから入れる。自由に描き直すと、重なった区間は「描」になる
    await p.click('.curveBox .shape:text("後半で変化")');
    await drag(p, at('v', 6.5, 3), at('v', 6.5, 8));
    const c3 = (await cells(p, 'v'))[6], m3 = await p.evaluate(() => AH.valueAt('v', 6.5));
    await p.click('.curveBox .tool:text("描く")');
    await drag(p, at('v', 6.4, 5), at('v', 6.6, 6), 4);
    const c4 = (await cells(p, 'v'))[6];
    check('後半で変化の曲線が入り、その区間を自由に描き直すと「描」になる', /^3→8後$/.test(c3) && m3 < 5 && /描$/.test(c4), JSON.stringify({ c3, m3, c4 }));
    await p.close();
  }
  // ---- 3. 入れ方の設定：テンプレートだけなら切り替えを出さず、ドラッグはテンプレート。描くだけならドラッグは描く
  {
    const p = await open({ curveInput: 'template' });
    const at = await graph(p);
    const t1 = await p.$$eval('.curveBox .tool', bs => bs.length);
    await drag(p, at('a', 2.5, 2), at('a', 2.5, 8));
    const ca = (await cells(p, 'a'))[2];
    await p.close();
    const q = await open({ curveInput: 'draw' });
    const at2 = await graph(q);
    await drag(q, at2('a', 2.2, 2), at2('a', 2.8, 8));
    const cb = (await cells(q, 'a'))[2];
    check('テンプレートだけ／描くだけでは切り替えを出さず、ドラッグはその入れ方になる', t1 === 0 && /^2→8直$/.test(ca) && /描$/.test(cb) && (await q.$$eval('.curveBox .tool', bs => bs.length)) === 0, JSON.stringify({ t1, ca, cb }));
    await q.close();
  }

  // ---- 4. 発声なし：今の区間を両軸 0 にし、セルは 0、形のボタンでは変わらない。Ctrl+Z の 1 回で戻る
  {
    const p = await open();
    await p.evaluate(() => AH.seekTo(4.5)); await p.waitForTimeout(100);
    await p.click('.curveBox .novoice');
    const z = await p.evaluate(() => ({ v: AH.valueAt('v', 4.5), a: AH.valueAt('a', 4.99), b: AH.valueAt('v', 5.0), log: AH.S.log.some(l => l.type === 'curve_novoice') }));
    const cz = [(await cells(p, 'v'))[4], (await cells(p, 'a'))[4]];
    await p.click('.curveBox .shape:text("直線")');
    const cz2 = (await cells(p, 'v'))[4];
    await p.keyboard.press('Control+z'); await p.waitForTimeout(100);
    const back = await p.evaluate(() => AH.valueAt('v', 4.5));
    check('発声なしは今の区間を両軸 0 にしてセルに 0 を出し、形のボタンでは変わらず、Ctrl+Z で戻る', z.v === 0 && z.a === 0 && z.b === 5 && z.log && cz.join() === '0,0' && cz2 === '0' && back === 5, JSON.stringify({ z, cz, cz2, back }));
    await p.close();
  }

  // ---- 5. 区切り：曲線の途中に区切りを置くと切り分ける。直線の半分は直線のまま、前半で変化の半分は「描」。Ctrl+Z で戻る
  {
    const p = await open();
    await p.click('.curveBox .tool:text("テンプレート")');
    const at = await graph(p);
    await drag(p, at('v', 2.5, 2), at('v', 2.5, 8));
    await p.evaluate(() => AH.seekTo(2.5)); await p.waitForTimeout(100);
    await p.click('.curveBox .shape:text("前半で変化")');   // 区間 2 を前半で変化に
    await p.evaluate(() => AH.seekTo(0.5)); await p.waitForTimeout(100);
    await p.click('.curveBox .shape:text("直線")');   // 入れていない区間で押すと、次に入れる形だけが変わる
    await drag(p, at('v', 6.5, 2), at('v', 6.5, 8));
    await p.evaluate(() => { AH._.addCut(2.5); AH._.addCut(6.5); }); await p.waitForTimeout(150);   // 区間 2 と 6 の真ん中
    const c = await cells(p, 'v');
    check('曲線の途中で区切ると切り分け、直線の半分は直線、前半で変化の半分は「描」になる', /^2→[67]描$/.test(c[2]) && /^[67]→8描$/.test(c[3]) && /^2→[45]直$/.test(c[7]) && /^[45]→8直$/.test(c[8]), JSON.stringify(c));
    await p.keyboard.press('Control+z'); await p.keyboard.press('Control+z'); await p.waitForTimeout(150);
    const c2 = await cells(p, 'v');
    check('区切りを Ctrl+Z で戻すと形の記録も戻る', /前$/.test(c2[2]) && /^2→8直$/.test(c2[6]), JSON.stringify(c2));
    await p.close();
  }

  console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
