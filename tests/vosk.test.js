// Vosk による声の入力（本物のモデルで認識する）。合成音声 tests/fixtures/voice.wav を偽のマイク入力として流す
// 前提：models/*.tar.gz（npm run vosk-model）と tests/fixtures/voice.wav（npm run voice-fixture）。どちらかがなければ飛ばす
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { URL, VID, BROWSER, ROOT } = require('./_env');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);

const MODEL_DIR = path.join(ROOT, 'models');
const model = fs.existsSync(MODEL_DIR) && fs.readdirSync(MODEL_DIR).find(f => /\.tar\.gz$/.test(f));
const WAV = path.join(__dirname, 'fixtures', 'voice.wav');

(async () => {
  if (!model || !fs.existsSync(WAV)) {
    console.log('skip  Vosk のテスト（models/*.tar.gz か tests/fixtures/voice.wav がありません。npm run vosk-model / npm run voice-fixture で作れます）');
    console.log('ERRORS: none'); return;
  }
  const browser = await chromium.launch({
    executablePath: BROWSER, headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}`, '--autoplay-policy=no-user-gesture-required'],
  });
  const errs = [];
  const run = async (restrict) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, permissions: ['microphone'] });
    await ctx.addInitScript(r => { localStorage.setItem('ahann_voice_engine', 'vosk'); localStorage.setItem('ahann_voice_restrict', r ? '1' : '0'); }, restrict);
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss());
    await p.goto(URL); await p.selectOption('#mode', 'key'); await p.setInputFiles('#file', VID); await p.waitForFunction(() => AH.S.meta.duration > 0);
    const t0 = Date.now();
    await p.setInputFiles('#voskModelFile', path.join(MODEL_DIR, model));
    await p.waitForFunction(() => /保存済み|開いている間/.test(document.getElementById('voskModelStatus').textContent), null, { timeout: 60000 });
    await p.click('#voiceBtn');
    // 経路全体が動くこと：語を限定すると「快度、七」が t=0 に入る。限定なしは何かしら聞き取れる
    // （2つ目の「三秒、覚醒度、二」は合成音声では「三」が落ちることがあるので、結果は情報として出すだけ）
    let ok = false;
    const cond = restrict ? () => AH.valueAt('v', 0) === 7 : () => AH.S.log.some(l => l.type === 'voice_heard');
    try { await p.waitForFunction(cond, null, { timeout: 120000, polling: 500 }); ok = true; } catch (_) {}
    await p.waitForTimeout(restrict ? 8000 : 1000);   // 2つ目の発話も聞き取らせる
    const heard = await p.evaluate(() => [...new Set(AH.S.log.filter(l => l.type === 'voice_heard').map(l => l.value.trim()))]);
    const ready = await p.evaluate(() => AH.S.log.find(l => l.type === 'voice_ready')?.detail);
    const second = await p.evaluate(() => ({ a_at_7_9: AH.valueAt('a', 7.9), a_at_8_05: AH.valueAt('a', 8.05) }));
    check(`Vosk（${restrict ? '語を限定' : '限定なし'}）：マイクから聞き取って値が入る`, ok && !!ready, JSON.stringify({ ready, sec: ((Date.now() - t0) / 1000).toFixed(0) }));
    console.log(`info Vosk（${restrict ? '語を限定' : '限定なし'}）の聞き取り：${JSON.stringify(heard)}  2つ目（残り3秒＝動画8秒に覚醒度2）：${JSON.stringify(second)}`);
    // 保存したモデルは次に開いたときも使える（選び直さなくてよい）
    const p2 = await ctx.newPage(); await p2.goto(URL); await p2.waitForTimeout(500);
    const status = await p2.$eval('#voskModelStatus', e => e.textContent);
    check(`Vosk（${restrict ? '語を限定' : '限定なし'}）：モデルがブラウザに保存される`, /保存済み/.test(status), status);
    await p.click('#voiceBtn');
    await ctx.close();
  };
  await run(true);
  await run(false);
  console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
