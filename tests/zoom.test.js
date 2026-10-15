// 評価グラフの時間軸のズーム（core/timeline.js）：Ctrl+ホイールでカーソル位置を中心に拡大・縮小し、Shift+ホイールと横スワイプで横にスクロールする。
// 修飾キーなしのホイールではズームしない。拡大中もなぞった値・シークは見えている時刻に効く
const { chromium } = require('playwright-core');
const { URL, VID, BROWSER } = require('./_env');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const errs = [];
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss());
  await p.goto(URL); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('ahann_tl', '1'); localStorage.setItem('ahann_f0', '0'); }); await p.reload();
  await p.selectOption('#mode', 'feeltrace');
  await p.setInputFiles('#file', VID); await p.waitForFunction(() => AH.S.meta.duration > 0); await p.waitForTimeout(200);

  const view = () => p.evaluate(() => AH.tlView());
  const box = await p.evaluate(() => { const c = document.getElementById('tl'), r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: c.clientWidth, h: c.clientHeight }; });
  // 画面の x と時刻の変換（core/timeline.js の geom と同じ。左 44 px・右 8 px は余白）
  const xOf = (V, t) => box.x + 44 + (t - V.t0) / (V.t1 - V.t0) * (box.w - 52);
  const tOf = (V, x) => V.t0 + (x - box.x - 44) / (box.w - 52) * (V.t1 - V.t0);
  const laneV = v => { const H2 = box.h - 28, y0 = 8, y1 = H2 / 2 - 8; return box.y + y1 - (v - 1) / 8 * (y1 - y0); };

  const D = await p.evaluate(() => AH.S.meta.duration);
  const v0 = await view();
  check('最初は動画全体を表示する', Math.abs(v0.t0) < 1e-6 && Math.abs(v0.t1 - D) < 1e-6, JSON.stringify({ v0, D }));

  // 修飾キーなしのホイールではズームしない
  const cx = xOf(v0, D * 0.4), cy = laneV(5);
  await p.mouse.move(cx, cy); await p.mouse.wheel(0, -300); await p.waitForTimeout(100);
  const v1 = await view();
  check('修飾キーなしのホイールではズームしない', JSON.stringify(v1) === JSON.stringify(v0), JSON.stringify(v1));

  // Ctrl+ホイール：カーソル位置の時刻を固定したまま拡大する
  const tc = tOf(v0, cx);
  await p.keyboard.down('Control'); for (let i = 0; i < 3; i++) await p.mouse.wheel(0, -100); await p.keyboard.up('Control'); await p.waitForTimeout(100);
  const v2 = await view();
  check('Ctrl+ホイールで拡大し、カーソル位置の時刻は動かない', v2.t1 - v2.t0 < D * 0.8 && Math.abs(tOf(v2, cx) - tc) < 0.02, JSON.stringify({ v2, tc, now: tOf(v2, cx) }));

  // 拡大しても表示の幅は 1 秒より狭くならない
  await p.keyboard.down('Control'); for (let i = 0; i < 60; i++) await p.mouse.wheel(0, -100); await p.keyboard.up('Control'); await p.waitForTimeout(100);
  const v3 = await view();
  check('拡大は表示の幅 1 秒で止まる', Math.abs(v3.t1 - v3.t0 - 1) < 1e-6 && v3.t0 >= 0 && v3.t1 <= D, JSON.stringify(v3));
  // 少し縮小して数秒の幅にする
  await p.keyboard.down('Control'); for (let i = 0; i < 5; i++) await p.mouse.wheel(0, 100); await p.keyboard.up('Control'); await p.waitForTimeout(100);
  const v4 = await view(), span = v4.t1 - v4.t0;

  // Shift+ホイールで横にスクロールする（幅は変えない）。横スワイプ（deltaX）も同じ
  await p.keyboard.down('Shift'); await p.mouse.wheel(0, 100); await p.keyboard.up('Shift'); await p.waitForTimeout(100);
  const v5 = await view();
  check('Shift+ホイールで右へスクロールし、幅は変わらない', v5.t0 > v4.t0 && Math.abs(v5.t1 - v5.t0 - span) < 1e-6, JSON.stringify({ v4, v5 }));
  await p.mouse.wheel(-100, 0); await p.waitForTimeout(100);
  const v6 = await view();
  check('横スワイプ（deltaX）で左へスクロールする', v6.t0 < v5.t0 && Math.abs(v6.t1 - v6.t0 - span) < 1e-6, JSON.stringify({ v5, v6 }));
  await p.keyboard.down('Shift'); for (let i = 0; i < 80; i++) await p.mouse.wheel(0, -200); await p.keyboard.up('Shift'); await p.waitForTimeout(100);
  const v7 = await view();
  check('スクロールは動画の先頭で止まる', Math.abs(v7.t0) < 1e-6 && Math.abs(v7.t1 - span) < 1e-6, JSON.stringify(v7));

  // 拡大中になぞると、見えている時刻に値が入る
  const ta = v7.t0 + span * 0.3, tb = v7.t0 + span * 0.6;
  await p.mouse.move(xOf(v7, ta), laneV(8)); await p.mouse.down(); await p.mouse.move(xOf(v7, tb), laneV(8), { steps: 12 }); await p.mouse.up(); await p.waitForTimeout(150);
  const got = await p.evaluate(([a, b]) => [AH.valueAt('v', (a + b) / 2), AH.valueAt('v', b + 0.3)], [ta, tb]);
  check('拡大中になぞった値が、見えている時刻に入る', Math.abs(got[0] - 8) < 0.2 && Math.abs(got[1] - 8) > 1, JSON.stringify({ ta, tb, got }));

  // 目盛りの帯を押すと、見えている時刻へシークする
  const ts = v7.t0 + span * 0.5;
  await p.mouse.click(xOf(v7, ts), box.y + box.h - 10); await p.waitForTimeout(200);
  const cur = await p.evaluate(() => AH.video.currentTime);
  check('拡大中に目盛りを押すと、見えている時刻へシークする', Math.abs(cur - ts) < 0.1, JSON.stringify({ ts, cur }));

  // 縮小しきると動画全体に戻る
  await p.keyboard.down('Control'); for (let i = 0; i < 80; i++) await p.mouse.wheel(0, 200); await p.keyboard.up('Control'); await p.waitForTimeout(100);
  const v8 = await view();
  check('縮小しきると動画全体の表示に戻る', Math.abs(v8.t0) < 1e-6 && Math.abs(v8.t1 - D) < 1e-6, JSON.stringify(v8));

  // 動画を読み込み直すと全体表示に戻る
  await p.keyboard.down('Control'); for (let i = 0; i < 5; i++) await p.mouse.wheel(0, -100); await p.keyboard.up('Control'); await p.waitForTimeout(100);
  await p.setInputFiles('#file', VID); await p.waitForTimeout(600);
  const v9 = await view();
  check('動画を読み込み直すと全体表示に戻る', Math.abs(v9.t0) < 1e-6 && Math.abs(v9.t1 - D) < 1e-6, JSON.stringify(v9));

  // ブラウザのページの拡大（Ctrl+ホイール）は起きない
  check('グラフ上の Ctrl+ホイールでページは拡大しない', await p.evaluate(() => window.visualViewport.scale === 1 && window.devicePixelRatio === 1));

  console.log('errors:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
