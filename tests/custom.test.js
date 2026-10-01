// カスタム条件の回帰：軌跡は実際に評価した範囲だけ・値の刻み（連続／離散）・1軸のときの固定・AffectRank のプリセット、と変化ボタン
const { chromium } = require('playwright-core');
const { URL, VID, BROWSER } = require('./_env');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const errs = [];
  const open = async mode => {
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss());
    await p.goto(URL); await p.selectOption('#mode', mode);
    await p.setInputFiles('#file', VID); await p.waitForFunction(() => AH.S.meta.duration > 0); await p.waitForTimeout(150);
    return p;
  };
  const pick = async (p, label, v) => { await p.selectOption(`select[aria-label=${label}]`, v); await p.waitForTimeout(100); await p.evaluate(() => document.activeElement.blur()); };
  // 平面の値 (v, a) の画面上の位置
  const planeAt = async p => {
    const b = await p.$eval('canvas.plane', c => { const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width }; });
    return (v, a) => [b.x + 26 + (v - 1) / 8 * (b.w - 52), b.y + 26 + (1 - (a - 1) / 8) * (b.w - 52)];
  };
  const trailNow = p => p.evaluate(() => AH.ui.trail(AH.video.currentTime, 1.5, 12, { v: AH._.pen.v, a: AH._.pen.a }).map(x => [x.v, x.a]));

  // ---- 1. 軌跡：書き始める前の値（初期値 5・5）から線を引かない ----
  {
    const p = await open('custom'), at = await planeAt(p);
    await p.evaluate(() => AH.seekTo(2)); await p.waitForTimeout(150);
    await p.evaluate(() => AH.video.play());
    await p.mouse.move(...at(8, 8)); await p.mouse.down(); await p.waitForTimeout(300);
    const first = await trailNow(p);
    await p.mouse.up(); await p.evaluate(() => AH.video.pause());
    await p.evaluate(() => AH.seekTo(6)); await p.waitForTimeout(150);   // 書いた区間の後で、別の位置から書き始める
    await p.evaluate(() => AH.video.play());
    await p.mouse.move(...at(2, 2)); await p.mouse.down(); await p.waitForTimeout(300);
    const second = await trailNow(p);
    await p.mouse.up(); await p.evaluate(() => AH.video.pause());
    check('書き始めの軌跡に 5・5 の点がない', first.length >= 2 && first.every(([v, a]) => v === 8 && a === 8), JSON.stringify(first));
    check('書き直しの軌跡は書き始めた時刻から', second.length >= 2 && second.every(([v, a]) => v === 2 && a === 2), JSON.stringify(second));
    // 再生だけのとき：最初に記録した時刻より前は描かない
    await p.evaluate(() => AH.seekTo(2.5)); await p.waitForTimeout(150);
    const replay = await p.evaluate(() => AH.ui.trail(2.5, 1.5, 12, { v: 8, a: 8 }).map(x => [x.v, x.a]));
    check('再生だけの軌跡も最初の記録より前を描かない', replay.every(([v, a]) => v === 8 && a === 8), JSON.stringify(replay));
    await p.close();
  }

  // ---- 2. 値の刻み：「インタフェース」とは別の「値」で連続・離散を選ぶ ----
  {
    const p = await open('custom');
    const labels = await p.$$eval('.cfgGrid > span', s => s.map(x => x.textContent));
    check('設定欄は「インタフェース」「値」（「表現」ではない）', labels.includes('インタフェース') && labels.includes('値') && !labels.includes('表現'), labels.join(' '));
    // 区間ごと＋四角平面：連続なら小数、離散なら整数
    await pick(p, '時間', 'disc');
    let at = await planeAt(p);
    await p.mouse.click(...at(7.3, 2.6)); await p.waitForTimeout(150);
    const real = await p.evaluate(() => [AH.S.data.cells.v[0], AH.S.data.cells.a[0]]);
    await pick(p, '値', 'int'); at = await planeAt(p);
    await p.evaluate(() => AH.seekTo(1.5)); await p.waitForTimeout(150);
    await p.mouse.click(...at(7.3, 2.6)); await p.waitForTimeout(150);
    const int = await p.evaluate(() => [AH.S.data.cells.v[1], AH.S.data.cells.a[1]]);
    check('区間ごと＋四角平面：値「連続」は小数で入る', Math.abs(real[0] - 7.3) < 0.1 && Math.abs(real[1] - 2.6) < 0.1 && !Number.isInteger(real[0]), JSON.stringify(real));
    check('区間ごと＋四角平面：値「離散」は整数で入る', int[0] === 7 && int[1] === 3, JSON.stringify(int));
    // 時間連続＋円＋離散：書き込む値が整数になる
    await pick(p, '時間', 'cont'); await pick(p, 'インタフェース', 'circle');
    const opt = await p.evaluate(() => AH.S.meta.options.values);
    at = await planeAt(p);
    await p.evaluate(() => AH.seekTo(4)); await p.waitForTimeout(150); await p.evaluate(() => AH.video.play());
    await p.mouse.move(...at(6.4, 6.4)); await p.mouse.down(); await p.mouse.move(...at(7.6, 5.2), { steps: 5 }); await p.waitForTimeout(300); await p.mouse.up();
    await p.evaluate(() => AH.video.pause());
    const vals = await p.evaluate(() => AH.S.data.strokes.flatMap(s => s.samples.flatMap(r => [r[1], r[2]])).filter(x => x !== ''));
    check('時間連続＋円＋離散：書き込みは整数', opt === 'int' && vals.length > 0 && vals.every(Number.isInteger), JSON.stringify({ opt, vals: vals.slice(0, 8) }));
    // スライダー＋区間ごと＋連続
    await pick(p, 'インタフェース', 'sliders'); await pick(p, '時間', 'disc'); await pick(p, '値', 'real');
    const bb = await p.locator('canvas.bars').boundingBox();
    await p.evaluate(() => AH.seekTo(2.5)); await p.waitForTimeout(150);
    await p.mouse.click(bb.x + bb.width * 0.28, bb.y + 34 + (bb.height - 74) * 0.37); await p.waitForTimeout(150);
    const sv = await p.evaluate(() => AH.S.data.cells.v[2]);
    check('スライダー＋区間ごと：値「連続」は小数で入る', sv > 1 && sv < 9 && !Number.isInteger(sv), String(sv));
    // 9×9グリッドは離散だけ（「値」の欄が出ない）
    await pick(p, 'インタフェース', 'grid');
    const g = await p.evaluate(() => ({ values: AH.S.meta.options.values, sel: !!document.querySelector('select[aria-label=値]') }));
    check('9×9グリッドは離散だけ', g.values === 'int' && !g.sel, JSON.stringify(g));
    await p.close();
  }

  // ---- 3. 1軸のとき、もう片方の軸は 5 に固定 ----
  {
    const p = await open('custom');
    await pick(p, '次元', 'v');
    const at = await planeAt(p);
    await p.evaluate(() => AH.seekTo(2)); await p.waitForTimeout(150); await p.evaluate(() => AH.video.play());
    await p.mouse.move(...at(8, 8.5)); await p.mouse.down(); await p.mouse.move(...at(3, 1.5), { steps: 5 }); await p.waitForTimeout(300);
    const pen = await p.evaluate(() => ({ v: AH._.pen.v, a: AH._.pen.a }));
    await p.mouse.up(); await p.evaluate(() => AH.video.pause());
    const r = await p.evaluate(() => ({ a: AH.S.data.points.a.map(x => x.val), v: AH.S.data.points.v.length, now: document.querySelector('.nowRow .a b').textContent }));
    check('快度だけ：覚醒度は 5 に固定（押した位置にかかわらず）', pen.a === 5 && r.a.every(x => x === 5) && r.v > 1 && r.now === '5.00', JSON.stringify({ pen, r }));
    await pick(p, 'インタフェース', 'sliders'); await pick(p, '次元', 'a');
    const sl = await p.evaluate(() => AH.mode.peek());
    check('覚醒度だけ（スライダー）：快度は 5', sl.v === 5, JSON.stringify(sl));
    await p.close();
  }

  // ---- 4. プリセットに AffectRank ----
  {
    const p = await open('custom');
    const has = await p.$$eval('.cfg > select option', os => os.map(o => o.value));
    await p.selectOption('.cfg > select', 'affectrank'); await p.waitForTimeout(200);
    const st = await p.evaluate(() => ({ rep: AH.S.meta.options.rep, model: AH.mode.model, note: document.querySelector('.cfgNote').textContent, btns: document.querySelectorAll('.arBtn').length }));
    await p.evaluate(() => AH.seekTo(3)); await p.waitForTimeout(150);
    await p.click('.arBtn[title="活発・快"]'); await p.keyboard.press('Numpad4');
    const ev = await p.evaluate(() => AH.S.data.events.map(e => [e.label, e.dv, e.da]));
    check('プリセット「AffectRank 相当」', has.includes('affectrank') && st.rep === 'rank8' && st.model === 'events' && /AffectRank/.test(st.note) && st.btns === 8, JSON.stringify(st));
    check('8方向ボタンとテンキーで変化の方向が入る', JSON.stringify(ev) === '[["活発・快",1,1],["不快",-1,0]]', JSON.stringify(ev));
    await pick(p, '次元', 'v');
    const n1 = await p.evaluate(() => [...document.querySelectorAll('.arBtn')].map(b => b.title));
    check('8方向ボタン＋快度だけ：快・不快の2方向', n1.join() === '快,不快', n1.join());
    await p.close();
  }

  // ---- 5. 変化ボタン ----
  {
    const p = await open('change');
    await p.evaluate(() => AH.seekTo(2)); await p.waitForTimeout(150);
    await p.click('.chgBtn');
    await p.evaluate(() => AH.seekTo(5)); await p.waitForTimeout(150);
    await p.keyboard.press('Enter');
    await p.evaluate(() => AH.seekTo(7)); await p.waitForTimeout(150);
    await p.keyboard.press('Enter'); await p.keyboard.press('Backspace');   // 直近を取り消す
    const ev = await p.evaluate(() => AH.S.data.events.map(e => [e.t, e.label]));
    check('変化ボタン：クリック・Enter で押した時刻が入り、Backspace で直近を消す', JSON.stringify(ev) === '[[2,"change"],[5,"change"]]', JSON.stringify(ev));
    const dls = []; p.on('download', d => dls.push(d)); await p.click('#exportBtn'); await p.waitForTimeout(1200);
    const names = dls.map(d => d.suggestedFilename());
    const bins = dls.find(d => d.suggestedFilename().endsWith('_bins.csv'));
    const txt = bins ? require('fs').readFileSync(await bins.path(), 'utf8').split('\n') : [];
    check('変化ボタン：_ranks.csv と区間ごとの回数（_bins.csv）を書き出す', names.some(n => n.endsWith('_ranks.csv')) && /n_changes/.test(txt[0]) && txt.slice(1).filter(l => l).map(l => +l.split(',')[4]).reduce((a, b) => a + b, 0) === 2, JSON.stringify({ names, head: txt[0] }));
    await p.close();
  }

  console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
