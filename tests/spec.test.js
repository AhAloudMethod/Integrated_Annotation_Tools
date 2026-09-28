// 仕様追加の回帰（v0.5）：評価区間の終了・動画ごとの評価区間・記録オフの操作・RCEA・HaloLight・グラフの区切り・書き込み後の値・色の設定
const { chromium } = require('playwright-core');
const { URL, VID, BROWSER } = require('./_env');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const errs = [];
  const open = async (mode, { video = true, dialog = 'dismiss' } = {}) => {
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message));
    p.on('dialog', d => (dialog === 'accept' ? d.accept() : d.dismiss()));
    await p.goto(URL); await p.selectOption('#mode', mode);
    if (video) { await p.setInputFiles('#file', VID); await p.waitForFunction(() => AH.S.meta.duration > 0); }
    await p.waitForTimeout(150);
    return p;
  };
  const blur = p => p.evaluate(() => document.activeElement && document.activeElement.blur());
  const range = p => p.evaluate(() => ({ ...AH.S.meta.range }));
  const setField = async (p, id, v) => { await p.fill('#' + id, String(v)); await p.dispatchEvent('#' + id, 'change'); };

  // ---- 1. 評価区間の終了 ----
  {
    const p = await open('affectgrid');
    await p.click('#rgBtn');
    await setField(p, 'rgStart', 1.5); await setField(p, 'rgEnd', 9.5);
    const a = await range(p);
    await setField(p, 'rgBin', 2);                                  // 区間の長さを変えても終了を保つ
    const b = await range(p), bEnd = await p.inputValue('#rgEnd');
    await setField(p, 'rgCount', 2);                                // 区間の数を変えると終了が動く
    const c = await p.inputValue('#rgEnd');
    await p.evaluate(() => AH.seekTo(7)); await p.waitForTimeout(150); await p.click('#rgEndNow');
    const d = await range(p);
    await p.click('#rgFit'); const e = await range(p);
    check('終了を指定すると区間の数が決まる', a.start === 1.5 && a.count === 8 && a.bin === 1, JSON.stringify(a));
    check('区間の長さの変更で終了を保つ', b.count === 4 && bEnd === '9.5', JSON.stringify(b) + ' end=' + bEnd);
    check('区間の数の変更で終了が動く', c === '5.5', 'end=' + c);
    check('今の時刻を終了にする', d.count === 2 && d.start + d.count * d.bin === 5.5, JSON.stringify(d));   // 7秒は2秒区間の区切り 5.5 に揃う
    check('動画の終わりまで', e.start + e.count * e.bin <= 12 && e.start + (e.count + 1) * e.bin > 12, JSON.stringify(e));
    await p.close();
  }

  // ---- 2. 評価区間は動画ごとに覚える ----
  {
    const p = await open('excel');
    await p.click('#rgBtn'); await setField(p, 'rgBin', 1); await setField(p, 'rgStart', 2); await setField(p, 'rgEnd', 8);
    const a = await range(p); await p.close();
    const q = await open('sam');                                    // 別の方式・新しいページでも同じ動画なら同じ区間
    const b = await range(q), shown = [await q.inputValue('#rgStart'), await q.inputValue('#rgEnd')];
    await q.fill('#pid', 'OTHER'); await q.dispatchEvent('#pid', 'change');
    await q.setInputFiles('#file', VID); await q.waitForTimeout(400);   // 参加者IDを変えて開き直しても同じ
    const c = await range(q);
    const log = await q.evaluate(() => AH.S.log.some(l => l.type === 'range_restore'));
    check('評価区間を動画に紐づけて覚える', a.start === 2 && a.count === 6 && JSON.stringify(b) === JSON.stringify(a) && shown.join() === '2,8', JSON.stringify({ a, b, shown }));
    check('参加者IDが違っても同じ動画なら同じ区間', JSON.stringify(c) === JSON.stringify(a) && log, JSON.stringify(c));
    await q.evaluate(() => localStorage.clear()); await q.close();
  }

  console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
