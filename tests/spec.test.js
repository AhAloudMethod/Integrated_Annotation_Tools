// 仕様追加の回帰（v0.5）：評価区間の終了・動画ごとの評価区間・記録オフの操作・RCEA・HaloLight・グラフの区切り・書き込み後の値・色の設定
const { chromium } = require('playwright-core');
const fs = require('fs');
const { URL, VID, BROWSER, out } = require('./_env');
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
    const d = await range(p), endD = await p.inputValue('#rgEnd');
    await p.click('#rgFit'); const e = await range(p);
    // 区間の長さを行き来しても終了が手前へ縮まない（決めた終了 12 秒から毎回決め直す）
    await setField(p, 'rgStart', 0); await setField(p, 'rgBin', 1); await p.click('#rgFit');
    const ends = [];
    for (const b of [0.7, 1, 0.3, 1, 2.5, 1]) { await setField(p, 'rgBin', b); ends.push(+(await p.inputValue('#rgEnd'))); }
    check('終了を指定すると区間の数が決まる', a.start === 1.5 && a.count === 8 && a.bin === 1, JSON.stringify(a));
    check('区間の長さの変更で終了を保つ', b.count === 4 && bEnd === '9.5', JSON.stringify(b) + ' end=' + bEnd);
    check('区間の数の変更で終了が動く', c === '5.5', 'end=' + c);
    check('今の時刻を終了にする（最後の区間は 5.5〜7 の短い区間）', d.count === 3 && d.target === 7 && endD === '7', JSON.stringify(d) + ' end=' + endD);
    check('動画の終わりまで（1.5 秒から2秒区間で 12 秒まで：最後は 11.5〜12 の短い区間）', e.count === 6 && e.target === 12 && await p.inputValue('#rgEnd') === '12', JSON.stringify(e));
    // 終了が区切りに合わないとき：最後は短い区間（11〜11.5）で、書き出しの _bins の終わりも 11.5
    await setField(p, 'rgBin', 1); await setField(p, 'rgEnd', 11.5);
    const g = await range(p), btn = await p.textContent('#rgBtn'), last = await p.evaluate(() => [AH.binStart(AH.nSec() - 1), AH._.binEnd(AH.nSec() - 1), AH._.binEnd(0)]);
    check('最後の1秒未満を捨てず、短い最後の区間（11〜11.5）にする', g.count === 12 && JSON.stringify(last) === '[11,11.5,1]' && btn === '0秒〜11.5秒', JSON.stringify({ g, last, btn }));
    check('区間の長さを行き来しても終了は 12 秒のまま（端数は短い最後の区間）', JSON.stringify(ends) === '[12,12,12,12,12,12]', JSON.stringify(ends));
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
    const renamed = out('renamed-video.mp4'); fs.copyFileSync(VID, renamed);   // ファイル名を変えた・移した同じ動画
    await q.setInputFiles('#file', renamed); await q.waitForFunction(() => AH.S.meta.video_file === 'renamed-video.mp4'); await q.waitForTimeout(400);
    const d = await range(q);
    check('ファイル名を変えても同じ動画なら同じ区間', JSON.stringify(d) === JSON.stringify(a), JSON.stringify(d));
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
    await p.evaluate(() => { AH._.setF0Shown(false); AH.S.data.points.v[0].val = 9; AH.refresh(); });   // F0 の欄は消して2段で測る。記録の線を中立の線から離す
    await p.waitForTimeout(150);
    const r = await p.evaluate(() => {
      const c = document.getElementById('tl'), d = devicePixelRatio || 1, h = c.clientHeight, y = Math.round(((h - 18) / 2) * d);
      const g = c.getContext('2d'), px = x => [...g.getImageData(Math.round(x * d), y, 1, 1).data];
      const above = [...g.getImageData(Math.round(20 * d), y - Math.round(4 * d), 1, 1).data];
      // 快度の欄の中立（5）の線：8px 続けて途切れない（点線ではない）。記録の線と重ならない位置（右端寄り）で見る
      const y5 = Math.round((8 + ((h - 18) / 2 - 8 - 8) / 2) * d), x0 = Math.round((c.clientWidth - 60) * d);
      const neutral = Array.from({ length: Math.round(8 * d) }, (_x, k) => g.getImageData(x0 + k, y5, 1, 1).data[3]);
      return { at: px(20), mid: px(c.clientWidth / 3 + 3), above, neutral };
    });
    const [R, G, B] = r.mid;
    check('グラフに区切り線がある', r.at[3] > 0 && r.mid[3] > 0 && r.above[3] === 0, JSON.stringify(r));
    check('区切り線は赤', R > 150 && R > G * 2 && R > B * 2, JSON.stringify(r.mid));
    check('中立（5）の線は実線', r.neutral.every(a => a > 0), JSON.stringify(r.neutral));
    await p.evaluate(() => AH._.setF0Shown(true));
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

  // ---- 8. 色の設定（4象限＋4軸方向） ----
  {
    const p = await open('halolight');
    const def = await p.evaluate(() => ({ q: AH.quadColor(9, 9), g: AH.gradColor(9, 5) }));   // 既定：高覚醒・快＝黄、快の軸＝黄と緑の中間
    await p.click('#setBtn');
    const setColor = (k, v) => p.$eval(`#colorGrid input[data-key="${k}"]`, (e, v) => { e.value = v; e.dispatchEvent(new Event('input')); }, v);
    await setColor('hh', '#ff00ff');                                   // 象限の色
    const q = await p.evaluate(() => ({ q: AH.quadColor(8, 8), axisAuto: AH.gradColor(9, 5) }));
    await setColor('vp', '#000000');                                   // 軸方向の色（快）
    const ax = await p.evaluate(() => ({ axis: AH.gradColor(9, 5), half: AH.gradColor(9, 7) }));
    await p.click('#colorGrid .auto[data-key="vp"]');                  // 自動に戻す
    const autoBack = await p.evaluate(() => AH.gradColor(9, 5));
    // HaloLight の円に反映される
    await p.click('#setBtn');
    const b = await p.locator('canvas.plane').boundingBox();
    await p.mouse.move(b.x + b.width * 0.95, b.y + b.height * 0.05); await p.mouse.down(); await p.waitForTimeout(150);
    const bg = await p.evaluate(() => getComputedStyle(document.querySelector('.halo')).backgroundColor);
    await p.mouse.up();
    // 保存され、次のページでも使われる。書き出しのメタ情報にも残る
    const q2page = await open('rcea');
    const kept = await q2page.evaluate(() => AH.quadColor(9, 9));
    const logged = await p.evaluate(() => AH.S.log.filter(l => l.type === 'colors').length);
    await q2page.evaluate(() => AH._.resetColors()); const reset = await q2page.evaluate(() => AH.quadColor(9, 9));
    check('既定の色（黄、軸は中間）', def.q.join() === '242,194,48' && def.g.join() === '151,182,70', JSON.stringify(def));
    check('象限の色を変えられる', q.q.join() === '255,0,255' && q.axisAuto.join() === '157,85,174', JSON.stringify(q));
    check('軸方向の色を変えられる（補間も変わる）', ax.axis.join() === '0,0,0' && ax.half.join() !== q.q.join(), JSON.stringify(ax));
    check('軸方向を自動に戻せる', autoBack.join() === q.axisAuto.join(), autoBack.join());
    check('HaloLight の円に設定した色が使われる', /255, 0, 255/.test(bg), bg);
    check('色の設定が保存され、操作ログに残る', kept.join() === '255,0,255' && logged >= 3, JSON.stringify({ kept, logged }));
    check('既定に戻せる', reset.join() === '242,194,48', reset.join());
    await q2page.evaluate(() => localStorage.clear()); await q2page.close(); await p.close();
  }

  // ---- 区切りを自分で置く（不揃いの区間） ----
  {
    const p = await open('excel');
    await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('ahann_range')) localStorage.removeItem(k); });
    await p.evaluate(() => { AH._.setRange({ start: 0, bin: 1, count: 12, target: 12, edges: null }); for (const [s, v] of [[0, 1], [1, 2], [2, 3], [3, 4]]) AH.setCell('v', s, v); });
    const geo = () => p.evaluate(() => ({ n: AH.nSec(), edges: AH.S.meta.range.edges || null, cells: [0, 1, 2, 3, 4, 5].map(i => AH.S.data.cells.v[i] ?? null), btn: document.getElementById('rgBtn').textContent, dis: document.getElementById('rgCount').disabled }));
    await p.click('#rgBtn');
    await p.evaluate(() => AH.seekTo(1.5)); await p.waitForTimeout(150); await p.click('#cutAdd'); await p.waitForTimeout(100);
    const a = await geo(), ab = await p.evaluate(() => [AH.binStart(2), AH._.binEnd(1), AH._.binAt(1.4), AH._.binAt(1.6)]);
    check('今の時刻で区切ると区間 1 が 1〜1.5・1.5〜2 に割れ、区間方式の値は両方に引き継ぐ', a.n === 13 && JSON.stringify(ab) === '[1.5,1.5,1,2]' && JSON.stringify(a.cells) === '[1,2,2,3,4,null]' && a.btn === '0秒〜12秒' && a.dis, JSON.stringify({ a, ab }));
    await p.evaluate(() => AH.seekTo(1.45)); await p.waitForTimeout(150); await p.click('#cutDel'); await p.waitForTimeout(100);
    const b = await geo();
    check('近くの区切り（1.5）を消すと元に戻り、前の区間の値を残す', b.n === 12 && JSON.stringify(b.cells) === '[1,2,3,4,null,null]', JSON.stringify(b));
    await setField(p, 'cutList', '1.2, 2, 3.5'); await p.waitForTimeout(100);
    const c = await geo();
    check('区切りの一覧を書き換えると、その区切りの区間になる', JSON.stringify(c.edges) === '[0,1.2,2,3.5,12]' && c.n === 4, JSON.stringify(c));
    await p.evaluate(() => AH.seekTo(10)); await p.waitForTimeout(150); await p.click('#rgEndNow'); await p.waitForTimeout(100);
    const d = await geo();
    check('不揃いの区間でも、今の時刻を終了にできる', JSON.stringify(d.edges) === '[0,1.2,2,3.5,10]', JSON.stringify(d));
    const dl = []; p.on('download', x => dl.push(x));
    await p.click('#exportBtn'); await p.waitForTimeout(1200);
    const bins = fs.readFileSync(await dl.find(x => x.suggestedFilename().endsWith('_bins.csv')).path(), 'utf8').trim().split('\n').slice(1).map(l => l.split(',').slice(2, 4).join('-'));
    check('書き出しの _bins.csv は不揃いの区間の始めと終わり', bins.join(' ') === '0.000-1.200 1.200-2.000 2.000-3.500 3.500-10.000', bins.join(' '));
    await p.click('#rgBtn'); await p.click('#cutReset'); await p.waitForTimeout(100);
    const e = await geo();
    check('等間隔に戻す（0〜10 を 1 秒ずつ）', e.edges === null && e.n === 10 && !e.dis, JSON.stringify(e));
    await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('ahann_range')) localStorage.removeItem(k); });
    await p.close();
  }

  // ---- タイムラインの右クリックで区切りを置く・動かす・消す（連続評価のみ）と、区切りの取り消し ----
  {
    const clearRange = p => p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('ahann_range')) localStorage.removeItem(k); });
    const p = await open('feeltrace'); await p.evaluate(() => AH._.setTimeline(true)); await p.waitForTimeout(150);
    await clearRange(p);
    await p.evaluate(() => AH._.setRange({ start: 0, bin: 1, count: 12, target: 12, edges: null }));
    const box = await p.evaluate(() => { const r = document.getElementById('tl').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, D: AH.S.meta.duration }; });
    const X = t => box.x + 44 + t / box.D * (box.w - 52), yV = box.y + box.h * 0.2;
    const edges = () => p.evaluate(() => AH.S.meta.range.edges || null);
    const near = (es, t) => (es || []).some(x => Math.abs(x - t) < 0.05);
    const undoKey = async k => { await blur(p); await p.keyboard.press(k); await p.waitForTimeout(100); };
    await p.mouse.click(X(2.5), yV, { button: 'right' }); await p.waitForTimeout(100);
    const a = await edges();
    check('右クリックで区切りを置く（2.5 秒付近）', a && a.length === 14 && near(a, 2.5), JSON.stringify(a));
    const put = a.find(x => Math.abs(x - 2.5) < 0.05);
    await p.mouse.move(X(put), yV); await p.mouse.down({ button: 'right' }); await p.mouse.move(X(2.8), yV, { steps: 4 }); await p.mouse.up({ button: 'right' }); await p.waitForTimeout(100);
    const b = await edges();
    check('区切りを右ドラッグで動かす（2.8 秒付近）', b.length === 14 && near(b, 2.8) && !near(b, 2.5), JSON.stringify(b));
    const moved = b.find(x => Math.abs(x - 2.8) < 0.05);
    await p.mouse.move(X(moved), yV); await p.mouse.down({ button: 'right' }); await p.mouse.move(X(3.8), yV, { steps: 4 }); await p.mouse.up({ button: 'right' }); await p.waitForTimeout(100);
    const c = await edges(), cm = c.find(x => x > 2 && x < 3);
    check('隣の区切り（3 秒）は越えない', c.length === 14 && cm > 2.9 && cm < 3, JSON.stringify(c));
    await p.mouse.click(X(cm), yV, { button: 'right' }); await p.waitForTimeout(100);
    const d = await edges();
    check('区切りの上で右クリックすると消す', d.length === 13 && !d.some(x => x > 2 && x < 3), JSON.stringify(d));
    await undoKey('Control+z');
    const e = await edges();
    check('Ctrl+Z で消した区切りが戻る', e.length === 14 && near(e, cm), JSON.stringify(e));
    await undoKey('Control+z');
    const f = await edges();
    check('もう一度 Ctrl+Z で動かす前の位置に戻る', near(f, 2.8) && f.length === 14, JSON.stringify(f));
    await undoKey('Control+y');
    const g = await edges();
    check('Ctrl+Y でやり直せる', near(g, cm) && !near(g, 2.8), JSON.stringify(g));
    const cmDefault = await p.evaluate(() => { const ev = new MouseEvent('contextmenu', { cancelable: true, bubbles: true }); document.getElementById('tl').dispatchEvent(ev); return ev.defaultPrevented; });
    check('連続評価ではタイムラインで右クリックのメニューを出さない', cmDefault === true);
    // 左ドラッグはグラフ編集のまま。グラフ編集 → 区切りを動かす → Ctrl+Z 2 回で、区切り・グラフの順に戻る
    const pts = () => p.evaluate(() => JSON.stringify(AH.S.data.points.v));
    const p0 = await pts(), s0 = await p.evaluate(() => AH.S.data.strokes.length);
    await p.mouse.move(X(5.2), box.y + box.h * 0.1); await p.mouse.down(); await p.mouse.move(X(6.5), box.y + box.h * 0.1, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(100);
    const p1 = await pts(), s1 = await p.evaluate(() => AH.S.data.strokes.length);
    check('左ドラッグはグラフ編集（区切りは変わらない）', p1 !== p0 && s1 === s0 + 1 && JSON.stringify(await edges()) === JSON.stringify(g), `strokes ${s0}->${s1}`);
    await p.mouse.move(X(7), yV); await p.mouse.down({ button: 'right' }); await p.mouse.move(X(7.4), yV, { steps: 4 }); await p.mouse.up({ button: 'right' }); await p.waitForTimeout(100);
    const h = await edges();
    await undoKey('Control+z');
    const i = await edges(), pi = await pts();
    await undoKey('Control+z');
    const j = await edges(), pj = await pts();
    check('グラフ編集 → 区切り移動 → Ctrl+Z で区切りだけ戻る', near(h, 7.4) && !near(h, 7) && near(i, 7) && pi === p1, JSON.stringify({ h, i }));
    check('続けて Ctrl+Z でグラフが戻り、区切りはそのまま', pj === p0 && JSON.stringify(j) === JSON.stringify(i), '');
    await clearRange(p); await p.close();
  }
  {
    const p = await open('excel'); await p.evaluate(() => AH._.setTimeline(true)); await p.waitForTimeout(150);
    await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('ahann_range')) localStorage.removeItem(k); });
    await p.evaluate(() => { AH._.setRange({ start: 0, bin: 1, count: 12, target: 12, edges: null }); AH.S.undo = []; for (const [s, v] of [[0, 1], [1, 2], [2, 3]]) AH.setCell('v', s, v); });
    const box = await p.evaluate(() => { const r = document.getElementById('tl').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, D: AH.S.meta.duration }; });
    await p.mouse.click(box.x + 44 + 2.5 / box.D * (box.w - 52), box.y + box.h * 0.2, { button: 'right' }); await p.waitForTimeout(100);
    const xr = await p.evaluate(() => ({ e: AH.S.meta.range.edges, n: AH.nSec(), c: [0, 1, 2, 3, 4].map(i => AH.S.data.cells.v[i] ?? null), th: document.querySelectorAll('table.xl th[data-s]').length }));
    check('Excel では右クリックで区切りを置き（2.5 秒付近）、割った区間の値を両方に引き継ぎ、表の列も増える',
      xr.n === 13 && xr.e.some(x => Math.abs(x - 2.5) < 0.05) && JSON.stringify(xr.c) === '[1,2,3,3,null]' && xr.th === 13, JSON.stringify(xr));
    await blur(p); await p.keyboard.press('Control+z'); await p.waitForTimeout(100);
    check('Excel の右クリックの区切りも Ctrl+Z で戻る', await p.evaluate(() => !AH.S.meta.range.edges && AH.nSec() === 12 && AH.S.data.cells.v[2] === 3 && AH.S.data.cells.v[3] == null));
    const geo = () => p.evaluate(() => JSON.stringify({ n: AH.nSec(), e: AH.S.meta.range.edges || null, c: [0, 1, 2, 3].map(i => AH.S.data.cells.v[i] ?? null), cl: document.getElementById('cutList').value }));
    const before = await geo();
    await p.evaluate(() => AH.seekTo(1.5)); await p.waitForTimeout(150); await p.click('#rgBtn'); await p.click('#cutAdd'); await p.waitForTimeout(100);
    const split = await geo();
    await blur(p); await p.keyboard.press('Control+z'); await p.waitForTimeout(100);
    const undone = await geo();
    await p.keyboard.press('Control+y'); await p.waitForTimeout(100);
    const redone = await geo();
    check('ボタンで区切った操作も Ctrl+Z で区間の値ごと戻り、Ctrl+Y でやり直せる', undone === before && redone === split && JSON.parse(split).n === 13, JSON.stringify({ before, split, undone, redone }));
    await setField(p, 'rgStart', 0.5); await p.waitForTimeout(100);
    const st = await p.evaluate(() => AH.binStart(0));
    await blur(p); await p.keyboard.press('Control+z'); await p.waitForTimeout(100);
    const back = await p.evaluate(() => [AH.binStart(0), document.getElementById('rgStart').value]);
    check('評価区間の開始の変更も Ctrl+Z で戻り、設定欄も戻る', st === 0.5 && back[0] === 0 && back[1] === '0', JSON.stringify({ st, back }));
    await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('ahann_range')) localStorage.removeItem(k); });
    await p.close();
  }
  {
    const p = await open('affectgrid'); await p.evaluate(() => AH._.setTimeline(true)); await p.waitForTimeout(150);
    await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('ahann_range')) localStorage.removeItem(k); AH._.setRange({ start: 0, bin: 1, count: 12, target: 12, edges: null }); });
    const box = await p.evaluate(() => { const r = document.getElementById('tl').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, D: AH.S.meta.duration }; });
    await p.mouse.click(box.x + 44 + 2.5 / box.D * (box.w - 52), box.y + box.h * 0.2, { button: 'right' }); await p.waitForTimeout(100);
    check('Excel 以外の離散（Affect Grid）では右クリックで区切りを置かない', await p.evaluate(() => !AH.S.meta.range.edges && AH.nSec() === 12));
    await p.close();
  }

  // ---- Excel のセル移動：Enter は下（覚醒度の下は次の秒の快度）、Tab は右、Shift で逆向き ----
  {
    const p = await open('excel');
    const at = () => p.evaluate(() => { const a = document.activeElement; return a.dataset.ax + a.dataset.s; });
    await p.click('input[data-ax=v][data-s="0"]');
    const seq = [];
    for (const k of ['Enter', 'Enter', 'Shift+Enter', 'Shift+Enter', 'Tab', 'Tab', 'Shift+Tab', 'Enter', 'Shift+Tab']) { await p.keyboard.press(k); seq.push(await at()); }
    check('Excel：Enter で下・Tab で右へ移り、Shift で逆向き（覚醒度で Enter は次の秒の快度）', seq.join(' ') === 'a0 v1 a0 v0 v1 v2 v1 a1 a0', seq.join(' '));
    await p.close();
  }

  console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
