// PANAS の「発声なし」の事前設定：補助ツール（tools/novoice-from-panas.js）、setup.json の検査、実験モードでの固定
const { chromium } = require('playwright-core');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { URL, VID, BROWSER, out } = require('./_env');
const { novoiceRanges } = require('../tools/novoice-from-panas');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
const TOOL = path.join(__dirname, '..', 'tools', 'exp-check.js'), NV = path.join(__dirname, '..', 'tools', 'novoice-from-panas.js');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 実験フォルダを作る（動画は中身の無いファイル。検査はファイルがあるかだけを見る）
function folder(name, cfg, setup, real) {
  const dir = out(name);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  if (real) fs.copyFileSync(VID, path.join(dir, 'a.mp4')); else fs.writeFileSync(path.join(dir, 'a.mp4'), '');
  fs.writeFileSync(path.join(dir, 'experiment.json'), JSON.stringify(cfg, null, 1));
  fs.writeFileSync(path.join(dir, 'setup.json'), '﻿' + JSON.stringify(setup, null, 2));
  return dir;
}
const CFG = { name: 'nv', participants: { P01: [{ mode: 'panas', video: 'a.mp4', options: { autoNext: true } }] } };
const setupWith = nv => ({ settings: { listen: false }, videos: { 'a.mp4': { start: 0, end: 10, bin: 1, duration: 12, ...(nv === undefined ? {} : { novoice: nv }) } } });
const run = dir => { const r = spawnSync(process.execPath, [TOOL, dir], { encoding: 'utf8' }); return { code: r.status, text: r.stdout + r.stderr }; };

(async () => {
  // 1. 補助ツール：_panas.csv の no_voice が 1 の区間を、連続するものをまとめて [始め, 終わり] にする
  const head = 'bin,label,t_start,t_end,pa1,na1,n_answered,pa_sum,na_sum,no_voice,no_voice_preset';
  const csv = ['﻿' + head, '0,0:11,0.000,1.000,3,3,16,24,24,0,0', '1,0:10,1.000,2.000,,,0,,,1,0', '2,0:09,2.000,3.000,,,0,,,1,0', '3,0:08,3.000,4.000,3,3,16,24,24,0,0', '4,0:07,4.000,5.000,,,0,,,1,0'].join('\r\n');
  const r1 = novoiceRanges(csv);
  check('補助ツール：連続する発声なしをまとめる（BOM・CRLF も読む）', same(r1.ranges, [[1, 3], [4, 5]]) && r1.bins === 3 && r1.total === 5, JSON.stringify(r1));
  fs.writeFileSync(out('nv_panas.csv'), csv);
  const t1 = spawnSync(process.execPath, [NV, out('nv_panas.csv'), 'a.mp4'], { encoding: 'utf8' });
  check('補助ツール：動画名を付けると setup.json の videos に入れる形で出す', t1.status === 0 && same(JSON.parse(t1.stdout), { 'a.mp4': { novoice: [[1, 3], [4, 5]] } }), t1.stdout.replace(/\s+/g, ' '));
  fs.writeFileSync(out('nv_other.csv'), 'a,b\n1,2');
  const t2 = spawnSync(process.execPath, [NV, out('nv_other.csv')], { encoding: 'utf8' });
  check('補助ツール：_panas.csv でないファイルは案内を出して終了コード 1', t2.status === 1 && /_panas\.csv ではない/.test(t2.stderr), t2.stderr.trim());
  check('補助ツール：発声なしが無ければ空の一覧', same(novoiceRanges(csv.replace(/,1,0$/gm, ',0,0')).ranges, []));

  // 2. 検査：novoice の形
  const ok = run(folder('nv_ok', CFG, setupWith([[2, 4], [7.5, 9]])));
  check('検査：novoice が正しければ通る', ok.code === 0 && ok.text.includes('問題ありません'), ok.text.split('\n').slice(-3).join(' '));
  for (const [name, v] of [['終わりが始めより前', [[4, 2]]], ['数でない', [['a', 'b']]], ['配列でない', 'x'], ['動画の長さを超える', [[10, 13]]], ['3 つ組', [[1, 2, 3]]]]) {
    const r = run(folder('nv_bad', CFG, setupWith(v)));
    check(`検査：novoice が不正（${name}）なら誤り`, r.code === 1 && /novoice/.test(r.text), r.text.split('\n').find(l => /novoice/.test(l)) || r.text.slice(-120));
  }

  // 3. 実験モード：事前に印が付いた区間は固定（回答・0 キー・ボタンで変えられない）。次の区間へ自動で進むときは飛ばす
  const dir = folder('nv_exp', CFG, setupWith([[2, 4]]), true);
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const errs = [];
  const p = await (await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true })).newPage();
  p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(URL); await p.setInputFiles('#expDir', dir);
  await p.waitForSelector('#expGo'); await p.click('#expGo');
  await p.waitForFunction(() => AH._.expState() === 'ready'); await p.click('#expStart');
  await p.waitForFunction(() => AH._.expState() === 'running'); await p.waitForTimeout(400);
  await p.evaluate(() => document.activeElement && document.activeElement.blur());
  const at = t => p.evaluate(tt => { AH.video.pause(); AH.seekTo(tt); return null; }, t).then(() => p.waitForTimeout(250));
  const st = () => p.evaluate(() => ({ preset: AH.S.meta.novoice_preset, sec: AH.curSec(), head: document.querySelector('.pnHead').textContent, dis: document.querySelector('.pnNv').disabled,
    item: (AH.S.data.items || []).map(x => x === 'novoice' ? 'nv' : x ? x.filter(v => v != null).length : 0), cells: Array.from({ length: 6 }, (_x, i) => AH.S.data.cells.v[i] ?? null) }));
  check('実験モード：試行の開始時に setup.json の novoice が S.meta.novoice_preset に入る', same((await st()).preset, [[2, 4]]), JSON.stringify((await st()).preset));
  await at(2.3);
  const s1 = await st();
  check('事前に印が付いた区間：見出しに「事前設定。変更できません」、ボタンは押せない', s1.sec === 2 && /事前設定/.test(s1.head) && s1.dis, s1.head);
  const before = JSON.stringify((await st()).item);
  for (const k of ['Digit3', 'Numpad5', 'Digit0', 'Backspace']) await p.keyboard.press(k);
  await p.click('.pnRow:nth-child(1) button[data-v="2"]', { force: true }).catch(() => {});
  await p.waitForTimeout(150);
  const s2 = await st();
  check('事前に印が付いた区間：数字・0・Backspace・ボタンでは何も変わらない（固定）', JSON.stringify(s2.item) === before && /事前設定/.test(s2.head), JSON.stringify(s2.item));
  check('事前に印が付いた区間：区間の値は 0（区間 2・3）、ほかは空', same(s2.cells, [null, null, 0, 0, null, null]), JSON.stringify(s2.cells));
  const un = await p.evaluate(() => { AH._.undo(); return AH.S.data.cells.v.slice(2, 4); });
  check('Ctrl+Z でも固定の印は外れない', same(un, [0, 0]), JSON.stringify(un));
  // 区間 1 の 16 項目に答えると、次の区間（2・3 は固定）を飛ばして区間 4 へ進む
  await at(1.3); await p.evaluate(() => document.activeElement && document.activeElement.blur());
  for (let k = 0; k < 16; k++) await p.keyboard.press('Digit3');
  await p.waitForTimeout(400);
  const s3 = await st();
  check('「全項目に答えたら次の区間へ」：事前に印が付いた区間 2・3 を飛ばして区間 4 へ進む', s3.sec === 4, `sec=${s3.sec}`);
  // 書き出し
  const f = await p.evaluate(() => { const fs = AH._.buildFiles(), pn = fs.find(x => x.name.endsWith('_panas.csv')).text.split('\n'); return { head: pn[0].split(',').slice(-2), rows: pn.slice(1, 6).map(r => r.split(',').slice(-2).join('/')), meta: JSON.parse(fs.find(x => x.name.endsWith('_session.json')).text).meta.novoice_preset }; });
  check('書き出し：no_voice と no_voice_preset の列。区間 2・3 は 1/1、ほかは 0/0。meta に novoice_preset が残る', same(f.head, ['no_voice', 'no_voice_preset']) && same(f.rows, ['0/0', '0/0', '1/1', '1/1', '0/0']) && same(f.meta, [[2, 4]]), JSON.stringify(f));
  // 4. ほかの区間方式（Affect Grid・SAM・Excel）：事前に印が付いた区間は値が 0 で固定。入力は効かず、自動で次の区間へ進むときは飛ばす
  async function openExp(mode, options) {
    const d = folder('nv_exp_' + mode, { name: 'nv', participants: { P01: [{ mode, video: 'a.mp4', ...(options ? { options } : {}) }] } }, setupWith([[2, 4]]), true);
    const q = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
    q.on('pageerror', e => errs.push(e.message)); q.on('dialog', x => x.accept());
    await q.goto(URL); await q.setInputFiles('#expDir', d);
    await q.waitForSelector('#expGo'); await q.click('#expGo');
    await q.waitForFunction(() => AH._.expState() === 'ready'); await q.click('#expStart');
    await q.waitForFunction(() => AH._.expState() === 'running'); await q.waitForTimeout(400);
    await q.evaluate(() => document.activeElement && document.activeElement.blur());
    return q;
  }
  const seek = (q, t) => q.evaluate(tt => { AH.video.pause(); AH.seekTo(tt); }, t).then(() => q.waitForTimeout(250));
  const vals = q => q.evaluate(() => [2, 3, 1].map(s => [AH.S.data.cells.v[s] ?? null, AH.S.data.cells.a[s] ?? null]));
  const click = async (q, how) => {
    if (how === 'grid') { const b = await q.locator('canvas.plane').boundingBox(); await q.mouse.click(b.x + b.width * 0.8, b.y + b.height * 0.2); }
    else if (how === 'sam') { await q.click('.samRow.v button >> nth=8'); await q.click('.samRow.a button >> nth=8'); }
    await q.waitForTimeout(200);
  };
  for (const [mode, how] of [['affectgrid', 'grid'], ['sam', 'sam']]) {
    const q = await openExp(mode, { autoNext: true });
    const s0 = await vals(q);
    check(`${mode}：事前に印が付いた区間（2・3）は値が 0、ほかは空`, same(s0, [[0, 0], [0, 0], [null, null]]), JSON.stringify(s0));
    await seek(q, 2.3); await click(q, how);
    check(`${mode}：その区間では入力が効かず、値は 0 のまま`, same((await vals(q)).slice(0, 2), [[0, 0], [0, 0]]), JSON.stringify(await vals(q)));
    await seek(q, 1.3); await click(q, how);
    const s2 = await q.evaluate(() => ({ cell: [AH.S.data.cells.v[1], AH.S.data.cells.a[1]], sec: AH.curSec() }));
    check(`${mode}：区間 1 に入力すると、事前に印が付いた区間 2・3 を飛ばして区間 4 へ進む`, s2.cell[0] > 0 && s2.cell[1] > 0 && s2.sec === 4, JSON.stringify(s2));
    await q.close();
  }
  {
    const q = await openExp('excel');
    const e1 = await q.evaluate(() => { const i = document.querySelector('input[data-ax=v][data-s="2"]'), j = document.querySelector('input[data-ax=v][data-s="1"]'); return { ro: i.readOnly, cls: i.classList.contains('nvLock'), val: i.value, other: j.readOnly }; });
    check('excel：事前に印が付いた列は読み取り専用で 0 が入っている。ほかの列は打てる', e1.ro && e1.cls && e1.val === '0' && !e1.other, JSON.stringify(e1));
    await q.click('input[data-ax=v][data-s="2"]'); await q.keyboard.type('7'); await q.waitForTimeout(150);
    check('excel：固定の列に打っても値は 0 のまま', same((await vals(q)).slice(0, 2), [[0, 0], [0, 0]]), JSON.stringify(await vals(q)));
    await q.close();
  }
  for (const [name, o] of [['カスタム（Excel の形）', { rep: 'excel', values: 'int' }], ['カスタム（区間内で変化）', { rep: 'excel', values: 'int', curve: 'on', curveInput: 'draw' }]]) {
    const q = await openExp('custom', o);
    const c1 = await q.evaluate(() => { const i = document.querySelector('input[data-ax=v][data-s="2"]'), td = document.querySelector('td[data-ax=v][data-s="2"]'); return { ro: !!i && i.readOnly, cv: !!td && td.classList.contains('cv') }; });
    const s0 = await vals(q);
    check(`${name}：事前に印が付いた区間（2・3）は値が 0 で、ほかは空`, same(s0, [[0, 0], [0, 0], [null, null]]), JSON.stringify(s0));
    await q.evaluate(() => AH.setCells(2, { v: 5, a: 5 }, 'input')); await q.evaluate(() => AH.setCell('v', 3, 7, 'input'));
    if (o.curve) {   // 区間内で変化のボタン（形・発声なし・変化にする）も、固定の区間では何も変えない
      await q.evaluate(() => { for (const f of [() => AH.curveReshape(2, 'line', ['v', 'a']), () => AH.curveNoVoice(3, ['v', 'a']), () => AH.curveMark(2, ['v', 'a']), () => AH.curveUnmark(3, ['v', 'a'])]) f(); });
      const cc = await q.evaluate(() => ({ cells: [2, 3].map(s => [AH.S.data.cells.v[s], AH.S.data.cells.a[s]]), shapes: (AH.S.data.shapes || []).length, undo: AH.S.undo.length }));
      check(`${name}：形・発声なし・変化にする、のボタンも固定の区間では何も変えない`, same(cc.cells, [[0, 0], [0, 0]]) && cc.shapes === 0 && cc.undo === 0, JSON.stringify(cc));
    }
    check(`${name}：コードから値を入れても固定の区間は 0 のまま`, same((await vals(q)).slice(0, 2), [[0, 0], [0, 0]]), JSON.stringify({ c1, v: await vals(q) }));
    await q.close();
  }
  // 5. 区間表でない方式の動画に novoice があれば警告（効かないため）
  const wk = run(folder('nv_key', { name: 'nv', participants: { P01: [{ mode: 'key', video: 'a.mp4' }] } }, setupWith([[2, 4]])));
  check('検査：区間ごとに値を入れない方式（テンキー）の動画に novoice があれば警告', wk.code === 0 && /方式「key」には効きません/.test(wk.text), wk.text.split('\n').find(l => /効きません/.test(l)) || wk.text.slice(-150));
  console.log('errors:', errs.length ? errs.join('|') : 'none');
  await browser.close();
})();
