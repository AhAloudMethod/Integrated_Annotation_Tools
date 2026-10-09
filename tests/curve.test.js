// 区間内で変化（カスタムの Excel で「区間内で変化」を使う。core/curve.js）：普通のセルは今までの Excel のまま。
// 選んだ区間だけ「この区間を変化にする」で変化の区間にし、値を連続の方式と同じ系列に持つ。セルは区間の始め→終わりと形を出すだけ。
// 変化にする・一定に戻す、グラフで描く（変化の区間の中だけ）、テンプレート、形の変更、発声なし、区切りでの切り分け、聴いてから入力、書き出し
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
    await p.evaluate(o => { Object.assign(AH.S.meta.options, { rep: 'excel', time: 'disc', values: 'int', curve: 'on', ...o }); AH.remount(); AH.refresh(); }, opts);
    await p.waitForTimeout(150);
    return p;
  };
  // グラフの座標：時刻 t・値 v（lane は v か a）の画面上の位置（core/timeline.js の geom と同じ計算。F0 の欄は出さない）
  const graph = async p => {
    const g = await p.evaluate(() => { const c = document.getElementById('tl'), r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: c.clientWidth, h: c.clientHeight, D: AH.S.meta.duration }; });
    const H2 = g.h - 28, lane = ax => (ax === 'v' ? { y0: 8, y1: H2 / 2 - 8 } : { y0: H2 / 2 + 8, y1: H2 - 8 });
    return (ax, t, v) => { const L = lane(ax); return [g.x + 44 + t / g.D * (g.w - 52), g.y + L.y1 - (v - 1) / 8 * (L.y1 - L.y0)]; };
  };
  // セルの表示（区間の順）：入力欄なら値、変化の区間なら「~」と表示の文字
  const cells = (p, ax) => p.evaluate(ax => [...Array(AH.nSec()).keys()].map(s => {
    const cv = document.querySelector(`table.xl td.cv[data-ax="${ax}"][data-s="${s}"]`), inp = document.querySelector(`table.xl input[data-ax="${ax}"][data-s="${s}"]`);
    return cv ? '~' + cv.textContent : inp ? inp.value : '?';
  }), ax);
  const drag = async (p, a, b, steps = 12) => { await p.mouse.move(...a); await p.mouse.down(); await p.mouse.move(...b, { steps }); await p.mouse.up(); await p.waitForTimeout(150); };
  const at = (p, t) => p.evaluate(t => AH.seekTo(t), t).then(() => p.waitForTimeout(120));
  const mark = async (p, t) => { await at(p, t); await p.click('.curveBox .mark'); await p.waitForTimeout(100); };

  // ---- 1. 普通のセルは今までの Excel。変化にした区間だけ表示だけのセルになり、グラフで描くのはその区間の中だけ
  {
    const p = await open();
    await p.click('input[data-ax=v][data-s="1"]'); await p.keyboard.type('6');
    await p.click('input[data-ax=v][data-s="3"]'); await p.keyboard.type('4');
    await p.evaluate(() => document.activeElement.blur());
    await mark(p, 1.5);
    const c1 = await cells(p, 'v');
    check('「なぞって評価する」で今の区間を変化の区間にし、最初はセルの値のまま一定の線（6。形の印なし）になる。ほかのセルは入力欄のまま', c1[1] === '~6' && c1[3] === '4' && c1[0] === '' && await p.evaluate(() => AH.valueAt('v', 1.5) === 6 && AH.S.data.cells.a[1] === 'curve'), JSON.stringify(c1));
    const g = await graph(p);
    await drag(p, g('v', 1.3, 8), g('v', 2.5, 2), 20);   // 変化の区間から普通の区間へまたいでなぞる
    const c2 = await cells(p, 'v');
    const v0 = await p.evaluate(() => [AH.S.data.cells.v[2] ?? null, AH.valueAt('v', 2.5)]);
    check('変化の区間からまたいでなぞると、変化の区間の中だけ描き（「描」）、普通の区間のセルと系列は変えない', /^~6→[45]描$/.test(c2[1]) && JSON.stringify(v0) === '[null,5]', JSON.stringify({ c2: c2.slice(0, 3), v0 }));
    await drag(p, g('v', 3.5, 8), g('v', 3.5, 8), 1);   // 普通の区間を押すと、今までどおりセルの値になる
    check('普通の区間をグラフで押すと、今までどおりそのセルの値を置く', (await cells(p, 'v'))[3] === '8');
    await p.keyboard.press('Control+z'); await p.keyboard.press('Control+z'); await p.waitForTimeout(100);
    check('描いた分も Ctrl+Z の 1 回ずつで戻る', (await cells(p, 'v'))[1] === '~6', JSON.stringify((await cells(p, 'v')).slice(0, 4)));
    await p.click('table.xl td.cv[data-ax=v][data-s="1"]'); await p.waitForTimeout(100);
    check('変化の区間のセルをクリックするとその区間の始めへ移る', await p.evaluate(() => AH.curSec() === 1));
    await p.click('input[data-ax=v][data-s="0"]'); await p.keyboard.press('Tab');
    check('Tab の移動は変化の区間のセルを飛ばす', await p.evaluate(() => document.activeElement.dataset.ax + document.activeElement.dataset.s) === 'v2');
    await p.keyboard.press('Escape'); await p.evaluate(() => document.activeElement.blur());
    await at(p, 1.5); await p.keyboard.press('Digit3'); await p.waitForTimeout(100);
    check('変化の区間では数字キーでセルの値にしない', (await cells(p, 'v'))[1] === '~6');
    // 一定に戻す：区間の平均を丸めた値の普通のセルに戻る
    await drag(p, g('v', 1.01, 2), g('v', 1.99, 2), 6);
    await at(p, 1.5); await p.click('.curveBox .mark'); await p.waitForTimeout(100);
    check('「なぞって評価する」をもう一度押すと区間の平均（2）を丸めた値の普通のセルに戻る', (await cells(p, 'v'))[1] === '2' && await p.evaluate(() => AH.S.data.cells.v[1] === 2), JSON.stringify((await cells(p, 'v')).slice(0, 3)));
    await p.close();
  }

  // ---- 2. 値が空の区間を変化にすると、入れていない区間（空欄）になる。テンプレート・形の変更・発声なし
  {
    const p = await open();
    await mark(p, 3.5);
    const e0 = (await cells(p, 'v'))[3];
    const tools = await p.$$eval('.curveBox .tool', bs => bs.map(b => b.textContent));
    await p.click('.curveBox .tool:text("テンプレート")');
    const g = await graph(p);
    await drag(p, g('v', 3.5, 7), g('v', 3.6, 3));
    const c1 = (await cells(p, 'v'))[3], m1 = await p.evaluate(() => AH.valueAt('v', 3.5));
    check('空の区間を変化にすると空欄のまま。テンプレートは押した高さ→離した高さの直線を入れる（両方のときは入れ方の切り替えを出す）', e0 === '~' && tools.join() === '描く,テンプレート' && /^~[67]→[34]直$/.test(c1) && m1 > 4.5 && m1 < 5.5, JSON.stringify({ e0, tools, c1, m1 }));
    await drag(p, g('v', 5.5, 7), g('v', 5.5, 3));
    check('テンプレートでも普通の区間を押すとセルの値になる', /^[34]$/.test((await cells(p, 'v'))[5]), (await cells(p, 'v'))[5]);
    await at(p, 3.2);
    await p.click('.curveBox .shape:text("前半で変化")');
    const c2 = (await cells(p, 'v'))[3], m2 = await p.evaluate(() => AH.valueAt('v', 3.5));
    check('形のボタンで今の区間を前半で変化にする（始めと終わりの値はそのまま）', c2 === c1.replace('直', '前') && m2 < m1 - 0.5, JSON.stringify({ c2, m1, m2 }));
    // 描くでは、テンプレートで入れた区間を変えない。描くときは形のボタンを光らせない
    await p.click('.curveBox .tool:text("描く")');
    const lit = await p.$$eval('.curveBox .shape.on', bs => bs.length);
    await drag(p, g('v', 3.2, 2), g('v', 3.8, 9));
    check('描くでは、テンプレートで入れた区間を変えず、形のボタンを光らせない', (await cells(p, 'v'))[3] === c2 && lit === 0, JSON.stringify({ c: (await cells(p, 'v'))[3], lit }));
    await at(p, 0.5); await p.click('.curveBox .shape:text("後半で変化")');
    const sw = await p.evaluate(() => ({ tool: AH.mode.curveTool(), lit: [...document.querySelectorAll('.curveBox .on')].map(b => b.textContent).join() }));
    check('描くのときに形のボタンを押すとテンプレートに切り替わり、その形が光る', sw.tool === 'template' && /テンプレート/.test(sw.lit) && /後半で変化/.test(sw.lit), JSON.stringify(sw));
    await p.click('.curveBox .tool:text("描く")');
    await p.click('.curveBox .novoice'); await p.waitForTimeout(100);
    const z = [(await cells(p, 'v'))[3], (await cells(p, 'a'))[3]];
    const zon = await p.$eval('.curveBox .novoice', b => b.classList.contains('on'));
    check('発声なしで変化の区間を両軸 0 にする（セルは 0、ボタンが光る）', z.join() === '~0,~0' && zon && await p.evaluate(() => AH.valueAt('v', 3.5) === 0 && AH.valueAt('a', 3.5) === 0), JSON.stringify(z));
    await p.click('.curveBox .novoice'); await p.waitForTimeout(100);
    check('発声なしをもう一度押すと空欄（普通のセル）に戻る', JSON.stringify([(await cells(p, 'v'))[3], (await cells(p, 'a'))[3]]) === '["",""]');
    // 普通のセルでも効く。対象は直前にクリックしたセルの区間（動画の位置は動かない）
    await at(p, 0.5);
    await p.click('input[data-ax=a][data-s="7"]');
    await p.click('.curveBox .novoice'); await p.waitForTimeout(100);
    const n7 = [(await cells(p, 'v'))[7], (await cells(p, 'a'))[7], (await cells(p, 'v'))[0]];
    await p.click('input[data-ax=v][data-s="7"]'); await p.click('.curveBox .novoice'); await p.waitForTimeout(100);
    const n7off = [(await cells(p, 'v'))[7], (await cells(p, 'a'))[7]];
    check('発声なしは普通のセルでも両軸 0 にし（対象は直前にクリックしたセルの区間）、もう一度で空欄に戻る', n7.join() === '0,0,' && n7off.join() === ',', JSON.stringify({ n7, n7off }));
    // なぞって評価するボタンも、直前にクリックしたセルの区間が対象
    await p.click('input[data-ax=v][data-s="9"]'); await p.keyboard.type('4'); await p.click('.curveBox .mark'); await p.waitForTimeout(100);
    check('なぞって評価するの対象も、直前にクリックしたセルの区間', (await cells(p, 'v'))[9] === '~4' && await p.$eval('.curveBox .mark', b => b.classList.contains('on')));
    await p.close();
  }

  // ---- 3. 区切り：変化の区間の途中に区切りを置くと、両方とも変化の区間のまま曲線を切り分ける（直線の半分は直線、前半で変化の半分は「描」）
  {
    const p = await open({ curveInput: 'template' });
    await mark(p, 2.5); await mark(p, 6.5);
    const g = await graph(p);
    await at(p, 0.5); await p.click('.curveBox .shape:text("前半で変化")');
    await drag(p, g('v', 2.5, 2), g('v', 2.5, 8));
    await at(p, 0.5); await p.click('.curveBox .shape:text("直線")');
    await drag(p, g('v', 6.5, 2), g('v', 6.5, 8));
    await p.evaluate(() => { AH._.addCut(2.5); AH._.addCut(6.5); }); await p.waitForTimeout(150);
    const c = await cells(p, 'v');
    check('変化の区間の途中で区切ると両方とも変化の区間で、直線の半分は直線、前半で変化の半分は「描」', /^~2→[67]描$/.test(c[2]) && /^~[67]→8描$/.test(c[3]) && /^~2→[45]直$/.test(c[7]) && /^~[45]→8直$/.test(c[8]), JSON.stringify(c));
    await p.close();
  }

  // ---- 4. 入れ方の設定：描くだけなら切り替えを出さない。区間内で変化を使わなければ今までの Excel
  {
    const p = await open({ curveInput: 'draw' });
    const d = await p.evaluate(() => ({ tools: document.querySelectorAll('.curveBox .tool').length, tool: AH.mode.curveTool() }));
    await p.close();
    const q = await open({ curve: 'off' });
    const off = await q.evaluate(() => ({ box: !!document.querySelector('.curveBox'), curve: AH.mode.curve, sels: [...document.querySelectorAll('.cfgGrid > span')].map(x => x.textContent).join() }));
    check('描くだけでは切り替えを出さない。使わないなら区間内で変化の欄を出さず、設定の欄には「区間内で変化」だけ出る', d.tools === 0 && d.tool === 'draw' && !off.box && !off.curve && /区間内で変化/.test(off.sels) && !/入れ方/.test(off.sels), JSON.stringify({ d, off }));
    await q.close();
  }

  // ---- 5. 聴いてから入力：区間の終わりで止まり、変化の区間ならグラフで入れて Enter で次の区間を聴く
  {
    const p = await open({ curveInput: 'template' });
    await p.evaluate(() => { AH._.setListen(true); AH._.setRange({ start: 0, bin: 1, count: 12, target: 12, edges: null }); });
    await mark(p, 0.5); await at(p, 0); await p.evaluate(() => document.activeElement.blur());
    await p.keyboard.press('Space');
    const stop0 = await p.waitForFunction(() => AH.video.paused && AH.video.currentTime > 0.9, null, { timeout: 5000 }).then(() => true).catch(() => false);
    const g = await graph(p);
    await drag(p, g('v', 0.5, 3), g('v', 0.5, 7));
    await p.keyboard.press('Enter');
    const stop1 = await p.waitForFunction(() => AH.video.paused && AH.curSec() === 1 && AH.video.currentTime > 1.9, null, { timeout: 5000 }).then(() => true).catch(() => false);
    const r = await p.evaluate(() => ({ c: AH.curveInfo('v', 0), next: AH.S.log.some(l => l.type === 'listen_next') }));
    check('聴いてから入力：区間の終わりで止まり、変化の区間にグラフで入れて Enter で次の区間を聴く', stop0 && stop1 && r.c.entered && r.c.from === 3 && r.c.to === 7 && r.next, JSON.stringify({ stop0, stop1, r }));
    await p.evaluate(() => AH._.setListen(false));
    await p.close();
  }

  // ---- 6. 書き出し：_bins.csv は軸ごとに from・to・mean・shape。普通のセルは const、変化の区間は系列から、発声なしは 4 列とも 0
  {
    const p = await open({ curveInput: 'template' });
    await p.evaluate(() => {
      AH._.setRange({ start: 0, bin: 1, count: 4, target: 4, edges: null });
      AH.setCells(0, { v: 7, a: 3 });
      AH._.curveMark(1, ['v', 'a']); AH._.curveDown('v', 1.5, 2); AH._.curveMove(8); AH._.curveUp();   // 区間 1：快度 2→8 の直線、覚醒度は空
      AH._.curveMark(2, ['v', 'a']); AH._.curveNoVoice(2, ['v', 'a']);                                    // 区間 2：発声なし
    });
    const f = await p.evaluate(() => Object.fromEntries(AH._.buildFiles().map(x => [x.name.replace(/^.*?_custom/, ''), x.text])));
    const bins = f['_bins.csv'].trim().split(String.fromCharCode(10)).map(r => r.split(','));
    const hz = f['_60hz.csv'].trim().split(String.fromCharCode(10)).map(r => r.split(','));
    check('_bins.csv：軸ごとに from・to・mean・shape（普通のセルは const、直線 2→8 の平均は 5、入れていない区間は空欄、発声なしは 0）',
      bins[0].join() === 'bin,label,t_start,t_end,valence_from,valence_to,valence_mean,valence_shape,arousal_from,arousal_to,arousal_mean,arousal_shape'
      && bins[1].slice(4).join() === '7,7,7.000,const,3,3,3.000,const' && bins[2].slice(4).join() === '2,8,5.000,line,5,5,5.000,' && bins[3].slice(4).join() === '0,0,0,0,0,0,0,0' && bins[4].slice(4).join() === ',,,,,,,', JSON.stringify(bins));
    check('_60hz.csv：普通のセルはその値、変化の区間は系列の値、入れていない区間と評価区間の外は空欄', hz[31].slice(2).join() === '7,3' && hz[61][2] === '2' && hz[61][3] === '' && hz[211].slice(2).join() === ',' && hz[301].slice(2).join() === ',', JSON.stringify([hz[31], hz[61], hz[211], hz[301]]));
    await p.close();
  }

  console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
