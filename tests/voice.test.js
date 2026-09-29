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
  try { localStorage.setItem('ahann_voice_engine', 'webspeech'); } catch (_) {}   // このテストは Chrome の音声認識を偽物で試す
  window.__say = (text, final = true) => {
    const r = window.__rec; if (!r || !r.started) return false;
    const idx = r.cur ?? r.results.length;
    const item = Object.assign([].concat(text).map(t => ({ transcript: t })), { isFinal: final });   // text は文字列か候補の配列
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

  // 7. 「◯秒」と言うとその時刻に入る
  {
    const p = await open('key');
    const c = await p.evaluate(() => {
      const P = AH._.parseVoice;
      return { v24: P('二十四 秒 快 度 三'), split: P('二 十 よん 秒 快 度 さん'), miss: P(' 秒 快 度 さん'), words: AH._.voskWords(), kana: P('さん 秒 覚醒 度 二'), kana2: P('じゅう 秒 快 度 に'), a: P('12秒 快度7'), b: P('1分5秒 7 3'), c: P('十二秒、覚醒度三'), d: P('5秒 7 3'), e: P('2.5秒 快度4'), f: P('２分 快度６'), g: P('快度7') };
    });
    const eq = (o, e) => JSON.stringify(o) === JSON.stringify(e);
    check('Vosk の出力「二十四 秒 快 度 三」「二 十 よん 秒 快 度 さん」→ 24秒', eq(c.v24, { time: 24, v: 3 }) && eq(c.split, { time: 24, v: 3 }), JSON.stringify([c.v24, c.split]));
    check('「秒」の数字が落ちたら timeMissing', eq(c.miss, { timeMissing: true, v: 3 }), JSON.stringify(c.miss));
    check('Vosk の聞き取る語に 1〜99 の数がある', ['二十四', '十二', '九十九', '十'].every(w => c.words.includes(w)) && !c.words.includes('快度'), c.words.length + '語');
    check('Vosk の出力「さん 秒 覚醒 度 二」「じゅう 秒 快 度 に」', eq(c.kana, { time: 3, a: 2 }) && eq(c.kana2, { time: 10, v: 2 }), JSON.stringify([c.kana, c.kana2]));
    check('「12秒 快度7」', eq(c.a, { time: 12, v: 7 }), JSON.stringify(c.a));
    check('「1分5秒 7 3」', eq(c.b, { time: 65, v: 7, a: 3 }), JSON.stringify(c.b));
    check('漢数字「十二秒、覚醒度三」', eq(c.c, { time: 12, a: 3 }), JSON.stringify(c.c));
    check('時刻の数字は値に数えない「5秒 7 3」', eq(c.d, { time: 5, v: 7, a: 3 }), JSON.stringify(c.d));
    check('小数・全角「2.5秒」「２分」', eq(c.e, { time: 2.5, v: 4 }) && eq(c.f, { time: 120, v: 6 }), JSON.stringify([c.e, c.f]));
    check('時刻を言わなければ time なし', eq(c.g, { v: 7 }), JSON.stringify(c.g));

    // カウントダウン表記（既定）：「3秒」＝残り3秒の区間の始め（12秒の動画なら 8 秒）
    await p.click('#voiceBtn');
    await p.evaluate(() => AH.seekTo(1)); await p.waitForTimeout(150);
    await say(p, '3秒 快度7', true);
    const cd = await p.evaluate(() => AH.S.data.points.v.map(x => [x.t, x.val]));
    // 経過表記：「3秒」＝評価区間の開始から3秒
    await p.evaluate(() => { AH.S.meta.range = { start: 2, count: 10, bin: 1, label: 'elapsed' }; });
    await say(p, '3秒 覚醒度2', true);
    const el = await p.evaluate(() => AH.S.data.points.a.map(x => [x.t, x.val]));
    // 評価区間の外の時刻は入らない
    await say(p, '30秒 快度1', true);
    const out = await p.evaluate(() => ({ n: AH.S.data.points.v.length, hint: document.getElementById('hint').textContent }));
    check('カウントダウン表記：残り3秒 → 動画の8秒', JSON.stringify(cd) === '[[0,5],[8,7]]', JSON.stringify(cd));
    check('経過表記：開始2秒＋3秒 → 動画の5秒', JSON.stringify(el) === '[[0,5],[5,2]]', JSON.stringify(el));
    check('言った時刻が評価区間の外なら入らない', out.n === 2 && /評価区間の外/.test(out.hint), JSON.stringify(out));
    await p.close();
  }
  {
    const p = await open('affectgrid');
    await p.click('#voiceBtn'); await p.evaluate(() => AH.seekTo(0.5)); await p.waitForTimeout(150);
    await say(p, '10秒 8 2', true);                                 // カウントダウン残り10秒 → 区間1
    const r = await p.evaluate(() => [AH.S.data.cells.v[1], AH.S.data.cells.a[1], AH.S.data.cells.v.filter(x => x != null).length]);
    check('区間の方式：言った時刻の区間に入る', r.join() === '8,2,1', r.join());
    await p.close();
  }

  // 時刻の数字が落ちた発話は値を入れない（話し始めの時刻に入ると間違った位置になるため）
  {
    const p = await open('key');
    await p.click('#voiceBtn'); await p.evaluate(() => AH.seekTo(4)); await p.waitForTimeout(150);
    await say(p, ' 秒 快 度 さん', true);
    const r = await p.evaluate(() => ({ n: AH.S.data.points.v.length, hint: document.getElementById('hint').textContent, log: AH.S.log.some(l => l.type === 'voice_time_missing') }));
    check('時刻の数字が落ちたら値を入れず案内する', r.n === 1 && /時刻が聞き取れません/.test(r.hint) && r.log, JSON.stringify(r));
    await p.close();
  }

  // 8. 聞き間違いの補正：同音の語の読み替え・候補の選択・履歴
  {
    const p = await open('key');
    const c = await p.evaluate(() => {
      const P = AH._.parseVoice;
      return { real: P('25秒角 精度 7'), real2: P('角 精度 7'), sei: P('精度 4'), keep: P('7 3'), a: P('街道7 学生3'), b: P('開度急'), c: P('拡声 録'), d: P('会度は球'), e: P('3秒 海道 語'), f: P('位置 に') };
    });
    const eq = (o, e) => JSON.stringify(o) === JSON.stringify(e);
    check('実際のログ「25秒角 精度 7」→ 25秒 覚醒度7', eq(c.real, { time: 25, a: 7 }) && eq(c.real2, { a: 7 }) && eq(c.sei, { a: 4 }), JSON.stringify([c.real, c.real2, c.sei]));
    check('数字の間の空白は詰めない「7 3」', eq(c.keep, { v: 7, a: 3 }), JSON.stringify(c.keep));
    check('「街道7 学生3」→ 快度7 覚醒度3', eq(c.a, { v: 7, a: 3 }), JSON.stringify(c.a));
    check('同音の数字「開度急」「拡声 録」「会度は球」', eq(c.b, { v: 9 }) && eq(c.c, { a: 6 }) && eq(c.d, { v: 9 }), JSON.stringify([c.b, c.c, c.d]));
    check('時刻つき「3秒 海道 語」', eq(c.e, { time: 3, v: 5 }), JSON.stringify(c.e));
    check('軸の語がなければ同音の数字は読まない「位置 に」', eq(c.f, {}), JSON.stringify(c.f));
    // 候補が複数あるとき、値として読めた候補を使う
    await p.click('#voiceBtn'); await p.evaluate(() => AH.seekTo(2)); await p.waitForTimeout(150);
    await say(p, ['こんにちは', '快度8'], true);
    const r = await p.evaluate(() => ({ v: AH.S.data.points.v.map(x => [x.t, x.val]), heard: AH.S.log.filter(l => l.type === 'voice_heard').at(-1) }));
    const alts = JSON.parse(r.heard.detail).alts;
    check('候補のうち読めたものを使う', JSON.stringify(r.v) === '[[0,5],[2,8]]' && r.heard.value === '快度8' && alts.length === 2, JSON.stringify(r));
    // 設定パネルの履歴
    await say(p, 'よくわからない', true);
    const hist = await p.$$eval('#voiceHist li', li => li.map(x => x.textContent));
    check('聞き取りの履歴を表示する（新しい順）', hist.length === 2 && /よくわからない.*読めず/.test(hist[0]) && /快度8.*快度8/.test(hist[1]), JSON.stringify(hist));
    await p.close();
  }

  // 6. Chrome の音声認識がないブラウザ（Firefox 系）：ボタンは使え、認識は Vosk になる（Chrome の音声認識は選べない）
  {
    const c2 = await browser.newContext(); await c2.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; localStorage.removeItem('ahann_voice_engine'); });
    const p = await c2.newPage(); await p.goto(URL);
    const r = await p.evaluate(() => ({ btn: document.getElementById('voiceBtn').disabled, eng: document.getElementById('voiceEngine').value, ws: document.querySelector('#voiceEngine option[value=webspeech]').disabled, box: !document.getElementById('voskBox').hidden }));
    check('Chrome の音声認識がないブラウザでは Vosk になる', !r.btn && r.eng === 'vosk' && r.ws && r.box, JSON.stringify(r));
    // モデル未設定で音声をオンにすると案内してオフに戻る
    await p.click('#voiceBtn'); await p.waitForTimeout(500);
    const st = await p.evaluate(() => ({ on: document.getElementById('voiceBtn').classList.contains('on'), hint: document.getElementById('hint').textContent }));
    check('Vosk のモデルが未設定なら案内してオフに戻る', !st.on && /モデルが未設定/.test(st.hint), JSON.stringify(st));
    await c2.close();
  }
  // 設定で認識エンジンを切り替えられ、保存される
  {
    const p = await open('key');
    await p.click('#setBtn'); await p.selectOption('#voiceEngine', 'vosk');
    const shown = await p.evaluate(() => !document.getElementById('voskBox').hidden);
    const saved = await p.evaluate(() => localStorage.getItem('ahann_voice_engine'));
    await p.selectOption('#voiceEngine', 'webspeech');
    check('設定で認識エンジンを切り替えられる（Vosk の欄が出る）', shown && saved === 'vosk', JSON.stringify({ shown, saved }));
    await p.close();
  }

  console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
