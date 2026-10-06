// 記録オフのレバー・スライダー：再生中でも動かせる（記録済みの値に引き戻されない）。シークすると記録済みの値に追従する
const { chromium } = require('playwright-core');
const { URL, VID, BROWSER } = require('./_env');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const errs = [];
  const open = async mode => {
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss());
    await p.goto(URL); await p.selectOption('#mode', mode); await p.setInputFiles('#file', VID);
    await p.waitForFunction(() => AH.S.meta.duration > 0); await p.evaluate(() => document.activeElement && document.activeElement.blur());
    return p;
  };
  const peek = p => p.evaluate(() => AH.mode.peek());

  // スロットル：記録オフのまま再生中に W を押すとレバーが上がり、離してもその位置に留まる
  {
    const p = await open('throttle');
    await p.keyboard.press('Space'); await p.waitForTimeout(200);
    await p.keyboard.down('KeyW'); await p.waitForTimeout(500); await p.keyboard.up('KeyW');
    const moved = await peek(p);
    await p.waitForTimeout(400);
    const stay = await peek(p);
    await p.keyboard.press('Space');
    const pts = await p.evaluate(() => AH.S.data.points.v.length);
    check('再生中・記録オフでもレバーが動く', moved.v > 6, JSON.stringify(moved));
    check('再生中・記録オフで離した位置に留まる', Math.abs(stay.v - moved.v) < 0.05, JSON.stringify(stay));
    check('記録オフの操作は記録されない', pts === 1, 'points=' + pts);
    // シークすると記録済みの値（何も書いていないので 5）に追従する
    await p.evaluate(() => AH.seekTo(8)); await p.waitForTimeout(300);
    const after = await peek(p);
    check('シークすると記録済みの値に追従する', after.v === 5, JSON.stringify(after));
    // 記録オンで再生中に動かすと記録される
    await p.keyboard.press('KeyR'); await p.keyboard.press('Space');
    await p.keyboard.down('KeyW'); await p.waitForTimeout(400); await p.keyboard.up('KeyW'); await p.waitForTimeout(200);
    await p.keyboard.press('Space'); await p.keyboard.press('KeyR');
    const rec = await p.evaluate(() => AH.valueAt('v', AH.video.currentTime - 0.05));
    check('記録オンでは再生中の操作が記録される', rec > 6, 'value=' + rec);
    await p.close();
  }

  // CARMA・RankTrace も再生中・記録オフで動かせる
  {
    const p = await open('carma');
    await p.keyboard.press('Space'); await p.waitForTimeout(200);
    await p.keyboard.down('ArrowUp'); await p.waitForTimeout(400); await p.keyboard.up('ArrowUp'); await p.waitForTimeout(300);
    const c = await peek(p); await p.keyboard.press('Space');
    check('CARMA：再生中・記録オフでも動いて留まる', c.v > 6, JSON.stringify(c));
    await p.close();
  }
  {
    const p = await open('ranktrace');
    await p.keyboard.press('Space'); await p.waitForTimeout(200);
    const b = await p.locator('canvas.trace').boundingBox(); await p.mouse.move(b.x + 60, b.y + 60);
    for (let i = 0; i < 3; i++) { await p.mouse.wheel(0, -100); await p.waitForTimeout(80); }
    await p.waitForTimeout(300); const r = await peek(p); await p.keyboard.press('Space');
    check('RankTrace：再生中・記録オフでも動いて留まる', r.v === 1.5, JSON.stringify(r));
    await p.close();
  }
  // カスタム（スライダー×キーボード）
  {
    const p = await open('custom');
    await p.locator('select[aria-label=インタフェース]').selectOption('sliders'); await p.locator('select[aria-label=入力]').selectOption('keyboard');
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    await p.keyboard.press('Space'); await p.waitForTimeout(200);
    await p.keyboard.down('KeyW'); await p.waitForTimeout(400); await p.keyboard.up('KeyW'); await p.waitForTimeout(300);
    const c = await peek(p); await p.keyboard.press('Space');
    check('カスタム（スライダー×キーボード）：再生中・記録オフでも動いて留まる', c.v > 6, JSON.stringify(c));
    await p.close();
  }

  // 選択欄にフォーカスが残っていても、キーで再生速度・方式が変わらない（キーはツールの操作になる）
  {
    const p = await open('ranktrace');
    await p.click('#setBtn'); await p.focus('#rate');
    const v0 = (await peek(p)).v;
    await p.keyboard.down('ArrowUp'); await p.waitForTimeout(300); await p.keyboard.up('ArrowUp');
    const r = await p.evaluate(() => ({ rate: AH.video.playbackRate, sel: document.getElementById('rate').value, focus: document.activeElement.id, v: AH.mode.peek().v }));
    check('再生速度の欄にフォーカスがあっても ↑ で速度は変わらず、RankTrace の入力になる', r.rate === 1 && r.sel === '1' && r.focus !== 'rate' && r.v > v0, JSON.stringify(r));
    await p.focus('#mode'); await p.keyboard.press('KeyW'); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(100);
    const m = await p.evaluate(() => ({ mode: AH.S.meta.mode, sel: document.getElementById('mode').value }));
    check('方式の欄にフォーカスがあっても、文字や矢印で方式は変わらない', m.mode === 'ranktrace' && m.sel === 'ranktrace', JSON.stringify(m));
    await p.selectOption('#rate', '0.75'); await p.waitForTimeout(100);
    const badge = await p.evaluate(() => ({ rate: AH.video.playbackRate, tag: document.getElementById('playBtn').dataset.rate }));
    await p.selectOption('#rate', '1'); await p.waitForTimeout(100);
    const back = await p.evaluate(() => document.getElementById('playBtn').dataset.rate);
    check('再生速度が 1 以外のときは再生ボタンの角に出る（1 に戻すと消える）', badge.rate === 0.75 && badge.tag === '×0.75' && back === '', JSON.stringify([badge, back]));
    const ac = await p.evaluate(() => document.getElementById('rate').getAttribute('autocomplete'));
    check('再生速度の欄は再読み込みで前の値を戻さない（autocomplete=off）', ac === 'off', String(ac));
    await p.close();
  }

  // 「設定」の「入力をすべて消す」：値を初期値に戻し、レバーも戻る。書き込みの記録は残り、Ctrl+Z で戻せる。取り消すと何もしない
  {
    const p = await open('throttle');
    await p.keyboard.press('KeyR'); await p.keyboard.press('Space'); await p.keyboard.down('KeyW'); await p.waitForTimeout(500); await p.keyboard.up('KeyW');
    await p.keyboard.press('Space'); await p.keyboard.press('KeyR');
    await p.evaluate(() => { AH.S.data.memo = 'めも'; });
    const st = () => p.evaluate(() => ({ n: AH.S.data.points.v.length, v0: AH.S.data.points.v[0].val, strokes: AH.S.data.strokes.length, memo: AH.S.data.memo, lever: AH.mode.peek().v }));
    const before = await st();
    await p.click('#setBtn'); await p.click('#resetBtn'); await p.waitForTimeout(100);   // ダイアログは取り消し（open の dismiss）
    const kept = await st();
    p.removeAllListeners('dialog'); p.on('dialog', d => d.accept());
    await p.click('#resetBtn'); await p.waitForTimeout(200);
    const after = await st(), log = await p.evaluate(() => AH.S.log.some(l => l.type === 'reset'));
    check('確認で取り消すと何も消さない', JSON.stringify(kept) === JSON.stringify(before), JSON.stringify(kept));
    check('入力をすべて消す：値とレバーが初期値に戻り、書き込みの記録とメモは残る（操作ログ reset）', before.n > 1 && after.n === 1 && after.v0 === 5 && after.lever === 5 && after.strokes === before.strokes && after.memo === 'めも' && log, JSON.stringify({ before, after }));
    await p.keyboard.press('Escape'); await p.keyboard.press('Control+z'); await p.waitForTimeout(100);
    check('Ctrl+Z で消す前に戻る', (await st()).n === before.n, JSON.stringify(await st()));
    await p.close();
  }

  console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
