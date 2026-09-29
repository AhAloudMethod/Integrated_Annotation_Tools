// 評価の軸の組（VA・PANA・Thayer）：ラベル・列名・声の語が変わり、値の持ち方は同じ。VA 前提の方式は VA のまま
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { URL, VID, BROWSER, OUT } = require('./_env');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true });
  const open = async (mode, axes) => {
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
    await p.addInitScript(a => { if (a) localStorage.setItem('ahann_axes', a); else localStorage.removeItem('ahann_axes'); localStorage.setItem('ahann_voice_engine', 'webspeech'); }, axes || '');
    await p.goto(URL); await p.selectOption('#mode', mode); await p.setInputFiles('#file', VID);
    await p.waitForFunction(() => AH.S.meta.duration > 0); await p.waitForTimeout(150);
    return p;
  };
  const labels = p => p.evaluate(() => ({
    now: [...document.querySelectorAll('.nowRow span')].map(s => s.firstChild.textContent.trim()),
    help: document.getElementById('modeHelp').textContent,
    keys: [...document.querySelectorAll('.axis h2 span:first-child')].map(s => s.textContent),
    ends: [...document.querySelectorAll('.axis .ends')].map(e => e.textContent),
  }));

  // 1. 既定は VA
  {
    const p = await open('key');
    const r = await labels(p), sel = await p.$eval('#axesSel', s => s.value);
    check('既定は VA（快度・覚醒度）', sel === 'va' && r.keys.join() === '快度,覚醒度', JSON.stringify(r.keys));
    await p.close();
  }
  // 2. 設定で PANA に切り替え：ラベル・説明文・色の欄が変わり、保存される
  {
    const p = await open('key');
    await p.click('#setBtn'); await p.selectOption('#axesSel', 'pana'); await p.waitForTimeout(150);
    const r = await labels(p);
    const col = await p.$$eval('#colorGrid .cell span', s => s.map(x => x.textContent));
    const saved = await p.evaluate(() => [localStorage.getItem('ahann_axes'), AH.S.log.filter(l => l.type === 'axes').map(l => l.value).join()]);
    check('PANA：軸の名前と両端', r.keys.join() === 'ポジティブ,ネガティブ' && /ポジティブ低.*ポジティブ高/.test(r.ends[0]) && /ネガティブ低.*ネガティブ高/.test(r.ends[1]), JSON.stringify(r));
    check('PANA：説明文の「快度」「覚醒度」も置き換わる', /ポジティブ/.test(r.help) && !/快度|覚醒度/.test(r.help), r.help.slice(0, 80));
    check('PANA：色の欄のラベル', col.includes('ネガティブ高・ポジティブ高') && col.includes('ネガティブ低・ポジティブ低'), JSON.stringify(col));
    check('PANA：設定が保存され、操作ログに残る', saved[0] === 'pana' && saved[1] === 'pana', JSON.stringify(saved));
    await p.close();
  }
  // 3. 平面の方式（EMuJoy）・スロットル・Excel・グラフのラベル
  {
    const p = await open('emujoy', 'thayer');
    const r = await labels(p);
    await p.evaluate(() => AH._.setTimeline(true));
    const lanes = await p.evaluate(() => { const G = [AH._.ax('v').short, AH._.ax('a').short]; return G; });
    check('Thayer：EMuJoy の数値の欄', r.now.join() === 'エネルギー,緊張', JSON.stringify(r.now));
    check('Thayer：グラフの欄の名前', lanes.join() === 'エネルギー,緊張', lanes.join());
    await p.close();
    const q = await open('excel', 'pana');
    const th = await q.$$eval('table.xl tr th:first-child', x => x.map(e => e.textContent));
    const ref = await q.$eval('table.ref', t => t.hidden);
    check('PANA：Excel の行の見出し', th[1] === 'ポジティブ(1:ポジティブ低ー9:ポジティブ高)' && th[2] === 'ネガティブ(1:ネガティブ低ー9:ネガティブ高)', JSON.stringify(th));
    check('PANA：Excel の感情ラベルの表は隠す', ref === true);
    await q.close();
  }
  // 4. VA 前提の方式は VA のまま
  for (const mode of ['sam', 'affectgrid', 'feeltrace', 'affectrank']) {
    const p = await open(mode, 'pana');
    const r = await p.evaluate(() => ({ cur: AH._.axesCurrent(), set: AH._.axesId(), help: document.getElementById('modeHelp').textContent }));
    check(`${mode} は PANA でも VA のまま`, r.cur === 'va' && r.set === 'pana' && !/ポジティブ/.test(r.help), JSON.stringify({ cur: r.cur, set: r.set }));
    await p.close();
  }
  // 5. 書き出し：列名が変わり、VA に直した列が付く（値の持ち方は同じ）
  {
    const p = await open('key', 'pana');
    await p.evaluate(() => { AH.S.data.points.v[0].val = 9; AH.S.data.points.a[0].val = 1; });   // 高PA・低NA ＝ VA では 快・中くらいの覚醒
    const dls = []; p.on('download', d => dls.push(d)); await p.click('#exportBtn'); await p.waitForTimeout(1500);
    const read = async suf => { const d = dls.find(x => x.suggestedFilename().endsWith(suf)); const f = path.join(OUT, 'axes' + suf); await d.saveAs(f); return fs.readFileSync(f, 'utf8').replace(/^﻿/, '').split('\n'); };
    const hz = await read('_60hz.csv'), bins = await read('_bins.csv'), cps = await read('_changepoints.csv');
    const sess = JSON.parse(fs.readFileSync(await (async () => { const d = dls.find(x => x.suggestedFilename().endsWith('_session.json')); const f = path.join(OUT, 'axes_session.json'); await d.saveAs(f); return f; })(), 'utf8').replace(/^﻿/, ''));
    check('PANA：_60hz.csv の列名と VA に直した値', hz[0] === 'frame,t,pa,na,va_valence,va_arousal' && hz[1] === '0,0.0000,9,1,10.657,5.000', hz.slice(0, 2).join(' | '));
    check('PANA：_bins.csv にも VA に直した列', /,pa,na,va_valence,va_arousal$/.test(bins[0]), bins[0]);
    check('PANA：_changepoints.csv の軸の名前', cps[1].startsWith('pa,') && cps.some(l => l.startsWith('na,')), cps.slice(0, 3).join(' | '));
    check('PANA：セッションのメタ情報に軸', sess.meta.axes === 'pana', sess.meta.axes);
    await p.close();
  }
  // 6. 声の入力：PANA の語で入る
  {
    const p = await open('key', 'pana');
    const r = await p.evaluate(() => { const P = AH._.parseVoice; return [P('ポジティブ7'), P('負の感情3'), P('快度7')]; });
    check('PANA：声の語「ポジティブ7」「負の感情3」（「快度」は読まない）', JSON.stringify(r) === '[{"v":7},{"a":3},{}]', JSON.stringify(r));
    await p.close();
  }
  // 7. 評価の途中で変えるときは確認し、キャンセルなら戻す
  {
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(() => localStorage.removeItem('ahann_axes'));
    await p.goto(URL); await p.selectOption('#mode', 'key'); await p.setInputFiles('#file', VID); await p.waitForFunction(() => AH.S.meta.duration > 0);
    await p.evaluate(() => document.activeElement.blur()); await p.keyboard.press('Digit7');
    let asked = false; p.once('dialog', d => { asked = true; d.dismiss(); });
    await p.click('#setBtn'); await p.selectOption('#axesSel', 'thayer'); await p.waitForTimeout(200);
    const r = await p.evaluate(() => [AH._.axesId(), document.getElementById('axesSel').value]);
    check('評価の途中で変えるときは確認し、キャンセルなら戻す', asked && r.join() === 'va,va', JSON.stringify({ asked, r }));
    await p.close();
  }

  await ctx.close();
  console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
