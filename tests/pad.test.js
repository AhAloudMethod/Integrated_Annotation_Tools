// ゲームパッド（ジョイスティック・スライダー）：偽の機器で試す。
// navigator.getGamepads を上書きし、window.__pads（複数台）を返す。テストから __pads[k].axes・buttons を書き換えて動きを確かめる
const { chromium } = require('playwright-core');
const { URL, VID, BROWSER, out } = require('./_env');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
const JOY = 'Test Joystick (Vendor: 1234 Product: 0001)', SLD = 'Test Sliders (Vendor: 1234 Product: 0002)';

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  const newCtx = async (vp = { width: 1366, height: 768 }) => {
    const ctx = await browser.newContext({ viewport: vp, acceptDownloads: true });
    await ctx.addInitScript(() => {
      window.__pads = [];
      window.__mkPad = (id, index, nAxes = 4, nBtn = 8) => ({ id, index, connected: true, mapping: '', timestamp: 0,
        axes: Array(nAxes).fill(0), buttons: Array.from({ length: nBtn }, () => ({ pressed: false, touched: false, value: 0 })) });
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => { const a = [null, null, null, null]; for (const p of window.__pads) a[p.index] = p; return a; } });
      // 機器をつなぐ（gamepadconnected も出す）
      window.__connect = (id, index, nAxes, nBtn) => { const p = window.__mkPad(id, index, nAxes, nBtn); window.__pads.push(p); const e = new Event('gamepadconnected'); e.gamepad = p; window.dispatchEvent(e); return p; };
      window.__disconnect = index => { const k = window.__pads.findIndex(p => p.index === index); const [p] = window.__pads.splice(k, 1); p.connected = false; const e = new Event('gamepaddisconnected'); e.gamepad = p; window.dispatchEvent(e); };
    });
    return ctx;
  };
  const ctx = await newCtx();
  const open = async (mode, c = ctx) => {
    const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss());
    await p.goto(URL); await p.selectOption('#mode', mode); await p.setInputFiles('#file', VID);
    await p.waitForFunction(() => AH.S.meta.duration > 0); await p.evaluate(() => document.activeElement && document.activeElement.blur());
    return p;
  };
  const axes = (p, k, a) => p.evaluate(([k, a]) => { for (const [i, x] of Object.entries(a)) window.__pads[k].axes[+i] = x; }, [k, a]);
  const btn = async (p, k, i) => {   // 押して離す
    await p.evaluate(([k, i]) => { window.__pads[k].buttons[i].pressed = true; }, [k, i]); await p.waitForTimeout(120);
    await p.evaluate(([k, i]) => { window.__pads[k].buttons[i].pressed = false; }, [k, i]); await p.waitForTimeout(120);
  };
  const play = async (p, ms) => { await p.keyboard.press('Space'); await p.waitForTimeout(ms); await p.keyboard.press('Space'); await p.waitForTimeout(100); };
  const st = p => p.evaluate(() => ({ wm: AH.mode.writeMode(), armed: AH.S.armed, armBox: !document.getElementById('armBox').hidden,
    strokes: AH.S.data.strokes.map(s => ({ src: s.source, pad: s.pad, axes: s.axes, n: s.samples.length, last: s.samples[s.samples.length - 1] })) }));
  const sample = p => p.evaluate(() => { const s = AH.mode.sample(); return { v: s.v, a: s.a, pad: s.pad }; });
  const nowTxt = p => p.evaluate(() => [...document.querySelectorAll('.nowRow b')].map(b => b.textContent).join('/'));

  // ---- マウスだけ（機器なし）：押している間の記録のまま
  {
    const p = await open('emujoy');
    const s = await st(p);
    check('機器なし：EMuJoy は押している間（hold）', s.wm === 'hold' && !s.armBox, JSON.stringify(s));
    await p.close();
  }

  // ---- ジョイスティック：EMuJoy・RCEA・FEELTRACE・DARMA
  for (const [mode, x, y, ev, ea] of [['emujoy', 0.5, -0.5, 7, 7], ['rcea', 1, -1, 7.83, 7.83], ['feeltrace', -1, 1, 2.17, 2.17], ['darma', -0.5, 0.5, 3, 3]]) {
    const p = await open(mode);
    await p.evaluate(id => window.__connect(id, 0), JOY); await p.waitForTimeout(150);
    const s0 = await st(p);
    check(`${mode}：ジョイスティックをつなぐと記録オン（armed）の方式になり、記録ボタンが出る`, s0.wm === 'armed' && s0.armBox, JSON.stringify(s0));
    await axes(p, 0, { 0: x, 1: y }); await p.waitForTimeout(150);
    const v = await sample(p), shown = await nowTxt(p);
    check(`${mode}：スティックの位置がそのまま値（${ev}/${ea}）・画面の点も動く`, Math.abs(v.v - ev) < 0.02 && Math.abs(v.a - ea) < 0.02 && v.pad === 'joy' && shown === `${ev.toFixed(2)}/${ea.toFixed(2)}`, JSON.stringify(v) + ' ' + shown);
    // 記録オフで再生：書き込まれない
    await play(p, 400);
    check(`${mode}：記録オフでは書き込まれない`, (await st(p)).strokes.length === 0);
    // 記録オン（R）＋再生：書き込まれ、source=gamepad
    await p.keyboard.press('KeyR'); await play(p, 500); await p.keyboard.press('KeyR');
    const s1 = await st(p), k = s1.strokes[0];
    check(`${mode}：記録オン＋再生で書き込まれる（source=gamepad・機器名つき）`, s1.strokes.length === 1 && k.src === 'gamepad' && k.pad.joy === JOY && Math.abs(k.last[1] - ev) < 0.02 && Math.abs(k.last[2] - ea) < 0.02, JSON.stringify(s1.strokes));
    // 離すと中立
    await axes(p, 0, { 0: 0.05, 1: -0.03 }); await p.waitForTimeout(100);
    const n = await sample(p);
    check(`${mode}：離すと（遊びの中）中立 5・5`, n.v === 5 && n.a === 5, JSON.stringify(n));
    if (mode === 'emujoy') {
      // マウス：スティックが遊びの中ならマウスで動かせる。スティックを倒すとスティックが優先
      const b = await p.locator('canvas.plane').boundingBox();
      await p.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.8); await p.mouse.down(); await p.waitForTimeout(100);
      const m1 = await sample(p);
      await axes(p, 0, { 0: 0.5, 1: 0 }); await p.waitForTimeout(100);
      const m2 = await sample(p);
      await p.mouse.up(); await axes(p, 0, { 0: 0, 1: 0 });
      check('EMuJoy：スティックが遊びの中ならマウス、倒すとスティックが優先', m1.v < 4 && m1.a < 4 && !m1.pad && m2.v === 7 && m2.a === 5, JSON.stringify([m1, m2]));
      // ボタン0で記録のオン／オフ
      await btn(p, 0, 0); const a1 = (await st(p)).armed;
      await btn(p, 0, 0); const a2 = (await st(p)).armed;
      await btn(p, 0, 1); const a3 = (await st(p)).armed;
      check('ボタン0で記録オン／オフが切り替わる（他のボタンでは変わらない）', a1 === true && a2 === false && a3 === false, JSON.stringify([a1, a2, a3]));
      // 記録オンのまま機器を外すと、記録オフになり押している間の方式に戻る
      await p.keyboard.press('KeyR'); await p.evaluate(() => window.__disconnect(0)); await p.waitForTimeout(150);
      const s2 = await st(p);
      const log = await p.evaluate(() => AH.S.log.filter(l => /^pad_/.test(l.type)).map(l => l.type + ':' + l.value));
      check('機器を外すと記録オフ・hold に戻る', !s2.armed && s2.wm === 'hold' && !s2.armBox, JSON.stringify(s2));
      check('操作ログに接続・切断と機器名が残る', log.includes('pad_connect:' + JOY) && log.includes('pad_disconnect:' + JOY), JSON.stringify(log));
    }
    await p.screenshot({ path: out(`shot_pad_${mode}.png`) });
    await p.close();
  }

  // ---- スライダー：スロットル（2本）
  {
    const p = await open('throttle');
    await p.evaluate(id => window.__connect(id, 0), SLD); await p.waitForTimeout(150);
    const peek = () => p.evaluate(() => AH.mode.peek());
    const c0 = await peek();
    check('スロットル：つないだだけでは値は変わらない', c0.v === 5 && c0.a === 5, JSON.stringify(c0));
    await axes(p, 0, { 2: 0.5, 3: -0.5 }); await p.waitForTimeout(150);
    const c1 = await peek();
    check('スロットル：スライダーの位置がそのまま値（1本目＝横軸 7、2本目＝縦軸 3）', c1.v === 7 && c1.a === 3, JSON.stringify(c1));
    // 記録オフで再生しながら動かす：表示が動き、記録されない
    await p.keyboard.press('Space'); await p.waitForTimeout(200);
    await axes(p, 0, { 2: 1 }); await p.waitForTimeout(300);
    const c2 = await peek(); await p.keyboard.press('Space'); await p.waitForTimeout(100);
    const pts = await p.evaluate(() => AH.S.data.points.v.length + AH.S.data.points.a.length);
    check('スロットル：記録オフで動かすと表示が動き（9）、記録されない', c2.v === 9 && pts === 2, JSON.stringify(c2) + ' points=' + pts);
    // 記録オン＋再生：書き込まれる
    await axes(p, 0, { 2: 0.5 }); await p.waitForTimeout(100);
    await p.keyboard.press('KeyR'); await play(p, 500); await p.keyboard.press('KeyR');
    const s = await st(p), k = s.strokes[0];
    check('スロットル：記録オンで書き込まれる（source=gamepad）', s.strokes.length === 1 && k.src === 'gamepad' && k.pad.slider === SLD && k.last[1] === 7 && k.last[2] === 3, JSON.stringify(s.strokes));
    // キーはスライダーが最後に動いた後に押せばキーが優先
    await p.keyboard.down('KeyW'); await p.waitForTimeout(300); await p.keyboard.up('KeyW'); await p.waitForTimeout(150);
    const c3 = await peek();
    await axes(p, 0, { 2: -1 }); await p.waitForTimeout(150);
    const c4 = await peek();
    check('スロットル：キーを押すとキーで動き、スライダーを動かすとまたスライダー', c3.v > 7.5 && c3.a === 3 && c4.v === 1, JSON.stringify([c3, c4]));
    // シークすると、動かしていないスライダーは手放して記録済みの値に追従する
    await p.evaluate(() => AH.seekTo(0.2)); await p.waitForTimeout(250);
    const c5 = await peek(), rec = await p.evaluate(() => ({ v: AH.valueAt('v', AH.video.currentTime), a: AH.valueAt('a', AH.video.currentTime) }));
    check('スロットル：シークすると記録済みの値に追従する', c5.v === rec.v && c5.a === rec.a, JSON.stringify([c5, rec]));
    await p.screenshot({ path: out('shot_pad_throttle.png') });
    await p.close();
  }

  // ---- スライダー：CARMA（評価している軸の回に1本目）
  {
    const p = await open('carma');
    await p.evaluate(id => window.__connect(id, 0), SLD); await p.waitForTimeout(150);
    await axes(p, 0, { 2: 0.75, 3: -1 }); await p.waitForTimeout(150);
    const c1 = await p.evaluate(() => AH.mode.peek());
    check('CARMA：1本目の位置がそのまま値（8）', c1.v === 8, JSON.stringify(c1));
    await p.keyboard.press('KeyR'); await play(p, 500); await p.keyboard.press('KeyR');
    const s = await st(p), k = s.strokes[0];
    check('CARMA：記録オンで書き込まれる（source=gamepad）', s.strokes.length === 1 && k.src === 'gamepad' && k.axes === 'v' && k.last[1] === 8, JSON.stringify(s.strokes));
    // 覚醒度の回でも1本目
    await p.check('input[name=pass][value=a]'); await p.evaluate(() => document.activeElement.blur());
    await axes(p, 0, { 2: -0.25 }); await p.waitForTimeout(150);
    const c2 = await p.evaluate(() => AH.mode.peek());
    check('CARMA：覚醒度の回も1本目（4）', c2.a === 4, JSON.stringify(c2));
    await p.close();
  }

  // ---- カスタム：スライダー（1本目・2本目を横・縦に）と平面（ジョイスティック）
  {
    const p = await open('custom');
    await p.evaluate(id => { window.__connect(id, 0); }, JOY); await p.waitForTimeout(150);
    const s0 = await st(p);
    await axes(p, 0, { 0: 0.5, 1: 0.5 }); await p.waitForTimeout(120);
    const v0 = await sample(p);
    check('カスタム（平面・マウス）：ジョイスティックで armed・位置＝値', s0.wm === 'armed' && v0.v === 7 && v0.a === 3 && v0.pad === 'joy', JSON.stringify([s0.wm, v0]));
    await axes(p, 0, { 0: 0, 1: 0 });
    await p.selectOption('select[aria-label=表現]', 'sliders'); await p.evaluate(() => document.activeElement.blur());
    await axes(p, 0, { 2: -0.5, 3: 0.25 }); await p.waitForTimeout(150);
    const c1 = await p.evaluate(() => ({ wm: AH.mode.writeMode(), ...AH.mode.peek() }));
    check('カスタム（スライダー・マウス）：スライダーの機器で armed・1本目＝横 3、2本目＝縦 6', c1.wm === 'armed' && c1.v === 3 && c1.a === 6, JSON.stringify(c1));
    await p.keyboard.press('KeyR'); await play(p, 400); await p.keyboard.press('KeyR');
    const s = await st(p);
    check('カスタム（スライダー）：記録オンで書き込まれる（source=gamepad）', s.strokes.length === 1 && s.strokes[0].src === 'gamepad' && s.strokes[0].last[1] === 3, JSON.stringify(s.strokes));
    await p.close();
  }

  // ---- 2台（ジョイスティックとスライダーが別の機器）
  {
    const p = await open('throttle');
    await p.evaluate(([a, b]) => { window.__connect(b, 0); window.__connect(a, 1); }, [JOY, SLD]); await p.waitForTimeout(150);
    // 最初はジョイスティック・スライダーとも0番の機器。1番のスティックを倒すとジョイスティックが1番に、0番のスライダーを動かすと…（0番のまま）
    await axes(p, 1, { 0: 0.8 }); await p.waitForTimeout(100); await axes(p, 1, { 0: 0 });
    await axes(p, 0, { 2: 0.5, 3: 0.5 }); await p.waitForTimeout(150);
    const r = await p.evaluate(() => ({ joy: AH.padJoy() && AH.padJoy().id, sl: AH.padSliders() && AH.padSliders().id, ...AH.mode.peek() }));
    check('2台：スティックを倒した機器がジョイスティック、スライダーを動かした機器がスライダー', r.joy === JOY && r.sl === SLD && r.v === 7 && r.a === 7, JSON.stringify(r));
    // ジョイスティックの機器の軸2・3が動いても（揺れ）、別の機器のスライダーはそのまま
    await axes(p, 1, { 2: 0.1 }); await p.waitForTimeout(100);
    const r2 = await p.evaluate(() => AH.padSliders().id);
    check('2台：小さな揺れではスライダーの機器は変わらない', r2 === SLD, r2);
    // 設定パネルの機器欄：機器名と軸の値
    await p.click('#setBtn'); await p.waitForTimeout(300);
    const panel = await p.evaluate(() => ({ text: document.getElementById('padList').innerText, n: document.querySelectorAll('#padList .padDev').length,
      ax: [...document.querySelectorAll('#padList .padDev[data-index="0"] .padAxV')].map(e => e.textContent) }));
    check('設定パネルに機器名と軸の値が出る', panel.n === 2 && panel.text.includes(JOY) && panel.text.includes(SLD) && panel.ax.join(',') === '0.00,0.00,0.50,0.50', JSON.stringify(panel));
    await axes(p, 0, { 2: -0.25 }); await p.evaluate(() => { window.__pads[0].buttons[3].pressed = true; }); await p.waitForTimeout(300);
    const upd = await p.evaluate(() => ({ ax: document.querySelector('#padList .padDev[data-index="0"] .padAx[data-axis="2"] .padAxV').textContent, on: document.querySelectorAll('#padList .padDev[data-index="0"] .padBtn.on').length }));
    check('設定パネルを開いている間は軸・ボタンの表示が更新される', upd.ax === '-0.25' && upd.on === 1, JSON.stringify(upd));
    await p.screenshot({ path: out('shot_pad_panel.png') });
    // 機器の選択を上書き：スライダーを JOY の機器にする
    await p.selectOption('#padSliderDev', JOY); await p.waitForTimeout(100);
    const r3 = await p.evaluate(() => ({ sl: AH.padSliders().id, ls: localStorage.getItem('ahann_pad_sliderdev') }));
    check('スライダーに使う機器を選べる（保存される）', r3.sl === JOY && r3.ls === JOY, JSON.stringify(r3));
    await p.selectOption('#padSliderDev', ''); await p.waitForTimeout(100);
    // 使うをオフ：無視される・保存される
    await p.uncheck('#padSliderUse'); await p.uncheck('#padJoyUse'); await p.waitForTimeout(100);
    const before = await p.evaluate(() => AH.mode.peek());
    await axes(p, 0, { 2: 1, 3: 1 }); await p.waitForTimeout(150);
    const off = await p.evaluate(() => ({ joy: AH.padJoy(), sl: AH.padSliders(), c: AH.mode.peek(), ls: [localStorage.getItem('ahann_pad_joy'), localStorage.getItem('ahann_pad_slider')] }));
    check('「使う」をオフにすると無視され、設定が保存される', !off.joy && !off.sl && off.c.v === before.v && off.ls.join() === '0,0', JSON.stringify(off));
    await p.reload(); await p.waitForTimeout(300);
    const kept = await p.evaluate(() => [document.getElementById('padJoyUse').checked, document.getElementById('padSliderUse').checked]);
    check('再読み込みしても「使う」のオフが残る', kept.join() === 'false,false', JSON.stringify(kept));
    await p.evaluate(() => { localStorage.removeItem('ahann_pad_joy'); localStorage.removeItem('ahann_pad_slider'); localStorage.removeItem('ahann_pad_sliderdev'); });
    await p.close();
  }

  // ---- 書き出しの meta に使った機器名
  {
    const p = await open('darma');
    await p.evaluate(id => window.__connect(id, 0), JOY); await axes(p, 0, { 0: 0.5 }); await p.waitForTimeout(100);
    await p.keyboard.press('KeyR'); await play(p, 300); await p.keyboard.press('KeyR');
    const dl = []; p.on('download', d => dl.push(d));
    await p.click('#exportBtn'); await p.waitForTimeout(1200);
    const js = dl.find(d => d.suggestedFilename().endsWith('_session.json')), csv = dl.find(d => d.suggestedFilename().endsWith('_strokes.csv'));
    const fs = require('fs');
    const meta = JSON.parse(fs.readFileSync(await js.path(), 'utf8').replace(/^﻿/, '')).meta.gamepads;
    const strokes = fs.readFileSync(await csv.path(), 'utf8');
    check('書き出しの meta.gamepads に使った機器名が残る', meta && meta.used.some(u => u.role === 'joy' && u.id === JOY) && meta.joystick === JOY && meta.connected.length === 1, JSON.stringify(meta));
    check('_strokes.csv の source が gamepad', /\n0,gamepad,va,/.test(strokes), strokes.split('\n').slice(0, 2).join(' | '));
    await p.close();
  }

  // ---- 設定パネルが画面に収まる（機器2台をつないだ状態、Vosk の欄も開く）
  for (const [W, H] of [[1280, 720], [1366, 768], [1536, 864]]) {
    const c = await newCtx({ width: W, height: H });
    await c.addInitScript(() => localStorage.setItem('ahann_voice_engine', 'vosk'));
    const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); await p.goto(URL);
    await p.evaluate(([a, b]) => { window.__connect(a, 0, 4, 12); window.__connect(b, 1, 4, 12); }, [JOY, SLD]);
    await p.click('#setBtn'); await p.waitForTimeout(300);
    const r = await p.$eval('#setPanel', e => { const b = e.getBoundingClientRect(); return { b: b.bottom, sh: e.scrollHeight, ch: e.clientHeight }; });
    check(`${W}x${H}：機器2台でも設定パネルがスクロールなしで収まる`, r.b <= H + 0.5 && r.sh <= r.ch + 2, JSON.stringify(r));
    if (W === 1280) await p.screenshot({ path: out('shot_pad_setpanel_1280.png') });
    await c.close();
  }

  console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
