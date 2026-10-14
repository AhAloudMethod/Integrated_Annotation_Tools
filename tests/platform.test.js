// OS による操作の違い：Mac では Ctrl を ⌘ と表示し、キーは Ctrl も ⌘ も効く。Windows では Ctrl のまま
const { chromium } = require('playwright-core');
const { URL, VID, BROWSER } = require('./_env');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const errs = [];
  const open = async platform => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
    await p.addInitScript(pf => { Object.defineProperty(navigator, 'platform', { get: () => pf }); localStorage.setItem('ahann_voice_engine', 'webspeech'); }, platform);
    await p.goto(URL); await p.selectOption('#mode', 'key'); await p.setInputFiles('#file', VID);
    await p.waitForFunction(() => AH.S.meta.duration > 0); await p.waitForTimeout(200);
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    return p;
  };
  const texts = p => p.evaluate(() => ({ title: document.getElementById('frBack').title, body: document.body.textContent, helps: [...document.querySelectorAll('[title]')].map(e => e.title).join('\n') }));

  // Mac：表示は ⌘。Ctrl の語は残らない
  {
    const p = await open('MacIntel'), t = await texts(p);
    check('Mac：ツールチップの Ctrl が ⌘ になる', /⌘\+←/.test(t.title) && !/Ctrl/.test(t.helps), t.title);
    check('Mac：説明の Ctrl が ⌘ になる', /⌘\s*\+\s*←\s*→/.test(t.body) || /⌘[\s\S]{0,30}取り消し/.test(t.body), (t.body.match(/.{0,10}⌘.{0,20}/) || [''])[0]);
    check('Mac：画面に Ctrl の語が残らない', !/Ctrl/.test(t.body), (t.body.match(/.{0,12}Ctrl.{0,12}/) || [''])[0]);
    // キー：⌘+Z で取り消せる（Ctrl+Z も）
    await p.evaluate(() => AH.setArmed(true)); await p.keyboard.press('Digit7'); await p.waitForTimeout(100);
    const n1 = await p.evaluate(() => AH.S.data.points.v.at(-1).val);
    await p.keyboard.press('Meta+z'); await p.waitForTimeout(100);
    const n2 = await p.evaluate(() => AH.S.data.points.v.at(-1).val);
    check('Mac：⌘+Z で取り消せる', n1 === 7 && n2 === 5, `${n1} -> ${n2}`);
    await p.keyboard.press('Meta+Shift+z'); await p.waitForTimeout(100);
    check('Mac：⌘+Shift+Z でやり直せる', (await p.evaluate(() => AH.S.data.points.v.at(-1).val)) === n1);
    await p.keyboard.press('Control+z'); await p.waitForTimeout(100);
    check('Mac：Ctrl+Z も効く', (await p.evaluate(() => AH.S.data.points.v.at(-1).val)) === n2);
    // 1 フレーム移動：⌘+→（止まっているとき）
    await p.evaluate(() => { AH.video.pause(); AH.seekTo(2); }); await p.waitForTimeout(300);
    const t0 = await p.evaluate(() => AH.video.currentTime);
    await p.keyboard.press('Meta+ArrowRight'); await p.waitForTimeout(250);
    const t1 = await p.evaluate(() => AH.video.currentTime);
    check('Mac：⌘+→ で 1 フレーム進む', t1 > t0 && t1 - t0 < 0.1, `${t0} -> ${t1}`);
    await p.context().close();
  }
  // Windows：Ctrl のまま
  {
    const p = await open('Win32'), t = await texts(p);
    check('Windows：ツールチップは Ctrl のまま', /Ctrl\+←/.test(t.title) && !/⌘/.test(t.body + t.helps), t.title);
    await p.evaluate(() => AH.setArmed(true)); await p.keyboard.press('Digit7'); await p.waitForTimeout(100);
    const n1 = await p.evaluate(() => AH.S.data.points.v.at(-1).val);
    await p.keyboard.press('Control+z'); await p.waitForTimeout(100);
    check('Windows：Ctrl+Z で取り消せる', n1 === 7 && (await p.evaluate(() => AH.S.data.points.v.at(-1).val)) === 5);
    await p.context().close();
  }
  console.log('errors:', errs.length ? errs.join('|') : 'none');
  await browser.close();
})();
