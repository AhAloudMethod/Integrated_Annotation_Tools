// バグ修正の回帰：評価区間の外への入力、参加者IDの変更、空欄の再入力
const { chromium } = require('playwright-core');
const { URL, VID, BROWSER } = require('./_env');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const errs = [];
  const open = async (mode, pid = 'F1', dialog = 'dismiss') => {
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message));
    p.on('dialog', d => (p._dialog === 'accept' ? d.accept() : d.dismiss()));
    p._dialog = dialog;
    await p.goto(URL); await p.fill('#pid', pid); await p.selectOption('#mode', mode);
    await p.setInputFiles('#file', VID); await p.waitForFunction(() => AH.S.meta.duration > 0); await p.waitForTimeout(200);
    return p;
  };
  const setRange = p => p.evaluate(() => { AH.S.meta.range = { start: 2, count: 4, bin: 2, label: 'countdown' }; AH.refresh(); });   // 2〜10秒

  // 1. 評価区間の外への入力は拒否（Affect Grid・SAM・カスタム区間ごと）
  for (const mode of ['affectgrid', 'sam', 'custom']) {
    const p = await open(mode);
    if (mode === 'custom') { await p.locator('select[aria-label=時間]').selectOption('disc'); await p.waitForTimeout(100); }
    await setRange(p);
    const hit = async () => {
      if (mode === 'sam') await p.click('.samRow.v button[data-v="7"]');
      else { const b = await p.locator('canvas.plane').boundingBox(); await p.mouse.click(b.x + b.width * 0.8, b.y + b.height * 0.2); }
    };
    const cells = () => p.evaluate(() => ({ v: AH.S.data.cells.v.slice(), n: AH.S.undo.length }));
    await p.evaluate(() => AH.seekTo(0.5)); await p.waitForTimeout(150); await hit();
    const before = await cells(), hint = await p.$eval('#hint', e => !e.hidden && e.textContent.includes('評価区間の外'));
    await p.evaluate(() => AH.seekTo(11)); await p.waitForTimeout(150); await hit();
    const after = await cells();
    await p.evaluate(() => AH.seekTo(4.5)); await p.waitForTimeout(150); await hit();
    const inside = await cells();
    check(`区間外の入力を拒否（${mode}）`, before.v.every(x => x == null) && after.v.every(x => x == null) && hint && inside.v[1] != null && inside.v.filter(x => x != null).length === 1,
      JSON.stringify({ before: before.v, after: after.v, inside: inside.v, hint }));
    await p.close();
  }
  // 動画の末尾（既定の区間の終わりちょうど）では最後の区間に入る
  {
    const p = await open('affectgrid');
    await p.evaluate(() => AH.seekTo(AH.S.meta.duration)); await p.waitForTimeout(200);
    const b = await p.locator('canvas.plane').boundingBox(); await p.mouse.click(b.x + b.width * 0.8, b.y + b.height * 0.2);
    const r = await p.evaluate(() => ({ n: AH.nSec(), last: AH.S.data.cells.v[AH.nSec() - 1] }));
    check('動画の末尾では最後の区間に入力', r.last != null, JSON.stringify(r));
    await p.close();
  }

  // 2. 参加者IDの変更で保存データが新しいIDへ移る（全方式分）
  {
    const p = await open('key', 'OLD');
    await p.evaluate(() => document.activeElement.blur());
    await p.keyboard.press('ArrowRight'); await p.keyboard.press('Digit8');
    await p.selectOption('#mode', 'emujoy'); await p.waitForTimeout(150);   // key の分が保存される
    await p.fill('#pid', 'NEW'); await p.press('#pid', 'Tab'); await p.waitForTimeout(150);
    const keys = await p.evaluate(() => Object.keys(localStorage).filter(k => /:(OLD|NEW):/.test(k)).sort());
    const meta = await p.evaluate(() => ({ pid: AH.S.meta.participant, last: AH.S.log.at(-1).type }));
    check('参加者IDの変更で保存データを移す', keys.length === 2 && keys.every(k => k.includes(':NEW:')) && meta.pid === 'NEW', JSON.stringify({ keys, meta }));
    await p.close();
    const q = await open('key', 'NEW', 'accept');
    check('新しいIDで再開できる', (await q.evaluate(() => AH.S.data.points.v.map(x => x.val))).includes(8));
    await q.evaluate(() => localStorage.clear()); await q.close();
  }
  // 移し先に既存データがあり、確認でキャンセルした場合はIDを戻す
  {
    const p = await open('key', 'A');
    await p.evaluate(() => { localStorage.setItem(`ahann4:key:B:${AH.S.meta.video_file}`, '{"x":1}'); document.activeElement.blur(); });
    await p.keyboard.press('Digit6');
    await p.fill('#pid', 'B'); await p.press('#pid', 'Tab'); await p.waitForTimeout(150);
    const r = await p.evaluate(() => ({ pid: AH.S.meta.participant, input: document.getElementById('pid').value, b: localStorage.getItem(`ahann4:key:B:${AH.S.meta.video_file}`), a: !!localStorage.getItem(`ahann4:key:A:${AH.S.meta.video_file}`) }));
    check('衝突してキャンセルしたらIDを戻す', r.pid === 'A' && r.input === 'A' && r.b === '{"x":1}' && r.a, JSON.stringify(r));
    await p.evaluate(() => localStorage.clear()); await p.close();
  }

  // 3. Excel：空のセルを空のまま確定しても履歴・ログが増えない
  {
    const p = await open('excel');
    const cnt = () => p.evaluate(() => ({ undo: AH.S.undo.length, clear: AH.S.log.filter(l => l.type === 'cell_clear').length }));
    const c0 = await cnt();
    await p.click('input[data-ax=v][data-s="0"]'); await p.keyboard.type('x');   // 不正な文字 → 空のまま
    await p.$eval('input[data-ax=v][data-s="1"]', e => { e.value = ''; e.dispatchEvent(new Event('input')); });
    const c1 = await cnt();
    await p.click('input[data-ax=v][data-s="2"]'); await p.keyboard.type('4'); await p.keyboard.press('Backspace');
    const c2 = await cnt();
    check('空欄の再確定で履歴が増えない', c1.undo === c0.undo && c1.clear === c0.clear && c2.undo === c0.undo + 2 && c2.clear === 1, JSON.stringify({ c0, c1, c2 }));
    await p.evaluate(() => localStorage.clear()); await p.close();
  }

  console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
