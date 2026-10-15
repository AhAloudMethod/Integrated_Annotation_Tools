// 結果の読み込み（core/import.js）：書き出したファイル（_session.json・zip・CSV）を読み込み、方式・参加者 ID・値・評価区間が戻ることを確かめる
const { chromium } = require('playwright-core');
const { URL, VID, BROWSER, out } = require('./_env');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  // ページを開く。video を渡すと動画も開く。dialog は confirm を受ける（accept）か断る
  const page = async ({ mode = 'excel', pid = '', video = true, accept = true } = {}) => {
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    p.dialogs = []; p.on('dialog', d => { p.dialogs.push(d.message()); accept ? d.accept() : d.dismiss(); });
    await p.addInitScript(() => { if (!sessionStorage.getItem('cleared')) { localStorage.clear(); sessionStorage.setItem('cleared', '1'); } });
    await p.goto(URL); await p.fill('#pid', pid); await p.selectOption('#mode', mode);
    if (video) { await p.setInputFiles('#file', VID); await p.waitForFunction(() => AH.S.meta.duration > 0); await p.waitForTimeout(150); }
    return p;
  };
  // 書き出すファイル（名前 → 中身）。ダウンロードせずに AH._.buildFiles から作る
  const build = p => p.evaluate(() => Object.fromEntries(AH._.buildFiles().map(f => [f.name, f.text])));
  const pick = (fs, suf) => Object.keys(fs).find(n => n.endsWith(suf));
  const give = (p, list) => p.setInputFiles('#importFile', list.map(([name, text]) => ({ name, mimeType: 'text/plain', buffer: Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8') })));
  const state = p => p.evaluate(() => ({ mode: AH.S.meta.mode, sel: document.getElementById('mode').value, pid: AH.S.meta.participant, pidField: document.getElementById('pid').value,
    cells: AH.S.data.cells, points: AH.S.data.points, events: AH.S.data.events, items: AH.S.data.items, range: AH.S.meta.range, options: AH.S.meta.options, axes: AH._.axesId(),
    log: AH.S.log.map(l => l.type), status: document.getElementById('hint').textContent }));

  // 1. Excel（不揃いの区間・発声なし）：書き出した _session.json を、動画を開いた後の別の方式の画面へ読み込む
  const src = await page({ mode: 'excel', pid: 'P07' });
  await src.evaluate(() => {
    AH._.setRange({ start: 1, bin: 2, count: 4, target: 9, label: 'elapsed' });
    AH._.setRange({ edges: [1, 2.5, 5, 7, 9] });
    AH.setCell('v', 0, 7); AH.setCell('a', 0, 3); AH.setCell('v', 2, 0); AH.setCell('a', 2, 0); AH.setCell('v', 3, 9);
  });
  const want = await state(src), files = await build(src), jsonName = pick(files, '_session.json');
  {
    const p = await page({ mode: 'carma', pid: 'X' });
    await give(p, [[jsonName, files[jsonName]]]); await p.waitForFunction(() => AH.S.meta.mode === 'excel');
    const s = await state(p);
    check('json: 方式・参加者 ID が戻る', s.mode === 'excel' && s.sel === 'excel' && s.pid === 'P07' && s.pidField === 'P07', `${s.mode} ${s.pid}`);
    check('json: 区間の値が戻る', same(s.cells, want.cells), JSON.stringify(s.cells));
    check('json: 評価区間（区切り）が戻る', same(s.range, want.range), JSON.stringify(s.range));
    check('json: 操作ログが続き、import が残る', s.log.length > want.log.length && s.log.slice(-3).includes('import') && s.log[0] === 'session_start', s.log.slice(-3).join(','));
    check('json: 置き換えの確認を出す', p.dialogs.some(m => /置き換え/.test(m)), p.dialogs.join(' / '));
    // 読み込んだ後も編集でき、書き出せる
    await p.evaluate(() => AH.setCell('a', 1, 6));
    const again = await build(p), bins = again[pick(again, '_bins.csv')];
    check('json: 読み込んだ後に編集して書き出せる', /^P07_test_excel_bins\.csv$/.test(pick(again, '_bins.csv')) && bins.split('\n')[2].endsWith(',,6'), bins.split('\n')[2]);
    await p.close();
  }
  // 2. 置き換えの確認を断ると何も変えない
  {
    const p = await page({ mode: 'carma', pid: 'X', accept: false });
    await give(p, [[jsonName, files[jsonName]]]); await p.waitForTimeout(300);
    const s = await state(p);
    check('json: 確認を断ると変えない', s.mode === 'carma' && s.pid === 'X', s.mode);
    await p.close();
  }
  // 3. 動画を開く前に読み込み、動画を開いたときに当てる（覚えてある評価区間より読み込んだ区間を使う）
  {
    const p = await page({ mode: 'sam', video: false });
    await give(p, [[jsonName, files[jsonName]]]); await p.waitForTimeout(200);
    const st0 = await p.evaluate(() => document.getElementById('hint').textContent);
    await p.evaluate(() => localStorage.setItem('ahann_range:test.mp4', JSON.stringify({ start: 0, count: 3, bin: 1, label: 'countdown', target: 3 })));
    await p.setInputFiles('#file', VID); await p.waitForFunction(() => AH.S.meta.duration > 0 && AH.S.meta.mode === 'excel'); await p.waitForTimeout(150);
    const s = await state(p);
    check('動画の前：開いたときに当てる', /動画「test」を開くと/.test(st0) && same(s.cells, want.cells) && same(s.range, want.range) && s.pid === 'P07', st0 + ' ' + JSON.stringify(s.range));
    check('動画の前：確認を出さない（名前が同じ）', !p.dialogs.length, p.dialogs.join(' / '));
    await p.close();
  }
  // 4. 実験モードの zip（中の _session.json を使う）
  {
    const p = await page({ mode: 'key' });
    const zip = Buffer.from(await p.evaluate(fs => Array.from(AH._.makeZip(Object.entries(fs).map(([name, data]) => ({ name, data })))), files));
    await give(p, [['P07_t01_test_excel.zip', zip]]); await p.waitForFunction(() => AH.S.meta.mode === 'excel');
    const s = await state(p);
    check('zip: 中の _session.json から戻る', same(s.cells, want.cells) && same(s.range, want.range), JSON.stringify(s.cells));
    await p.close();
  }
  // 5. 評価値の CSV だけ（表計算で直した _bins.csv）：ファイル名から方式・ID を読み、値と不揃いの評価区間を戻す
  {
    const binsName = pick(files, '_bins.csv'), edited = files[binsName].replace(/\n(\d+),([^,\n]*),1\.000,2\.500,7,3/, '\n$1,$2,1.000,2.500,4,8');
    const p = await page({ mode: 'sam', pid: '' });
    await give(p, [[binsName, edited]]); await p.waitForFunction(() => AH.S.meta.mode === 'excel');
    const s = await state(p);
    check('csv: 方式と ID をファイル名から読む', s.mode === 'excel' && s.pid === 'P07', s.mode + ' ' + s.pid);
    check('csv: 直した値が入る', s.cells.v[0] === 4 && s.cells.a[0] === 8 && s.cells.v[2] === 0 && s.cells.v[3] === 9 && s.cells.a[3] === null, JSON.stringify(s.cells));
    check('csv: 不揃いの区切りを戻す', same(s.range.edges, [1, 2.5, 5, 7, 9]) && s.range.label === 'elapsed', JSON.stringify(s.range));
    await p.close();
    // json と一緒に選ぶと、CSV の値で上書きし、ほかは json から戻す
    const q = await page({ mode: 'carma' });
    await give(q, [[jsonName, files[jsonName]], [binsName, edited]]); await q.waitForFunction(() => AH.S.meta.mode === 'excel');
    const t = await state(q);
    check('json＋csv: CSV の値で上書きする', t.cells.v[0] === 4 && t.cells.a[0] === 8 && same(t.range, want.range) && t.log.length > want.log.length, JSON.stringify(t.cells.v));
    await q.close();
  }
  // 6. 連続の方式（CARMA，PANA の軸）：_changepoints.csv と _60hz.csv
  {
    const p = await page({ mode: 'carma', pid: 'P02' });
    await p.evaluate(() => { AH._.setAxes('pana', true); AH.S.data.points = { v: [{ t: 0, val: 5, init: true }, { t: 1.5, val: 7.25 }, { t: 4, val: 2 }], a: [{ t: 0, val: 6, init: true }, { t: 3, val: 8 }] }; });
    const fs = await build(p), pts = (await state(p)).points;
    await p.close();
    const q = await page({ mode: 'excel' });
    await q.evaluate(() => AH._.setAxes('va', true));
    await give(q, [[pick(fs, '_session.json'), fs[pick(fs, '_session.json')]]]); await q.waitForFunction(() => AH.S.meta.mode === 'carma');
    const s = await state(q);
    check('json（連続）：変化点と軸の組が戻る', same(s.points, pts) && s.axes === 'pana', s.axes);
    await q.close();
    const r = await page({ mode: 'excel' });
    await give(r, [[pick(fs, '_changepoints.csv'), fs[pick(fs, '_changepoints.csv')]]]); await r.waitForFunction(() => AH.S.meta.mode === 'carma');
    check('csv：_changepoints.csv（pa・na の列）から変化点を戻す', same((await state(r)).points, pts), JSON.stringify((await state(r)).points));
    await r.close();
    const u = await page({ mode: 'excel' });
    await give(u, [[pick(fs, '_60hz.csv'), fs[pick(fs, '_60hz.csv')]]]); await u.waitForFunction(() => AH.S.meta.mode === 'carma');
    const hp = (await state(u)).points;
    check('csv：_60hz.csv の値が変わる所を変化点にする', same(hp.v.map(x => [x.t, x.val]), [[0, 5], [1.5, 7.25], [4, 2]]) && same(hp.a.map(x => [x.t, x.val]), [[0, 6], [3, 8]]), JSON.stringify(hp));
    const st = (await state(u)).status;
    check('知らせを出す', /結果を読み込みました（1ファイル）/.test(st), st);
    await u.close();
    // 方式に合わない CSV は使わず、理由を出す
    const w = await page({ mode: 'excel' });
    await give(w, [[pick(fs, '_bins.csv'), fs[pick(fs, '_bins.csv')]], [pick(fs, '_changepoints.csv'), fs[pick(fs, '_changepoints.csv')]]]); await w.waitForFunction(() => AH.S.meta.mode === 'carma');
    const ws = await state(w);
    check('csv：方式に合わない CSV は理由を出す', /使わなかったもの：.*_bins\.csv/.test(ws.status) && same(ws.points, pts), ws.status);
    await w.screenshot({ path: out('import_series.png') });
    await w.close();
  }
  // 7. AffectRank の _ranks.csv，PANAS の _panas.csv
  {
    const p = await page({ mode: 'affectrank', pid: 'P03' });
    await p.evaluate(() => { AH.S.data.events = [{ t: 1.2, label: '↑', dv: 0, da: 1, source: 'input' }, { t: 3.4, label: '↙', dv: -1, da: -1, source: 'gamepad' }]; });
    const fs = await build(p), ev = (await state(p)).events;
    await p.close();
    const q = await page({ mode: 'excel' });
    await give(q, [[pick(fs, '_ranks.csv'), fs[pick(fs, '_ranks.csv')]]]); await q.waitForFunction(() => AH.S.meta.mode === 'affectrank');
    check('csv：_ranks.csv から変化の入力を戻す', same((await state(q)).events, ev), JSON.stringify((await state(q)).events));
    await q.close();
    const r = await page({ mode: 'panas', pid: 'P04' });
    await r.evaluate(() => { AH.S.data.items[0] = [1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6, 1, 2, 3, 4]; AH.S.data.items[1] = 'novoice'; AH.S.data.items[2] = [6, null, null, null, null, null, null, null, null, null, null, null, null, null, null, 1]; });
    const ps = await build(r), items = (await state(r)).items;
    await r.close();
    const u = await page({ mode: 'excel' });
    await give(u, [[pick(ps, '_panas.csv'), ps[pick(ps, '_panas.csv')]], [pick(ps, '_bins.csv'), ps[pick(ps, '_bins.csv')]]]); await u.waitForFunction(() => AH.S.meta.mode === 'panas');
    const us = await state(u);
    check('csv：_panas.csv から回答と発声なしを戻す', same(us.items.slice(0, 3), items.slice(0, 3)) && !/_bins/.test(us.status), JSON.stringify(us.items.slice(0, 3)) + ' ' + us.status);
    await u.close();
  }
  // 8. 読めないファイル
  {
    const p = await page({ mode: 'excel' });
    await give(p, [['memo.txt', 'x']]); await p.waitForTimeout(200);
    check('読めないファイルは知らせる', p.dialogs.some(m => /読み込めるファイルがありません/.test(m)), p.dialogs.join(' / '));
    await p.close();
  }
  await src.close();
  console.log('errors:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
