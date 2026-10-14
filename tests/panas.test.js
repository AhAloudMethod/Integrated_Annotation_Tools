// PANAS（日本語版 16 項目）：項目の表示・回答（クリック・数字キー）・PA/NA の値・取り消し・区切り・書き出し
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { URL, VID, BROWSER, OUT } = require('./_env');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true });
  const open = async (pid, on = true) => {
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
    await p.addInitScript(() => { localStorage.setItem('ahann_axes', 'va'); localStorage.setItem('ahann_voice_engine', 'webspeech'); });
    await p.goto(URL); if (pid) await p.fill('#pid', pid);
    await p.selectOption('#mode', 'panas'); await p.setInputFiles('#file', VID);
    await p.waitForFunction(() => AH.S.meta.duration > 0); await p.waitForTimeout(200);
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    if (on) { await p.check('.panas .optCtl:last-child input'); }   // 既定はオフ（合計を 1〜9 にしない）
    return p;
  };
  const names = p => p.$$eval('.pnRow .pnName', es => es.map(e => e.textContent));
  const cells = p => p.evaluate(() => ({ v: AH.S.data.cells.v[0] ?? null, a: AH.S.data.cells.a[0] ?? null, items: AH.S.data.items[0] || null }));

  {
    const off = await open('P00', false);   // 別の ID（同じ ID だと、この画面が保存した途中データを再開してしまう）
    await off.evaluate(() => { for (const r of document.querySelectorAll('.pnRow')) r.querySelector('button[data-v="3"]').click(); });
    const o = await off.evaluate(() => ({ cb: document.querySelector('.panas .optCtl:last-child input').checked, v: AH.S.data.cells.v[0] ?? null, sum: AH.mode.graphCell('v', 0), scale: !!AH.mode.graphScale() }));
    check('既定はオフ：区間の値は入れず、グラフ・帯は合計（24）', !o.cb && o.v === null && o.sum === 24 && o.scale, JSON.stringify(o));
    await off.close();
    const p = await open('P01');
    const ns = await names(p), N = ['活気のある', '誇らしい', '強気な', 'きっぱりとした', '気合いの入った', 'わくわくした', '機敏な', '熱狂した', 'びくびくした', 'おびえた', 'うろたえた', '心配した', 'ぴりぴりした', '苦悩した', '恥じた', 'いらだった'];
    check('16 項目が全部出る（順は並べ替え）', ns.length === 16 && JSON.stringify([...ns].sort()) === JSON.stringify([...N].sort()), ns.join());
    check('並びはランダム順（原典の順のままではない）', JSON.stringify(ns) !== JSON.stringify(N), ns.join());
    check('軸の組は PANA（設定が VA でも）', await p.evaluate(() => AH._.axesCurrent() === 'pana'));
    // 並びは参加者 ID で決まり、同じ ID なら同じ
    const q = await open('P01'), ns2 = await names(q); check('同じ参加者 ID は同じ並び', JSON.stringify(ns) === JSON.stringify(ns2));
    const r = await open('P02'); check('別の参加者 ID は別の並び', JSON.stringify(ns) !== JSON.stringify(await names(r))); await q.close(); await r.close();

    // クリック：1 つ答えるとその項目が選ばれ、全部そろうまで区間の値は入らない
    await p.click('.pnRow:nth-child(1) button[data-v="4"]');
    let c = await cells(p);
    check('1 項目だけでは区間の値は入らない', c.v === null && c.a === null && c.items.filter(x => x != null).length === 1, JSON.stringify(c));
    check('押したボタンが選ばれる', await p.$eval('.pnRow:nth-child(1) button[data-v="4"]', b => b.classList.contains('on')));
    // 取り消し
    await p.keyboard.press('Control+z');
    c = await p.evaluate(() => AH.S.data.items[0] || null);
    check('Ctrl+Z で回答が戻る', !c || c.every(x => x == null), JSON.stringify(c));

    // 数字キー：今の項目に答えて次の項目へ。PA は全部 6、NA は全部 1
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    for (let k = 0; k < 16; k++) { const f = await p.$eval('.pnRow.act', e => e.classList.contains('pa')); await p.keyboard.press(f ? 'Digit6' : 'Digit1'); }
    c = await cells(p);
    check('数字キーで 16 項目に答えられる（答えるたびに次の項目へ）', c.items && c.items.every(x => x === 1 || x === 6) && c.items.slice(0, 8).every(x => x === 6) && c.items.slice(8).every(x => x === 1), JSON.stringify(c.items));
    check('PA 合計 48・NA 合計 8 → 区間の値は PA=9・NA=1', c.v === 9 && c.a === 1, `v=${c.v} a=${c.a}`);
    check('見出しに合計', /PA 48/.test(await p.textContent('.pnHead')) && /NA 8/.test(await p.textContent('.pnHead')), await p.textContent('.pnHead'));
    // Backspace で今の項目を消すと値も外れる
    await p.keyboard.press('Backspace'); c = await cells(p);
    check('1 項目消すと区間の値も空に戻る', c.v === null && c.a === null, JSON.stringify(c));
    await p.keyboard.press('Control+z'); c = await cells(p);
    check('取り消しで値が戻る', c.v === 9 && c.a === 1, JSON.stringify(c));
    // 中間：全項目 3 → 平均 3 → 1+(3-1)*8/5 = 4.2 → 4
    const btns = await p.$$('.pnRow button[data-v="3"]'); for (const b of btns) await b.click();
    c = await cells(p);
    check('全項目 3（平均 3）→ 4', c.v === 4 && c.a === 4, `v=${c.v} a=${c.a}`);

    // 区切り：区間を分けると回答も付いていく
    await p.evaluate(() => AH._.addCut(AH._.binStart(0) + 0.5));
    const sp = await p.evaluate(() => [AH.S.data.items.length, JSON.stringify(AH.S.data.items[0]) === JSON.stringify(AH.S.data.items[1])]);
    check('区切りで項目の回答も分かれる', sp[0] >= 2 && sp[1], JSON.stringify(sp));
    await p.keyboard.press('Control+z');

    // 声では区間の値を置けない（断りを出し、取り消し・ログに何も残さない）。実験の要約は全項目に答えた区間を数える
    const vz = await p.evaluate(() => { const u = AH.S.undo.length, n = AH.S.log.length; const ok = AH._.applyVoice(AH._.parseVoice('ポジティブ7'), 0.5, 'ポジティブ7'); return { ok, du: AH.S.undo.length - u, cv: AH.S.log.slice(n).filter(x => /cell_voice/.test(x.type)).length }; });
    check('声の入力は断る（値も取り消しもログも増えない）', vz.ok === false && vz.du === 0 && vz.cv === 0, JSON.stringify(vz));
    check('実験の要約 filled_v・filled_a：全項目に答えた区間の数', await p.evaluate(() => AH.mode.filledCount('v') === 1 && AH.mode.filledCount('a') === 1));
    // 書き出し
    const dls = []; p.on('download', d => dls.push(d)); await p.click('#exportBtn'); await p.waitForTimeout(1500);
    const read = async suf => { const d = dls.find(x => x.suggestedFilename().endsWith(suf)); if (!d) return null; const f = path.join(OUT, 'panas' + suf); await d.saveAs(f); return fs.readFileSync(f, 'utf8').replace(/^﻿/, '').split('\n'); };
    const pn = await read('_panas.csv'), bins = await read('_bins.csv'), ses = JSON.parse((await read('_session.json')).join('\n'));
    check('_panas.csv の列', pn && pn[0] === 'bin,label,t_start,t_end,pa1,pa2,pa3,pa4,pa5,pa6,pa7,pa8,na1,na2,na3,na4,na5,na6,na7,na8,n_answered,pa_sum,na_sum', pn && pn[0]);
    check('_panas.csv の 1 行目：全項目 3 → 合計 24・24', pn && /,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,16,24,24$/.test(pn[1]), pn && pn[1]);
    check('_bins.csv は pa,na の列と、区間の値 4', bins && /,pa,na,va_valence,va_arousal$/.test(bins[0]) && /,4,4,/.test(bins[1]), bins && bins.slice(0, 2).join(' | '));
    check('_session.json に項目の文言・段階・並びが残る', ses.meta.panas && ses.meta.panas.items.length === 16 && ses.meta.panas.points === 6 && ses.meta.panas.order.length === 16 && ses.meta.axes === 'pana', JSON.stringify(ses.meta.panas).slice(0, 80));
    await p.close();
  }
  // 画面が低いとき（評価グラフを開くと右の列は一部しか見えない）でも、キーで答える間、今の項目が見える位置に追従する
  {
    const p = await open('P05', false);
    await p.setViewportSize({ width: 1280, height: 600 }); await p.evaluate(() => AH._.setTimeline(true)); await p.waitForTimeout(400);
    const seen = () => p.evaluate(() => { const r = document.querySelector('.pnRow.act').getBoundingClientRect(), e = document.elementFromPoint(r.left + 20, r.top + r.height / 2); return !!e && document.querySelector('.pnRow.act').contains(e); });
    const some = await p.evaluate(() => { const rs = [...document.querySelectorAll('.pnRow')]; return rs.filter(r => { const x = r.getBoundingClientRect(), e = document.elementFromPoint(x.left + 20, x.top + x.height / 2); return !!e && r.contains(e); }).length; });
    let down = 0, up = 0;
    for (let k = 0; k < 16; k++) { await p.keyboard.press('Digit3'); await p.waitForTimeout(30); if (!(await seen())) down++; }
    for (let k = 0; k < 20; k++) { await p.keyboard.press('ArrowUp'); await p.waitForTimeout(30); if (!(await seen())) up++; }
    check('画面が低く一部の項目しか見えなくても、今の項目が見える位置に追従する（答えて進む・↑で戻る）', some < 16 && down === 0 && up === 0, JSON.stringify({ visibleRows: some, hiddenDown: down, hiddenUp: up }));
    check('見出し（区間・PA・NA）はスクロールしても上に見える', await p.evaluate(() => { const r = document.querySelector('.pnHead').getBoundingClientRect(), e = document.elementFromPoint(r.left + 10, r.top + 5); return !!e && !!e.closest('.pnTop'); }));
    await p.close();
  }
  // 参加者 ID を打って Enter・Esc を押すとカーソルが外れ、ID が確定し、数字キーは ID の末尾ではなく方式の入力になる
  for (const key of ['Enter', 'Escape']) {
    const p = await open(null, false);
    await p.click('#pid'); await p.keyboard.type('Q' + (key === 'Enter' ? '1' : '2')); await p.keyboard.press(key); await p.keyboard.press('Digit3'); await p.waitForTimeout(100);
    const r = await p.evaluate(() => ({ focus: document.activeElement.tagName, field: document.getElementById('pid').value, pid: AH.S.meta.participant, n: (AH.S.data.items || []).reduce((a, x) => a + (x || []).filter(v => v != null).length, 0) }));
    check(`参加者 ID 欄で ${key}：カーソルが外れ、ID が確定し、数字は ID に入らず答えになる`, r.focus === 'BODY' && r.field === r.pid && r.pid === 'Q' + (key === 'Enter' ? '1' : '2') && r.n === 1, JSON.stringify(r));
    await p.close();
  }
  console.log('errors:', errs.length ? errs.join('|') : 'none');
  await browser.close();
})();
