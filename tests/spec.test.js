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

  // ---- 3. 記録オフでもスライダー・レバー・RankTrace を動かせる。記録オンは動かした位置から ----
  {
    // スロットル：記録オフで W を押すとレバーが動き、記録はされない
    const p = await open('throttle'); await blur(p);
    await p.keyboard.down('KeyW'); await p.waitForTimeout(400); await p.keyboard.up('KeyW');
    const lever = await p.evaluate(() => AH.S.data.points.v.length);
    const hint = await p.$eval('#hint', e => !e.hidden);
    // 記録オン → 再生：最初の書き込みは動かした位置（5 より上）から
    await p.keyboard.press('KeyR'); await p.keyboard.press('Space'); await p.waitForTimeout(300); await p.keyboard.press('Space'); await p.keyboard.press('KeyR');
    const first = await p.evaluate(() => AH.S.data.strokes[0]?.samples[0]?.[1]);
    // 記録オフでシークすると記録済みの値に追従（何も書いていない 11 秒は 5）
    // 記録オフのまま 9 秒へシークしてから記録オン：最初の書き込みはその時刻の記録済みの値（＝レバーが追従している）
    await p.evaluate(() => AH.seekTo(9)); await p.waitForTimeout(300);
    const expect = await p.evaluate(() => AH.valueAt('v', AH.video.currentTime));
    await p.keyboard.press('KeyR'); await p.keyboard.press('Space'); await p.waitForTimeout(200); await p.keyboard.press('Space'); await p.keyboard.press('KeyR');
    const second = await p.evaluate(() => AH.S.data.strokes[1]?.samples[0]?.[1]);
    check('スロットル：記録オフで動かせて記録はされない', lever === 1 && !hint, `points=${lever} hint=${hint}`);
    check('スロットル：記録オンは動かした位置から始まる', first > 5.8, 'first=' + first);
    check('スロットル：記録オフでシークすると記録済みの値に追従', second === expect, `second=${second} expect=${expect}`);
    await p.close();
  }
  {
    const p = await open('carma'); await blur(p);
    const b = await p.locator('canvas.bars').boundingBox();
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await p.mouse.move(b.x + b.width / 2, b.y + 40, { steps: 4 }); await p.mouse.up();
    const pts = await p.evaluate(() => AH.S.data.points.v.length), hint = await p.$eval('#hint', e => !e.hidden);
    await p.keyboard.press('KeyR'); await p.keyboard.press('Space'); await p.waitForTimeout(300); await p.keyboard.press('Space'); await p.keyboard.press('KeyR');
    const first = await p.evaluate(() => AH.S.data.strokes[0]?.samples[0]?.[1]);
    check('CARMA：記録オフでスライダーを動かせる', pts === 1 && !hint, `points=${pts} hint=${hint}`);
    check('CARMA：記録オンは動かした位置から始まる', first > 7.5, 'first=' + first);
    await p.close();
  }
  {
    const p = await open('ranktrace'); await blur(p);
    const b = await p.locator('canvas.trace').boundingBox(); await p.mouse.move(b.x + 60, b.y + 60);
    for (let i = 0; i < 3; i++) { await p.mouse.wheel(0, -100); await p.waitForTimeout(80); }
    const pts = await p.evaluate(() => AH.S.data.points.v.length), hint = await p.$eval('#hint', e => !e.hidden);
    await p.keyboard.press('KeyR'); await p.keyboard.press('Space'); await p.waitForTimeout(300); await p.keyboard.press('Space'); await p.keyboard.press('KeyR');
    const first = await p.evaluate(() => AH.S.data.strokes[0]?.samples[0]?.[1]);
    check('RankTrace：記録オフでホイールを動かせる', pts === 1 && !hint, `points=${pts} hint=${hint}`);
    check('RankTrace：記録オンは動かした位置から始まる', first === 1.5, 'first=' + first);
    await p.close();
  }

  // ---- 4. RCEA のジョイスティックは動画の外 ----
  {
    const p = await open('rcea');
    const r = await p.evaluate(() => { const pad = document.querySelector('canvas.rceaPad'); return { inStage: !!pad.closest('#stage'), inPanel: !!pad.closest('#panel'), w: Math.round(pad.getBoundingClientRect().width) }; });
    const b = await p.locator('canvas.rceaPad').boundingBox();
    await p.keyboard.press('Space');
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await p.mouse.move(b.x + b.width * 0.9, b.y + b.height * 0.1, { steps: 5 }); await p.waitForTimeout(200);
    const border = await p.evaluate(() => document.getElementById('stage').style.boxShadow);
    await p.mouse.up(); await p.keyboard.press('Space');
    const st = await p.evaluate(b => ({ strokes: AH.S.data.strokes.length, border: b }), border);
    check('RCEA のジョイスティックが動画の外にある', !r.inStage && r.inPanel && r.w > 200, JSON.stringify(r));
    check('RCEA：操作で記録され、動画の枠に色が付く', st.strokes === 1 && /rgb/.test(st.border), JSON.stringify(st));
    await p.close();
  }

  // ---- 5. HaloLight は円全体の色が変わる ----
  {
    const p = await open('halolight');
    const b = await p.locator('canvas.plane').boundingBox();
    await p.mouse.move(b.x + b.width * 0.9, b.y + b.height * 0.1); await p.mouse.down(); await p.waitForTimeout(150);
    const st = await p.evaluate(() => { const cs = getComputedStyle(document.querySelector('.halo')); return { bg: cs.backgroundColor, border: cs.borderTopWidth }; });
    await p.mouse.up();
    check('HaloLight：円全体が色で塗られる', /rgba?\(2[0-9]{2}, 1[0-9]{2}, /.test(st.bg) && st.border === '1px', JSON.stringify(st));   // 高覚醒・快＝黄
    await p.close();
  }

  // ---- 6. グラフに快度と覚醒度の区切り線 ----
  {
    const p = await open('emujoy'); await p.evaluate(() => AH._.setTimeline(true)); await p.waitForTimeout(150);
    const r = await p.evaluate(() => {
      const c = document.getElementById('tl'), d = devicePixelRatio || 1, h = c.clientHeight, y = Math.round(((h - 18) / 2) * d);
      const g = c.getContext('2d'), px = x => [...g.getImageData(Math.round(x * d), y, 1, 1).data];
      const above = [...g.getImageData(Math.round(20 * d), y - Math.round(4 * d), 1, 1).data];
      return { at: px(20), mid: px(c.clientWidth / 3 + 3), above };
    });
    check('グラフに区切り線がある', r.at[3] > 0 && r.mid[3] > 0 && r.above[3] === 0, JSON.stringify(r));
    await p.close();
  }

  // ---- 7. 書き込みを終えた後：既定は値を保つ（EMuJoy で離すと元の点に引き戻される問題）。設定で元の値に戻すも選べる ----
  for (const mode of ['hold', 'restore']) {
    const p = await open('emujoy'); await blur(p);
    if (mode === 'restore') { await p.click('#setBtn'); await p.selectOption('#afterWrite', 'restore'); await p.click('#setBtn'); }
    const b = await p.locator('canvas.plane').boundingBox();
    await p.keyboard.press('Space');
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down();
    await p.mouse.move(b.x + b.width * 0.9, b.y + b.height * 0.1, { steps: 6 }); await p.waitForTimeout(300); await p.mouse.up();
    await p.waitForTimeout(300); await p.keyboard.press('Space');
    const r = await p.evaluate(() => { const s = AH.S.data.strokes[0]; return { end: s.t_end, after: s.after, v: AH.valueAt('v', s.t_end + 0.2), vLast: AH.valueAt('v', AH.S.meta.duration - 0.01), shown: document.querySelector('.nowRow b').textContent }; });
    if (mode === 'hold') check('書き込みを終えた後、その値を保つ（既定）', r.after === 'hold' && r.v > 8 && r.vLast > 8 && +r.shown > 8, JSON.stringify(r));
    else check('設定で「元の値に戻す」を選べる', r.after === 'restore' && r.v === 5 && r.vLast === 5, JSON.stringify(r));
    await p.evaluate(() => localStorage.removeItem('ahann_after')); await p.close();
  }

  console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
