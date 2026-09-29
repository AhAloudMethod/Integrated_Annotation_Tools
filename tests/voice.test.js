// 声による値の入力：聞き取った文の解釈と、各方式への反映（音声認識は偽物に差し替えて結果を流し込む）
const { chromium } = require('playwright-core');
const { URL, VID, BROWSER } = require('./_env');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);

// 偽の SpeechRecognition：window.__say(text, { final }) で結果を流し込む
const FAKE = () => {
  class FakeRec {
    constructor() { window.__rec = this; this.results = []; }
    start() { this.started = true; } stop() { this.started = false; }
  }
  window.SpeechRecognition = FakeRec;
  window.__say = (text, final = true) => {
    const r = window.__rec; if (!r || !r.started) return false;
    const idx = r.cur ?? r.results.length;
    const item = Object.assign([{ transcript: text }], { isFinal: final });
    r.results[idx] = item; r.cur = final ? undefined : idx;
    r.onresult({ resultIndex: idx, results: Object.assign([...r.results], { length: r.results.length }) });
    return true;
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await ctx.addInitScript(FAKE);
  const errs = [];
  const open = async mode => {
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss());
    await p.goto(URL); await p.selectOption('#mode', mode); await p.setInputFiles('#file', VID);
    await p.waitForFunction(() => AH.S.meta.duration > 0); await p.waitForTimeout(100);
    return p;
  };
  const say = (p, text, final = true) => p.evaluate(([t, f]) => window.__say(t, f), [text, final]);

  // 1. 解釈
  {
    const p = await open('key');
    const cases = await p.evaluate(() => {
      const P = AH._.parseVoice;
      return {
        both: P('快度7 覚醒度3'), kanji: P('覚醒度三、快度八'), read: P('かいど なな'), shichi: P('快度しち'),
        pair: P('7 3'), zen: P('６　２'), one: P('5'), oneAxis: P('6', { oneAxis: 'a' }),
        play: P('再生'), stop: P('ストップ'), junk: P('こんにちは'), ten: P('快度10'),
      };
    });
    const eq = (o, e) => JSON.stringify(o) === JSON.stringify(e);
    check('「快度7 覚醒度3」', eq(cases.both, { v: 7, a: 3 }), JSON.stringify(cases.both));
    check('漢数字「覚醒度三、快度八」', eq(cases.kanji, { a: 3, v: 8 }), JSON.stringify(cases.kanji));
    check('読み「かいど なな」「快度しち」', eq(cases.read, { v: 7 }) && eq(cases.shichi, { v: 7 }), JSON.stringify([cases.read, cases.shichi]));
    check('数字2つは快度・覚醒度（全角も）', eq(cases.pair, { v: 7, a: 3 }) && eq(cases.zen, { v: 6, a: 2 }), JSON.stringify([cases.pair, cases.zen]));
    check('数字1つは1軸の方式だけ', eq(cases.one, {}) && eq(cases.oneAxis, { a: 6 }), JSON.stringify([cases.one, cases.oneAxis]));
    check('再生・停止のコマンド', cases.play.cmd === 'play' && cases.stop.cmd === 'pause', JSON.stringify([cases.play, cases.stop]));
    check('読めない文・範囲外の数は値にしない', eq(cases.junk, {}) && cases.ten.v == null, JSON.stringify([cases.junk, cases.ten]));
    await p.close();
  }

  // 2. 連続の方式：話し始め（途中結果が届いた時刻）に変化点が入る
  {
    const p = await open('key');
    await p.click('#voiceBtn');
    await p.evaluate(() => AH.seekTo(3)); await p.waitForTimeout(200);
    await say(p, 'かいど', false);                                    // 話し始め（途中結果）
    await p.evaluate(() => AH.seekTo(4)); await p.waitForTimeout(200); // 確定するまでに時刻が進む
    await say(p, '快度7 覚醒度2', true);
    const r = await p.evaluate(() => ({ v: AH.S.data.points.v.map(x => [x.t, x.val]), a: AH.S.data.points.a.map(x => [x.t, x.val]), log: AH.S.log.filter(l => /voice/.test(l.type)).map(l => l.type).join(','), btn: document.getElementById('voiceBtn').textContent }));
    check('話し始めの時刻に変化点が入る', JSON.stringify(r.v) === '[[0,5],[3,7]]' && JSON.stringify(r.a) === '[[0,5],[3,2]]', JSON.stringify(r));
    check('操作ログに残る', r.log === 'voice,voice_heard,voice_input', r.log);
    await p.keyboard.press('Control+z');
    check('取り消しできる', await p.evaluate(() => AH.S.data.points.v.length === 1));
    await p.close();
  }

  // 3. 区間の方式：その区間の値になる。区間の外は入らない
  {
    const p = await open('affectgrid');
    await p.click('#voiceBtn');
    await p.evaluate(() => AH.seekTo(5.5)); await p.waitForTimeout(200);
    await say(p, '8 3', true);
    const cells = await p.evaluate(() => [AH.S.data.cells.v[5], AH.S.data.cells.a[5]]);
    await p.evaluate(() => { AH.S.meta.range = { start: 2, count: 3, bin: 1, label: 'countdown' }; AH.seekTo(10); }); await p.waitForTimeout(200);
    await say(p, '2 2', true);
    const out = await p.evaluate(() => ({ n: AH.S.data.cells.v.filter(x => x != null).length, hint: document.getElementById('hint').textContent }));
    check('区間の方式：その区間の値になる', cells.join() === '8,3', cells.join());
    check('区間の外では入らない', out.n === 1 && /評価区間の外/.test(out.hint), JSON.stringify(out));
    await p.close();
  }

  // 4. 1軸の方式（CARMA の覚醒度の回）は数字1つで入る。再生・停止のコマンド
  {
    const p = await open('carma');
    await p.check('input[name=pass][value=a]');
    await p.click('#voiceBtn');
    await say(p, '6', true);
    const a = await p.evaluate(() => [AH.valueAt('a', 0.01), AH.valueAt('v', 0.01)]);
    await say(p, '再生', true); await p.waitForTimeout(300);
    const playing = await p.evaluate(() => !AH.video.paused);
    await say(p, '停止', true); await p.waitForTimeout(100);
    const paused = await p.evaluate(() => AH.video.paused);
    check('1軸の方式は数字1つで入る', a.join() === '6,5', a.join());
    check('「再生」「停止」で操作できる', playing && paused, JSON.stringify({ playing, paused }));
    await p.close();
  }

  // 5. 上下限のない方式（RankTrace）は入れない。音声をオフにすると聞き取らない
  {
    const p = await open('ranktrace');
    await p.click('#voiceBtn'); await say(p, '快度7', true);
    const r = await p.evaluate(() => ({ n: AH.S.data.points.v.length, hint: document.getElementById('hint').textContent }));
    await p.click('#voiceBtn');
    const heard = await say(p, '快度7', true);
    check('RankTrace では値を入れない', r.n === 1 && /使えません/.test(r.hint), JSON.stringify(r));
    check('オフにすると聞き取らない', heard === false);
    await p.close();
  }

  // 6. 音声認識がないブラウザ（Firefox 系）ではボタンを無効にする
  {
    const c2 = await browser.newContext(); await c2.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; });
    const p = await c2.newPage(); await p.goto(URL);
    check('音声認識がないブラウザではボタンが無効', await p.$eval('#voiceBtn', b => b.disabled));
    await c2.close();
  }

  console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
