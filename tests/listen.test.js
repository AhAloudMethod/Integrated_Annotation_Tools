// 聴いてから入力（core/listen.js）：区間の終わりで自動で止まり、Enter／ボタン0 で同じ区間を再生し直して連続の入力を記録し、そのまま次の区間を聴く
const { chromium } = require('playwright-core');
const fs = require('fs');
const { URL, VID, BROWSER } = require('./_env');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
const JOY = 'Test Joystick (Vendor: 1234 Product: 0001)';

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true });
  await ctx.addInitScript(() => {
    localStorage.setItem('ahann_pad_square', '0');   // スティックを四角に広げない（線形の対応を確かめる。広げる処理は display.test.js）
    window.__pads = [];
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => { const a = [null, null, null, null]; for (const p of window.__pads) a[p.index] = p; return a; } });
    window.__connect = (id, index) => { const p = { id, index, connected: true, mapping: '', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 8 }, () => ({ pressed: false, touched: false, value: 0 })) }; window.__pads.push(p); return p; };
  });
  const open = async mode => {
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss());
    await p.goto(URL); await p.evaluate(() => localStorage.setItem('ahann_listen', '1')); await p.reload();
    await p.selectOption('#mode', mode); await p.setInputFiles('#file', VID);
    await p.waitForFunction(() => AH.S.meta.duration > 0); await p.evaluate(() => document.activeElement && document.activeElement.blur());
    return p;
  };
  // 再生して、区間の終わりで止まるのを待つ
  const playToPause = async p => {
    await p.keyboard.press('Space'); await p.waitForFunction(() => !AH.video.paused, null, { timeout: 3000 }).catch(() => {});
    await p.waitForFunction(() => AH.video.paused, null, { timeout: 4000 });
    await p.waitForTimeout(80);
    return p.evaluate(() => AH.video.currentTime);
  };
  // 区間0を記録し終え、区間1を聴いて止まるのを待つ
  const recDone = p => p.waitForFunction(() => AH.video.paused && AH.video.currentTime > 1.5, null, { timeout: 5000 }).then(() => p.waitForTimeout(80));
  const pts = (p, ax) => p.evaluate(ax => AH.S.data.points[ax].map(q => [q.t, q.val]), ax);
  const strokes = p => p.evaluate(() => AH.S.data.strokes.map(s => ({ src: s.source, pad: s.pad, axes: s.axes, t0: s.t_start, t1: s.t_end, end: s.end_reason, n: s.samples.length })));
  const nowTxt = p => p.evaluate(() => [...document.querySelectorAll('.nowRow b')].map(b => b.textContent).join('/'));

  // ---- EMuJoy（マウス）
  {
    const p = await open('emujoy');
    const t1 = await playToPause(p);
    const box = await p.evaluate(() => ({ listen: !document.getElementById('listenBox').hidden, text: document.getElementById('listenBox').textContent, arm: !document.getElementById('armBox').hidden }));
    check('区間の終わりの手前で自動で止まる（聴いた区間＝区間0）', Math.abs(t1 - 0.998) < 0.003, String(t1));
    check('ヘッダーに入力の案内が出て、記録ボタンは出ない', box.listen && /Enter/.test(box.text) && !box.arm, JSON.stringify(box));
    const b = await p.locator('canvas.plane').boundingBox();
    await p.mouse.click(b.x + b.width * 0.75, b.y + b.height * 0.25); await p.waitForTimeout(100);
    const afterClick = await pts(p, 'v'), shown = await nowTxt(p);
    check('止まっている間のクリックは点を置かず、画面の値だけ動く', afterClick.length === 1 && afterClick[0][1] === 5 && shown !== '5.00/5.00', JSON.stringify(afterClick) + ' ' + shown);
    const pv = +shown.split('/')[0];
    await p.keyboard.press('Enter'); await p.waitForTimeout(120);
    const rec = await p.evaluate(() => ({ t: AH.video.currentTime, playing: !AH.video.paused, armed: AH.S.armed, text: document.getElementById('listenBox').textContent }));
    check('Enter で同じ区間を始めから音声つきで再生し直し、記録する', rec.playing && rec.t < 0.5 && rec.armed && /入力中/.test(rec.text), JSON.stringify(rec));
    await p.waitForTimeout(250);
    await p.mouse.move(b.x + b.width * 0.75, b.y + b.height * 0.25); await p.mouse.down();
    await p.mouse.move(b.x + b.width * 0.25, b.y + b.height * 0.75, { steps: 5 }); await p.waitForTimeout(150); await p.mouse.up();
    await recDone(p);
    const v = await pts(p, 'v'), st = await strokes(p), after = await p.evaluate(() => ({ t: AH.video.currentTime, armed: AH.S.armed, log: AH.S.log.filter(l => /^listen_/.test(l.type)).map(l => l.type + ':' + l.detail).join(',') }));
    const inBin = v.filter(q => q[0] < 1);
    check('記録中の連続の入力が区間0に入る（始めは止まっている間に決めた値、途中で動かした値も）', inBin[0][0] === 0 && inBin[0][1] === pv && inBin.some(q => q[1] < 4) && inBin.length >= 3, JSON.stringify(v));
    check('区間の終わりで記録を終え（end_reason=listen）、止まらずに次の区間を聴き、その終わりで止まる', st.length === 1 && st[0].end === 'listen' && st[0].t0 === 0 && st[0].t1 < 1.001 && !after.armed && Math.abs(after.t - 1.998) < 0.003 && /listen_record:sec=0,listen_record_end:sec=0,listen_pause:sec=1/.test(after.log), JSON.stringify({ st, after }));
    check('聴いている間（区間1）は書き込まれない', !v.some(q => q[0] >= 1), JSON.stringify(v));
    // Space：記録せずに次の区間へ
    await p.keyboard.press('Space'); await p.waitForFunction(() => AH.video.paused && AH.video.currentTime > 2.5, null, { timeout: 4000 }); await p.waitForTimeout(80);
    check('Space は記録せずに次の区間を聴く', (await strokes(p)).length === 1, String(await p.evaluate(() => AH.video.currentTime)));
    // R：聴いた区間をもう一度（記録しない）
    await p.keyboard.press('KeyR'); await p.waitForTimeout(120);
    const rStart = await p.evaluate(() => ({ t: AH.video.currentTime, playing: !AH.video.paused, armed: AH.S.armed }));
    await p.waitForFunction(() => AH.video.paused, null, { timeout: 4000 }); await p.waitForTimeout(80);
    const rEnd = await p.evaluate(() => AH.video.currentTime);
    check('R で聴いた区間の始めから再生し（記録しない）、終わりでまた止まる', rStart.playing && !rStart.armed && rStart.t >= 2 && rStart.t < 2.5 && Math.abs(rEnd - 2.998) < 0.003 && (await strokes(p)).length === 1, JSON.stringify([rStart, rEnd]));
    await p.close();
  }

  // ---- スロットル（キー）：記録中にキーで連続に動かす。記録中に Space で止めると記録を終える
  {
    const p = await open('throttle');
    await playToPause(p);
    await p.keyboard.press('Enter'); await p.waitForTimeout(100);
    await p.keyboard.down('KeyW'); await p.waitForTimeout(500); await p.keyboard.up('KeyW');
    await recDone(p);
    const v = (await pts(p, 'v')).filter(q => q[0] < 1);
    check('スロットル：記録中に押している間、値が連続に上がっていく（区間0の中に複数の点）', v.length >= 4 && v[v.length - 1][1] > 5.3 && v.every((q, i) => !i || q[1] >= v[i - 1][1]), JSON.stringify(v));
    await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    await p.keyboard.press('Space'); await p.waitForTimeout(150);
    const r = await p.evaluate(() => ({ paused: AH.video.paused, armed: AH.S.armed, end: AH.S.data.strokes.map(s => s.end_reason).join(',') }));
    check('記録中に Space で止めると、そこで記録を終える', r.paused && !r.armed && r.end === 'listen,pause', JSON.stringify(r));
    await p.close();
  }

  // ---- DARMA（ジョイスティック）：ボタン0で記録、スティックの動きがそのまま入る
  {
    const p = await open('darma');
    await p.evaluate(id => window.__connect(id, 0), JOY); await p.waitForTimeout(150);
    await playToPause(p);
    await p.evaluate(() => { window.__pads[0].axes[0] = 0.5; window.__pads[0].axes[1] = -0.5; }); await p.waitForTimeout(100);
    const shown = await nowTxt(p);
    check('DARMA：止まっている間はスティックの位置を映し、書き込まない', shown === '7.00/7.00' && (await pts(p, 'v')).length === 1, shown);
    await p.evaluate(() => { window.__pads[0].buttons[0].pressed = true; }); await p.waitForTimeout(120);
    await p.evaluate(() => { window.__pads[0].buttons[0].pressed = false; }); await p.waitForTimeout(300);
    await p.evaluate(() => { window.__pads[0].axes[0] = 0; window.__pads[0].axes[1] = 0; });
    await recDone(p);
    const v = (await pts(p, 'v')).filter(q => q[0] < 1), st = await strokes(p);
    check('DARMA：ボタン0で記録し、スティックの動き（7 → 離して 5）が区間0に入る（source=gamepad）', v[0][0] === 0 && v[0][1] === 7 && v.some(q => q[0] > 0.2 && q[1] === 5) && st[0].src === 'gamepad' && st[0].pad.joy === JOY, JSON.stringify({ v, st }));
    // 書き出しの meta.listen と操作ログ
    const dl = []; p.on('download', d => dl.push(d));
    await p.click('#exportBtn'); await p.waitForTimeout(1200);
    const js = dl.find(d => d.suggestedFilename().endsWith('_session.json'));
    const ses = JSON.parse(fs.readFileSync(await js.path(), 'utf8').replace(/^﻿/, ''));
    check('書き出しの meta.listen.on と操作ログの listen_record', ses.meta.listen && ses.meta.listen.on === true && ses.log.some(l => l.type === 'listen_record' && /sec=0/.test(l.detail)), JSON.stringify(ses.meta.listen));
    // 設定でオフにすると、止まらずに記録オンの方式に戻る
    await p.click('#setBtn'); await p.uncheck('#listenMode'); await p.click('#setBtn'); await p.waitForTimeout(100);
    await p.keyboard.press('Space'); await p.waitForTimeout(1400);
    const off = await p.evaluate(() => ({ playing: !AH.video.paused, arm: !document.getElementById('armBox').hidden, listen: !document.getElementById('listenBox').hidden, saved: localStorage.getItem('ahann_listen'), log: AH.S.log.some(l => l.type === 'listen_mode' && l.value === 'off') }));
    await p.keyboard.press('Space');
    check('設定でオフにすると区間の終わりで止まらず、記録ボタンが戻る（保存・操作ログ）', off.playing && off.arm && !off.listen && off.saved === '0' && off.log, JSON.stringify(off));
    await p.evaluate(() => localStorage.setItem('ahann_listen', '1'));
    await p.close();
  }

  // ---- 表の方式（Excel）には効かない
  {
    const p = await open('excel');
    await p.keyboard.press('Space'); await p.waitForTimeout(1400);
    const r = await p.evaluate(() => ({ playing: !AH.video.paused, listen: !document.getElementById('listenBox').hidden }));
    check('Excel（表の方式）では止まらず、案内も出ない', r.playing && !r.listen, JSON.stringify(r));
    await p.close();
  }

  // 他のテストに設定を残さない
  { const p = await ctx.newPage(); await p.goto(URL); await p.evaluate(() => localStorage.removeItem('ahann_listen')); await p.close(); }
  console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
