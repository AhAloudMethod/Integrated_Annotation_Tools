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
    const before = await cells(), hint = await p.$eval('#hint', e => !e.hidden && e.textContent.includes('評価区間外'));
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

  // 4. Excel：値の入ったセルをクリックしても打ち直せる（グラフの目盛りの帯でシークした後も）
  {
    const p = await open('excel');
    if (await p.evaluate(() => document.body.classList.contains('noTl'))) { await p.click('#tlBtn'); await p.waitForTimeout(100); }
    const tl = await p.locator('#tl').boundingBox();
    for (let s = 0; s < 3; s++) { await p.click(`input[data-ax=v][data-s="${s}"]`); await p.keyboard.type(String(s + 2)); }
    for (let s = 0; s < 3; s++) {
      await p.mouse.click(tl.x + 80 + s * 40, tl.y + tl.height - 6); await p.waitForTimeout(80);
      await p.click(`input[data-ax=v][data-s="${s}"]`); await p.keyboard.type(String(s + 7));
    }
    const v = await p.evaluate(() => AH.S.data.cells.v.slice(0, 3));
    check('値の入ったセルをクリックして打ち直せる', JSON.stringify(v) === '[7,8,9]', JSON.stringify(v));
    await p.evaluate(() => localStorage.clear()); await p.close();
  }

  // 5. Excel：区間が多くて表がはみ出すと、ホイールで横に送り、シークした区間の列を見える所に出す
  {
    const p = await open('excel');
    await p.evaluate(() => AH._.setRange({ start: 0, bin: 0.2, count: 60, target: 12, edges: null })); await p.waitForTimeout(200);
    const wb = await p.locator('.xlWrap').boundingBox();
    await p.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2); await p.mouse.wheel(0, 300); await p.waitForTimeout(200);
    const sl = await p.evaluate(() => document.querySelector('.xlWrap').scrollLeft);
    await p.evaluate(() => { document.querySelector('.xlWrap').scrollLeft = 0; AH.seekTo(11.9); });
    await p.waitForFunction(() => { const w = document.querySelector('.xlWrap').getBoundingClientRect(), c = document.querySelector('table.xl th[data-s="59"]').getBoundingClientRect(); return c.left >= w.left - 1 && c.right <= w.right + 1; }, null, { timeout: 3000 }).catch(() => {});   // 負荷が高いとスクロールが遅れる
    const vis = await p.evaluate(() => { const w = document.querySelector('.xlWrap').getBoundingClientRect(), c = document.querySelector('table.xl th[data-s="59"]').getBoundingClientRect(); return c.left >= w.left - 1 && c.right <= w.right + 1; });
    check('Excel：はみ出した表はホイールで横に送り、シークした区間の列を出す', sl > 100 && vis, JSON.stringify({ sl, vis }));
    await p.evaluate(() => localStorage.clear()); await p.close();
  }

  // 6. Excel：0（発声なし）を入れられる。9 段階でも連続値でも入り、0.5 のような 0 台の小数は入らない
  {
    const p = await open('excel');
    await p.click('input[data-ax=v][data-s="0"]'); await p.keyboard.type('0');
    const int = await p.evaluate(() => [AH.S.data.cells.v[0], AH.S.data.cells.a[0]]);
    await p.click('input[data-ax=a][data-s="0"]'); await p.keyboard.type('6');
    const back = await p.evaluate(() => [AH.S.data.cells.v[0] ?? null, AH.S.data.cells.a[0], document.querySelector('input[data-ax=v][data-s="0"]').value]);
    const undo = await p.evaluate(() => { const c = () => [AH.S.data.cells.v[0] ?? null, AH.S.data.cells.a[0] ?? null]; AH._.undo(); const u1 = c(); AH._.undo(); return [u1, c()]; });
    check('Excel：片方に 0 を入れると両軸 0、0 の区間で片方に 1〜9 を入れるともう片方は空欄（取り消しは 1 回ずつ）', JSON.stringify(back) === '[null,6,""]' && JSON.stringify(undo) === '[[0,0],[null,null]]', JSON.stringify({ int, back, undo }));
    await p.selectOption('#mode', 'custom'); await p.waitForTimeout(150);
    await p.selectOption('select[aria-label=インタフェース]', 'excel'); await p.waitForTimeout(100);
    await p.selectOption('select[aria-label=値]', 'real'); await p.waitForTimeout(100);
    for (const [s, x] of [[3, '0'], [1, '0.5'], [2, '0.0']]) { await p.click(`input[data-ax=v][data-s="${s}"]`); await p.keyboard.type(x); await p.keyboard.press('Escape'); await p.waitForTimeout(450); }
    const real = await p.evaluate(() => [3, 1, 2].map(s => AH.S.data.cells.v[s] ?? null).concat([AH.S.data.cells.a[3]]));
    check('Excel：0（発声なし）を入れられ、0 台の小数は入らない', JSON.stringify(int) === '[0,0]' && JSON.stringify(real) === '[0,null,0,0]', JSON.stringify({ int, real }));
    await p.evaluate(() => localStorage.clear()); await p.close();
  }

  // 7. Excel の区切り「1秒固定」：評価区間の開始〜終了を 1 秒ごとにし、右クリックでは区切れない（専用の Excel とカスタムの Excel）
  for (const mode of ['excel', 'custom']) {
    const p = await open(mode);
    if (mode === 'custom') { await p.selectOption('select[aria-label=インタフェース]', 'excel'); await p.waitForTimeout(100); }
    await p.evaluate(() => { AH._.setRange({ start: 1, bin: 2, count: 5, target: 11, edges: null }); AH._.setTimeline(true); }); await p.waitForTimeout(100);
    await p.selectOption('select[aria-label=区切り]', 'sec1'); await p.waitForTimeout(150);
    const r = await p.evaluate(() => ({ n: AH.nSec(), s0: AH.binStart(0), bin: AH.S.meta.range.bin, end: AH._.rangeEnd(), cut: !!AH.mode.graphCuts }));
    check(`${mode}：区切り「1秒固定」で評価区間（1〜11 秒）を 1 秒ごとの 10 区間にし、区切りを編集できない`, r.n === 10 && r.s0 === 1 && r.bin === 1 && Math.abs(r.end - 11) < 1e-6 && !r.cut, JSON.stringify(r));
    await p.evaluate(() => localStorage.clear()); await p.close();
  }

  // 8. シーク：前のシークが終わる前の指示は最後の 1 つだけ残す（シークの帯のドラッグで詰まらない）。区間外の札で時刻の幅が変わらない
  {
    const p = await open('key');
    await p.evaluate(() => { AH._.setRange({ start: 2, bin: 1, count: 6, target: 8, edges: null }); AH.seekTo(5); });
    await p.waitForFunction(() => !AH.video.seeking); await p.waitForTimeout(100);
    const w0 = await p.evaluate(() => document.getElementById('clock').getBoundingClientRect().width);
    const n0 = await p.evaluate(() => AH.S.log.filter(l => l.type === 'seek').length);
    await p.evaluate(() => { for (let k = 0; k < 40; k++) AH.seekTo(0.2 + k * 0.02); });   // 0.2〜0.98 秒へ続けて
    await p.waitForFunction(() => !AH.video.seeking); await p.waitForTimeout(200);
    const r = await p.evaluate(() => ({ t: AH.video.currentTime, n: AH.S.log.filter(l => l.type === 'seek').length, out: document.getElementById('clock').dataset.out, w: document.getElementById('clock').getBoundingClientRect().width, txt: document.getElementById('clock').textContent }));
    check('続けてシークすると最後の位置へ移り、途中の位置は飛ばす。区間外は札で出し、時刻の幅は変わらない', Math.abs(r.t - 0.98) < 0.01 && r.n - n0 <= 3 && r.out === '区間外' && Math.abs(r.w - w0) < 1 && !/区間外/.test(r.txt), JSON.stringify({ ...r, n0, w0 }));
    await p.evaluate(() => localStorage.clear()); await p.close();
  }

  // 9. Excel：セルに入れている間の R は、そのセルの区間を始めから終わりまで再生して止める（聴いてから入力がオフでも、オンでも）
  for (const listen of [false, true]) {
    const p = await open('excel');
    await p.evaluate(on => { AH._.setListen(on); AH._.setRange({ start: 0, bin: 1, count: 12, target: 12, edges: null }); AH.seekTo(1.5); }, listen); await p.waitForTimeout(150);
    await p.click('input[data-ax=v][data-s="5"]'); await p.keyboard.press('KeyR');
    const started = await p.waitForFunction(() => !AH.video.paused && AH.video.currentTime >= 5 && AH.video.currentTime < 6, null, { timeout: 3000 }).then(() => true).catch(() => false);
    const stopped = await p.waitForFunction(() => AH.video.paused && AH.video.currentTime > 5.9, null, { timeout: 4000 }).then(() => true).catch(() => false);
    const r = await p.evaluate(() => ({ t: +AH.video.currentTime.toFixed(3), focus: document.activeElement.dataset.s, val: document.activeElement.value }));
    check(`Excel：セルの R はそのセルの区間（5〜6 秒）を再生して終わりで止まる（聴いてから入力が${listen ? 'オン' : 'オフ'}）`, started && stopped && r.t < 6 && r.focus === '5' && r.val === '', JSON.stringify({ started, stopped, r }));
    await p.evaluate(() => { AH._.setListen(false); localStorage.clear(); }); await p.close();
  }

  console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
