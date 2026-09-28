// 画面の配置：1画面に収まるか（ページがスクロールしない）、動画の別窓（キーの転送・閉じたら戻る）
const { chromium } = require('playwright-core');
const { URL, VID, BROWSER } = require('./_env');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const errs = [];
  // 1画面に収まるか（ノートPCでよくある大きさ）
  for (const [W, H] of [[1366, 768], [1536, 864], [1920, 1080]]) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    const bad = [];
    for (const mode of ['key', 'emujoy', 'feeltrace', 'rcea', 'darma', 'throttle', 'halolight', 'carma', 'ranktrace', 'excel', 'affectgrid', 'sam', 'affectrank', 'custom']) {
      for (const tl of [false, true]) {
        const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss());
        await p.goto(URL); await p.selectOption('#mode', mode); await p.setInputFiles('#file', VID);
        await p.waitForFunction(() => AH.S.meta.duration > 0); await p.evaluate(on => AH._.setTimeline(on), tl); await p.waitForTimeout(150);
        const r = await p.evaluate(() => ({ page: document.documentElement.scrollHeight, vh: innerHeight, hw: document.querySelector('header').scrollWidth, vw: innerWidth }));
        if (r.page > r.vh || r.hw > r.vw) bad.push(`${mode}${tl ? '+グラフ' : ''} ${JSON.stringify(r)}`);
        await p.close();
      }
    }
    check(`${W}x${H} で全方式が1画面に収まる`, !bad.length, bad.join(' / '));
    await ctx.close();
  }
  // 動画の別窓
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss());
  await p.goto(URL); await p.selectOption('#mode', 'key'); await p.setInputFiles('#file', VID); await p.waitForFunction(() => AH.S.meta.duration > 0);
  const [pop] = await Promise.all([p.waitForEvent('popup'), p.click('#vwinBtn')]);
  await p.waitForTimeout(300);
  const moved = await p.evaluate(() => AH.video.ownerDocument !== document && document.body.classList.contains('vwin'));
  await pop.keyboard.press('Space'); await p.waitForTimeout(500); await pop.keyboard.press('Space');
  await pop.keyboard.press('Digit7');                                   // 別窓で押したキーが評価側に届く
  const st = await p.evaluate(() => ({ t: AH.video.currentTime, paused: AH.video.paused, v: AH.S.data.points.v.map(x => x.val) }));
  check('別窓に動画が移る', moved);
  check('別窓のキー操作が効く（再生・停止・入力）', st.t > 0.2 && st.paused && st.v.includes(7), JSON.stringify(st));
  await pop.close(); await p.waitForTimeout(800);
  const back = await p.evaluate(() => ({ back: AH.video.parentElement.id === 'stage', cls: document.body.className, log: AH.S.log.filter(l => l.type === 'video_window').map(l => l.value).join(',') }));
  check('別窓を閉じると動画が戻る', back.back && !back.cls.includes('vwin') && back.log === 'on,off', JSON.stringify(back));
  // ボタンで戻す
  const [pop2] = await Promise.all([p.waitForEvent('popup'), p.click('#vwinBtn')]);
  await p.waitForTimeout(300); await p.click('#vwinBtn'); await p.waitForTimeout(300);
  check('ボタンで動画を戻す', await p.evaluate(() => AH.video.parentElement.id === 'stage') && pop2.isClosed());
  console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
