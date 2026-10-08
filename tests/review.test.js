// 見返し（core/review.js）：止まらずに再生して記録済みの値を追い、値は変えない
const { chromium } = require('playwright-core');
const { URL, VID, BROWSER } = require('./_env');
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
  const open = async (mode, listen = false) => {
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss());
    await p.goto(URL); await p.evaluate(l => localStorage.setItem('ahann_listen', l ? '1' : '0'), listen); await p.reload();
    await p.selectOption('#mode', mode); await p.setInputFiles('#file', VID);
    await p.waitForFunction(() => AH.S.meta.duration > 0); await p.evaluate(() => document.activeElement && document.activeElement.blur());
    // 記録済みの値：1秒から 8・2、3秒から 3・7
    await p.evaluate(() => { for (const [t, v, a] of [[1, 8, 2], [3, 3, 7]]) { AH.placePoint('v', t, v); AH.placePoint('a', t, a); } AH.refresh(); });
    return p;
  };
  const pts = p => p.evaluate(() => JSON.stringify(AH.S.data.points) + '|' + AH.S.data.strokes.length);
  const nowTxt = p => p.evaluate(() => [...document.querySelectorAll('.nowRow b')].map(b => b.textContent).join('/'));
  const at = (p, t) => p.evaluate(t => { AH.seekTo(t); }, t).then(() => p.waitForTimeout(150));

  // ---- 聴いてから入力の中でも、見返しなら止まらずに再生する
  {
    const p = await open('emujoy', true);
    await p.keyboard.press('KeyV'); await p.waitForTimeout(100);
    const ui = await p.evaluate(() => ({ btn: document.getElementById('reviewBtn').textContent, listen: !document.getElementById('listenBox').hidden, body: document.body.classList.contains('review') }));
    check('V で見返しになり、ボタンが「見返し中」・聴いてから入力の案内は消える', ui.btn === '見返し中' && !ui.listen && ui.body, JSON.stringify(ui));
    const before = await pts(p);
    await p.keyboard.press('Space'); await p.waitForTimeout(1500);
    const r = await p.evaluate(() => ({ t: AH.video.currentTime, playing: !AH.video.paused }));
    const shown = await nowTxt(p);
    check('区間の終わりで止まらずに再生し、画面は記録済みの値（8・2）を映す', r.playing && r.t > 1.1 && shown === '8.00/2.00', JSON.stringify(r) + ' ' + shown);
    // 平面を押しても書き込まれない（入力面は操作できない）
    const b = await p.locator('canvas.plane').boundingBox();
    await p.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.2); await p.mouse.down(); await p.waitForTimeout(300); await p.mouse.up();
    await p.keyboard.press('Space');
    check('見返しの間は平面を押しても書き込まれない', (await pts(p)) === before);
    await p.keyboard.press('KeyV'); await p.waitForTimeout(100);
    const off = await p.evaluate(() => ({ btn: document.getElementById('reviewBtn').textContent, listen: !document.getElementById('listenBox').hidden, log: AH.S.log.filter(l => l.type === 'review').map(l => l.value).join(',') }));
    check('もう一度 V で戻る（聴いてから入力の案内も戻る・操作ログ review）', off.btn === '見返し' && off.listen && off.log === 'on,off', JSON.stringify(off));
    await p.close();
  }

  // ---- スロットル：キーを押しても動かず、記録済みの値を追う
  {
    const p = await open('throttle');
    await p.click('#reviewBtn');
    const before = await pts(p);
    await at(p, 3.5);
    await p.keyboard.down('KeyW'); await p.waitForTimeout(300); await p.keyboard.up('KeyW');
    await p.keyboard.press('KeyR'); await p.keyboard.press('Space'); await p.waitForTimeout(400); await p.keyboard.press('Space');
    const peek = await p.evaluate(() => ({ ...AH.mode.peek(), armed: AH.S.armed }));
    check('スロットル：見返しではキーでレバーが動かず、記録オンにもならず、記録済みの値（3・7）を追う', peek.v === 3 && peek.a === 7 && !peek.armed && (await pts(p)) === before, JSON.stringify(peek));
    await p.close();
  }

  // ---- DARMA：スティックを倒しても値は変わらず、ボタン0は再生／停止
  {
    const p = await open('darma');
    await p.evaluate(id => window.__connect(id, 0), JOY); await p.waitForTimeout(150);
    await p.click('#reviewBtn'); await at(p, 1.5);
    await p.evaluate(() => { window.__pads[0].axes[0] = 1; window.__pads[0].axes[1] = 1; }); await p.waitForTimeout(150);
    const btn = async () => { await p.evaluate(() => { window.__pads[0].buttons[0].pressed = true; }); await p.waitForTimeout(100); await p.evaluate(() => { window.__pads[0].buttons[0].pressed = false; }); await p.waitForTimeout(100); };
    const before = await pts(p);
    await btn(); const playing = await p.evaluate(() => !AH.video.paused);
    await p.waitForTimeout(300); await btn();
    const r = await p.evaluate(() => ({ paused: AH.video.paused, armed: AH.S.armed }));
    check('DARMA：見返しではボタン0で再生／停止し、スティックを倒しても書き込まれない', playing && r.paused && !r.armed && (await pts(p)) === before, JSON.stringify(r));
    await p.close();
  }

  // ---- SAM（区間の方式）：見返しの間は絵を押しても値が入らない。グラフの編集もしない
  {
    const p = await open('sam');
    await p.click('#reviewBtn');
    await p.evaluate(() => document.querySelector('.samRow.v button[data-v="9"]').click()); await p.waitForTimeout(100);
    const cells = await p.evaluate(() => JSON.stringify(AH.S.data.cells));
    check('SAM：見返しの間は値が入らない', cells === '{"v":[],"a":[]}', cells);
    await p.close();
  }

  // ---- Excel：見返しの間は画面の色が変わり、セルに打てない（入れている途中のセルからもフォーカスを外す）
  {
    const p = await open('excel');
    await p.click('input[data-ax=v][data-s="0"]'); await p.keyboard.type('6');
    await p.click('input[data-ax=v][data-s="1"]');
    await p.evaluate(() => AH._.setReview(true)); await p.waitForTimeout(100);
    await p.keyboard.type('7');
    await p.evaluate(() => document.querySelector('input[data-ax=v][data-s="2"]').focus()); await p.keyboard.type('8');
    const rv = await p.evaluate(() => ({ cells: [0, 1, 2].map(s => AH.S.data.cells.v[s] ?? null), ro: document.querySelector('input[data-ax=v][data-s="2"]').readOnly,
      shadow: getComputedStyle(document.querySelector('main')).boxShadow, tag: getComputedStyle(document.querySelector('main'), '::before').content }));
    check('Excel：見返しの間は画面の枠と札が出て、セルに打てない', JSON.stringify(rv.cells) === '[6,null,null]' && rv.ro && rv.shadow !== 'none' && /見返し中/.test(rv.tag), JSON.stringify(rv));
    await p.evaluate(() => AH._.setReview(false)); await p.waitForTimeout(100);
    const back = await p.evaluate(() => ({ ro: document.querySelector('input[data-ax=v][data-s="2"]').readOnly, shadow: getComputedStyle(document.querySelector('main')).boxShadow }));
    check('Excel：見返しを終えるとセルに打てて、枠も消える', !back.ro && back.shadow === 'none', JSON.stringify(back));
    await p.close();
  }

  { const p = await ctx.newPage(); await p.goto(URL); await p.evaluate(() => localStorage.removeItem('ahann_listen')); await p.close(); }
  console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
