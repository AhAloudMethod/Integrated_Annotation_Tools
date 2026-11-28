// 画面の中のアンケート（core/survey.js と core/experiment.js）：実験フォルダの定義（form．SurveyJS）と同梱の雛形（raw-tlx・nasa-tlx．元の tlx/nasatlx-ja.html の埋め込み）を画面に重ねて出し、
// 回答を試行の zip の _survey.csv（1 行 1 設問）に入れる。既定（必須・7 段階）、スライダーを動かさなかったときの空の値、欄への文字の入力、
// URL のアンケートとの混在、答える前に抜けたときの zip の書き出し、定義の誤りの検査を見る
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const { URL, VID, BROWSER, out } = require('./_env');
const { convert } = require('../tools/gform/convert');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);

function makeFolder(name, files, videos) {
  const dir = out(name);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  for (const v of videos) fs.copyFileSync(VID, path.join(dir, v));
  for (const [f, obj] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), typeof obj === 'string' ? obj : JSON.stringify(obj, null, 1)); }
  return dir;
}
// 格納方式（圧縮なし）の zip を読む → { 名前: 中身の文字列（BOM を除く） }
function readZip(buf) {
  const files = {};
  const at = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const n = buf.readUInt16LE(at + 10); let c = buf.readUInt32LE(at + 16);
  for (let k = 0; k < n; k++) {
    const size = buf.readUInt32LE(c + 20), nl = buf.readUInt16LE(c + 28), el = buf.readUInt16LE(c + 30), cl = buf.readUInt16LE(c + 32), off = buf.readUInt32LE(c + 42);
    const name = buf.slice(c + 46, c + 46 + nl).toString('utf8');
    const lnl = buf.readUInt16LE(off + 26), lel = buf.readUInt16LE(off + 28);
    files[name] = buf.slice(off + 30 + lnl + lel, off + 30 + lnl + lel + size).toString('utf8').replace(/^﻿/, '');
    c += 46 + nl + el + cl;
  }
  return files;
}
const csvRows = t => t.trim().split('\n').map(l => { const r = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { r.push(cur); cur = ''; } else cur += ch; } r.push(cur); return r; });

const POST = {
  title: '事後アンケート',
  pages: [
    { elements: [
      { type: 'rating', name: 'ease', title: '評価はしやすかったですか', minRateDescription: '全くしやすくない', maxRateDescription: '非常にしやすい' },
      { type: 'matrix', name: 'tool', title: 'ツールについて', columns: [1, 2, 3], rows: [{ value: 'learn', text: '覚えやすい' }, { value: 'again', text: 'また使いたい' }] },
      { type: 'checkbox', name: 'used', title: '使った機能', choices: ['区切り', 'ホイール', '曲線'] },
    ] },
    { elements: [
      { type: 'slider', name: 'fun', title: '楽しさ', min: 0, max: 100, isRequired: false },
      { type: 'comment', name: 'free', title: '感想', isRequired: false },
    ] },
  ],
};
const SETUP = { settings: { f0: false, listen: false, review: false, videoWindow: false, timer: false }, videos: { 'a.mp4': { start: 0, end: 4, bin: 2 }, 'b.mp4': { start: 0, end: 4, bin: 2 } } };
const GOOD = makeFolder('survey_good', {
  'experiment.json': {
    name: 'svtest',
    survey: [{ form: 'surveys/post.json', label: '事後アンケートに答える' }, { builtin: 'raw-tlx' }],
    finalSurvey: [{ builtin: 'nasa-tlx', id: 'tlx_final' }, 'https://survey.test/final?pid={pid}'],
    participants: { P01: [{ mode: 'excel', video: 'a.mp4' }, { mode: 'excel', video: 'b.mp4' }], P02: [{ mode: 'excel', video: 'b.mp4' }, { mode: 'excel', video: 'a.mp4' }] },
  },
  'setup.json': SETUP,
  'surveys/post.json': POST,
}, ['a.mp4', 'b.mp4']);
const BADFORM = makeFolder('survey_bad', {
  'experiment.json': { name: 'svbad', survey: [{ form: 'surveys/broken.json' }, { form: 'surveys/dup.json' }, { form: 'surveys/none.json' }], participants: { P01: [{ mode: 'excel', video: 'a.mp4' }] } },
  'setup.json': SETUP,
  'surveys/broken.json': '{ "pages": [',
  'surveys/dup.json': { elements: [{ type: 'text', name: 'x' }, { type: 'text', name: 'x' }, { type: 'rating', name: 'r' }] },
}, ['a.mp4']);

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
  await ctx.route('https://survey.test/**', r => r.fulfill({ contentType: 'text/html', body: '<p>survey</p>' }));
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  const dialogs = []; p.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  const downloads = [];
  p.on('download', d => downloads.push(d));
  const names = () => downloads.map(d => d.suggestedFilename());
  const zip = async name => { const d = downloads.find(x => x.suggestedFilename() === name); return d ? readZip(fs.readFileSync(await d.path())) : null; };
  await p.goto(URL);
  await p.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase('ahann_exp'); });
  await p.reload();
  const vis = sel => p.evaluate(s => { const el = document.querySelector(s); return !!el && !el.hidden && getComputedStyle(el).display !== 'none' && !!el.offsetParent; }, sel);
  const state = () => p.evaluate(() => AH._.expState());
  const runTrial = async () => {
    await p.waitForFunction(() => AH._.expState() === 'ready');
    await p.click('#expStart');
    await p.click('#expDoneBtn');
    await p.waitForFunction(() => ['done', 'finished'].includes(AH._.expState()));
    await p.waitForTimeout(400);
  };
  const next = () => p.locator('#ahSurvey .sd-navigation__next-btn').click();
  const done = () => p.locator('#ahSurvey .sd-navigation__complete-btn').click();
  // NASA-TLX（埋め込んだ元のページ）：尺度の番号と値（5〜100）の枠を押す。一対比較は、順に並べた尺度で先のもの（mental > physical > …）を選ぶ
  const ORDER = ['mental', 'physical', 'temporal', 'performance', 'effort', 'frustration'];
  const NAMES = ['知的・知覚的要求', '身体的要求', 'タイムプレッシャー', '作業成績', '努力', 'フラストレーション'];
  const tlx = () => p.frameLocator('#ahSurvey iframe.ahTlxFrame');
  const rateAll = async vals => { await tlx().locator('#t_0_5').waitFor(); for (const [k, v] of Object.entries(vals)) await tlx().locator(`#t_${ORDER.indexOf(k)}_${v}`).click(); };
  const pickPairs = async () => {
    for (let k = 0; k < 15; k++) {
      const a = await tlx().locator('#pair1').inputValue(), b = await tlx().locator('#pair2').inputValue();
      await tlx().locator(NAMES.indexOf(a) < NAMES.indexOf(b) ? '#pair1' : '#pair2').click();
    }
  };
  const slider = (name, v) => p.evaluate(([n, val]) => {   // スライダーを動かす（つまみのドラッグの代わりに、範囲の入力に値を入れる）
    const q = [...document.querySelectorAll('#ahSurvey .sd-question')].find(e => e.getAttribute('data-name') === n);
    const inp = q.querySelector('input.sd-slider__input');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(inp, String(val));
    inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true }));
  }, [name, v]);

  // ---- 定義の誤り：読めない JSON・name の重複・無いファイルは誤り、両端のラベルの無い評定は警告
  await p.setInputFiles('#expDir', BADFORM);
  await p.waitForSelector('#expCancel');
  const bad = await p.$eval('#expCover', c => c.textContent);
  check('定義の誤り：フォルダに無い定義は誤りにする（中身を読む前に止める）', bad.includes('surveys/none.json」がフォルダにありません'), bad);
  await p.click('#expCancel');
  fs.rmSync(path.join(BADFORM, 'experiment.json'));
  fs.writeFileSync(path.join(BADFORM, 'experiment.json'), JSON.stringify({ name: 'svbad', survey: [{ form: 'surveys/broken.json' }, { form: 'surveys/dup.json' }], participants: { P01: [{ mode: 'excel', video: 'a.mp4' }] } }));
  await p.setInputFiles('#expDir', BADFORM);
  await p.waitForSelector('#expCancel');
  const bad2 = await p.$eval('#expCover', c => c.textContent);
  check('定義の誤り：読めない JSON と name の重複を誤りにして始めさせない', bad2.includes('broken.json」を JSON として読めません') && bad2.includes('name「x」が重複') && !(await p.$('#expGo')), bad2);
  await p.click('#expCancel');
  const builtinBad = await p.evaluate(() => AH._.expCheck.check({ name: 'x', survey: [{ builtin: 'sus2' }], participants: { P01: [{ mode: 'excel', video: 'a.mp4' }] } }, { modes: ['excel'], axes: ['va'], has: () => true }).errors.join(' '));
  check('定義の誤り：無い builtin は誤り', builtinBad.includes('builtin「sus2」はありません'), builtinBad);
  check('SurveyJS は画面の中のアンケートを出すまで読み込まない', await p.evaluate(() => !window.Survey && !document.querySelector('script[src*="surveyjs"]')));

  // ---- P01 の 1 つ目の試行：完了してもすぐには zip を書き出さない
  await p.setInputFiles('#expDir', GOOD);
  await p.waitForSelector('#expGo');
  const warn = await p.$eval('#expCover', c => c.textContent);
  check('両端のラベルのある評定では警告を出さない', !warn.includes('両端のラベル'), warn);
  await p.click('#expGo');
  await runTrial();
  check('画面の中のアンケートがある試行は、完了の時点では zip を書き出さない', !names().length, JSON.stringify(names()));
  const held = await p.evaluate(() => new Promise(ok => { const r = indexedDB.open('ahann_exp', 1); r.onsuccess = () => { const q = r.result.transaction('zips').objectStore('zips').getAllKeys(); q.onsuccess = () => ok(q.result); }; }));
  check('完了の時点でブラウザには zip を残す（読み込み直しても失わない）', JSON.stringify(held) === '["svtest|P01|0"]', JSON.stringify(held));
  check('自動保存は答える前には消さない', await p.evaluate(() => Object.keys(localStorage).some(k => k.startsWith('ahann4:excel:P01:'))));
  const labels = await p.$$eval('.expSurvey', bs => bs.map(b => b.textContent));
  const guide = await p.$eval('#expCard', c => c.textContent);
  check('ボタンの文言：label があればそれ、雛形は雛形の名前。画面の中だけなら「この画面に戻って」の案内を出さない',
    JSON.stringify(labels) === '["事後アンケートに答える","NASA-TLX（評定のみ） に答える"]' && !guide.includes('この画面に戻って') && !(await vis('#expNext')), JSON.stringify(labels));

  // 自作の定義：既定で必須・7 段階、欄に文字を打てる
  await p.click('#expSurvey');
  await p.waitForSelector('#ahSurvey .sd-question');
  check('アンケートを画面に重ねて出し、SurveyJS をこのときに読み込む', (await p.evaluate(() => { const b = document.getElementById('ahSurvey'); return !b.hidden && getComputedStyle(b).position === 'fixed' && b.getBoundingClientRect().height > 0; })) && await p.evaluate(() => !!window.Survey));
  const nRate = await p.locator('#ahSurvey .sd-rating__item').count();
  check('段階の数を書いていない評定は 7 段階にする', nRate === 7, String(nRate));
  await next();
  const errN = await p.locator('#ahSurvey .sd-question--error').count();
  check('isRequired を書いていない設問は必須にする（答えずに次へ進めない）', errN === 3 && (await p.locator('#ahSurvey .sd-rating__item').count()) === 7, String(errN));
  await p.locator('#ahSurvey .sd-rating__item').nth(4).click();
  for (const r of await p.locator('#ahSurvey .sd-matrix__row').all()) await r.locator('.sd-matrix__label').nth(1).click();
  await p.locator('#ahSurvey').getByText('ホイール', { exact: true }).click(); await p.locator('#ahSurvey').getByText('曲線', { exact: true }).click();
  await next();
  await p.locator('#ahSurvey textarea').click();
  await p.keyboard.type('とても good');
  const typed = await p.evaluate(() => ({ text: document.querySelector('#ahSurvey textarea').value, paused: AH.video.paused }));
  check('自由記述に文字（Space を含む）を打てて、動画は再生されない', typed.text === 'とても good' && typed.paused, JSON.stringify(typed));
  await done();
  await p.waitForFunction(() => document.getElementById('ahSurvey').hidden);
  const after1 = await p.evaluate(() => ({ btn: document.getElementById('expSurvey').textContent, dis: document.getElementById('expSurvey').disabled, next: !document.getElementById('expAfter').hidden }));
  check('答えたら閉じてボタンを「回答済み」にし、残りのアンケートがあるうちは「次へ」を出さない', after1.btn.endsWith('（回答済み）') && after1.dis && !after1.next && !names().length, JSON.stringify(after1));

  // Raw TLX：元の NASA-TLX のページ（tlx/nasatlx-ja.html）を画面の中に埋め込む
  await p.click('#expSurvey2');
  await tlx().locator('#t_0_5').waitFor();
  const tlxUi = await p.evaluate(() => { const f = document.querySelector('#ahSurvey iframe.ahTlxFrame'), b = document.getElementById('ahSurvey').getBoundingClientRect();
    return { src: f.getAttribute('src'), full: b.width === innerWidth && b.height === innerHeight, fixed: getComputedStyle(document.getElementById('ahSurvey')).position }; });
  check('Raw TLX は元の NASA-TLX のページを画面いっぱいの箱に埋め込んで出す（6 尺度 × 20 個の枠）',
    tlxUi.src === 'tlx/nasatlx-ja.html?embed=1&raw=1' && (tlxUi.cells = await tlx().locator('td[id^="t_"]').count()) === 120 && tlxUi.full && tlxUi.fixed === 'fixed', JSON.stringify(tlxUi));
  await tlx().locator('#div_part1 input.next').click();
  await p.waitForTimeout(200);
  check('Raw TLX：選ばずに次へ進むと元のページの注意が出る', dialogs.includes('すべてのスケールで値を選択してください'), JSON.stringify(dialogs));
  const vals = { mental: 50, physical: 10, temporal: 30, performance: 20, effort: 60, frustration: 40 };
  await rateAll(vals);
  await tlx().locator('#div_part1 input.next').click();
  await p.waitForFunction(() => document.getElementById('ahSurvey').hidden);
  await p.waitForTimeout(400);
  check('すべてに答えたら zip を 1 つ書き出し、「次へ」を出す', JSON.stringify(names()) === '["P01_t01_a_excel.zip"]' && (await vis('#expNext')), JSON.stringify(names()));
  const z1 = await zip('P01_t01_a_excel.zip');
  const sv = csvRows(z1['P01_t01_a_excel_survey.csv'] || '');
  const get = (id, q) => (sv.find(r => r[0] === id && r[1] === q) || [])[2];
  check('zip に _survey.csv（survey・question・value・title・start_iso・end_iso）が入る', JSON.stringify(sv[0]) === '["survey","question","value","title","start_iso","end_iso"]', JSON.stringify(sv[0]));
  check('回答：評定・表の行ごと・複数選択（;）・自由記述、動かしていないスライダーは空の値',
    get('post', 'ease') === '5' && get('post', 'tool.learn') === '2' && get('post', 'tool.again') === '2' && get('post', 'used') === 'ホイール;曲線' && get('post', 'free') === 'とても good' && get('post', 'fun') === ''
    && sv.some(r => r[0] === 'post' && r[1] === 'fun'), JSON.stringify(sv.filter(r => r[0] === 'post')));
  check('Raw TLX：元のページの列（<尺度>_rating など）で評定と raw_tlx（平均）を残し、variant は raw、一対比較の列は空。CSV はダウンロードしない',
    get('raw-tlx', 'mental_rating') === '50' && get('raw-tlx', 'raw_tlx') === '35' && get('raw-tlx', 'variant') === 'raw' && get('raw-tlx', 'overall') === '' && !sv.some(r => r[1] === 'pid')
    && !names().some(n => n.endsWith('_tlx.csv')),
    JSON.stringify(sv.filter(r => r[0] === 'raw-tlx')));
  check('回答の行に答え始めと答え終わりの時刻が入る', sv.slice(1).every(r => /^\d{4}-/.test(r[4]) && /^\d{4}-/.test(r[5]) && r[4] <= r[5]));
  const prog = await p.evaluate(() => JSON.parse(localStorage.getItem('ahann_exp:svtest:P01')).done);
  const sumRow = csvRows(z1['P01_svtest_trials.csv'])[1], sumHead = csvRows(z1['P01_svtest_trials.csv'])[0];
  check('要約の survey_opened は答えた数（zip の中の要約にも入る）', prog[0].survey_opened === 2 && sumRow[sumHead.indexOf('survey_opened')] === '2', JSON.stringify(prog[0]));
  check('書き出した後は自動保存を消す', await p.evaluate(() => !Object.keys(localStorage).some(k => k === 'ahann4:excel:P01:a.mp4')));

  // ---- 2 つ目（最後）の試行：試行のアンケート・NASA-TLX（一対比較つき）・URL の finalSurvey
  await p.click('#expNext');
  await runTrial();
  const labels2 = await p.$$eval('.expSurvey', bs => bs.map(b => b.textContent));
  const guide2 = await p.$eval('#expCard', c => c.textContent);
  check('最後の試行：finalSurvey の雛形と URL も並べ、URL があれば「この画面に戻って」の案内を出す',
    JSON.stringify(labels2) === '["事後アンケートに答える","NASA-TLX（評定のみ） に答える","NASA-TLX に答える","アンケート 4 を開く"]' && guide2.includes('この画面に戻って'), JSON.stringify(labels2));
  await p.click('#expSurvey');
  await p.waitForSelector('#ahSurvey .sd-question');
  await p.locator('#ahSurvey .sd-rating__item').nth(0).click();
  for (const r of await p.locator('#ahSurvey .sd-matrix__row').all()) await r.locator('.sd-matrix__label').nth(0).click();
  await p.locator('#ahSurvey').getByText('区切り', { exact: true }).click();
  await next(); await slider('fun', 70); await done();
  await p.waitForFunction(() => document.getElementById('ahSurvey').hidden);
  await p.click('#expSurvey2');
  await rateAll(vals);
  await tlx().locator('#div_part1 input.next').click();
  await p.waitForFunction(() => document.getElementById('ahSurvey').hidden);
  // NASA-TLX（一対比較つき）：tally は mental 5・physical 4・temporal 3・performance 2・effort 1・frustration 0 になる
  await p.click('#expSurvey3');
  await rateAll(vals);
  await tlx().locator('#div_part1 input.next').click();
  await tlx().locator('#div_part2 input.next').click();
  await pickPairs();
  await p.waitForFunction(() => document.getElementById('ahSurvey').hidden);
  check('URL のアンケートが残るうちは zip を書き出さない', JSON.stringify(names()) === '["P01_t01_a_excel.zip"]', JSON.stringify(names()));
  const [pop] = await Promise.all([ctx.waitForEvent('page'), p.click('#expSurvey4')]);
  await pop.waitForLoadState();
  check('URL のアンケートは今までどおり別のタブで開く', pop.url() === 'https://survey.test/final?pid=P01', pop.url());
  await pop.close();
  await p.waitForTimeout(400);
  check('すべて済んだら最後の試行の zip を書き出し、終わりの案内を出す', names().includes('P01_t02_b_excel.zip') && (await vis('#expSum')), JSON.stringify(names()));
  const sv2 = csvRows((await zip('P01_t02_b_excel.zip'))['P01_t02_b_excel_survey.csv'] || '');
  const get2 = (id, q) => (sv2.find(r => r[0] === id && r[1] === q) || [])[2];
  // overall = (50*5 + 10*4 + 30*3 + 20*2 + 60*1 + 40*0) / 15 = 480 / 15 = 32
  check('NASA-TLX：id（tlx_final）を survey 列に使い、一対比較（pairs）・tally・weight・overall・raw_tlx を残す',
    get2('tlx_final', 'variant') === 'weighted' && get2('tlx_final', 'mental_tally') === '5' && get2('tlx_final', 'frustration_tally') === '0' && get2('tlx_final', 'mental_weight') === '0.3333'
    && get2('tlx_final', 'overall') === '32' && get2('tlx_final', 'raw_tlx') === '35' && (get2('tlx_final', 'pairs') || '').split(' ').length === 15, JSON.stringify(sv2.filter(r => r[0] === 'tlx_final').map(r => r.slice(1, 3))));
  check('最後の試行の zip には試行のアンケートと finalSurvey の回答が入る（スライダーを動かせば値が入る）', get2('post', 'fun') === '70' && get2('post', 'ease') === '1' && get2('raw-tlx', 'raw_tlx') === '35');

  // ---- P02：答える前に Ctrl+Shift+E で抜けると、回答の無い zip を書き出す
  await Promise.all([p.waitForNavigation({ waitUntil: 'load' }), p.keyboard.press('Control+Shift+KeyE')]);
  await p.setInputFiles('#expDir', GOOD);
  await p.waitForSelector('#expGo');
  await p.selectOption('#expPid', 'P02');
  await p.click('#expGo');
  await runTrial();
  await p.click('#expSurvey');
  await p.waitForSelector('#ahSurvey .sd-question');
  await Promise.all([p.waitForNavigation({ waitUntil: 'load' }), p.keyboard.press('Control+Shift+KeyE')]);
  await p.waitForTimeout(300);
  const z3 = await zip('P02_t01_b_excel.zip');
  check('答える前に抜けると、評価の zip（回答なし）を書き出す', !!z3 && !Object.keys(z3).some(n => n.endsWith('_survey.csv')) && !!z3['P02_t01_b_excel_session.json'], JSON.stringify(names()));

  // ---- Google フォームから変換した定義（tools/gform/convert.js）を画面の中で出して答える
  const gf = convert(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'gform-export.json'), 'utf8'))).form;
  const optional = JSON.parse(JSON.stringify(gf)); for (const pg of optional.pages) for (const e of pg.elements) if (e.type !== 'html') { e.isRequired = false; delete e.isAllRowRequired; }
  await p.evaluate(f => { document.documentElement.dataset.theme = 'dark'; window.__gf = AH._.survey.run({ form: f, id: 'gform' }); }, optional);
  await p.waitForSelector('#ahSurvey .sd-question');
  const gfUi = await p.evaluate(() => ({ html: !!document.querySelector('#ahSurvey .sd-html h3'), matrix: !!document.querySelector('#ahSurvey .sd-matrix'), other: [...document.querySelectorAll('#ahSurvey .sd-item__control-label')].some(e => e.textContent.includes('その他')) }));
  check('変換した定義：見出し（html）・表・「その他」を画面に出す', gfUi.html && gfUi.matrix && gfUi.other, JSON.stringify(gfUi));
  await p.locator('#ahSurvey').getByText('ある', { exact: true }).click();
  await next();
  const inp = await p.evaluate(() => [...document.querySelectorAll('#ahSurvey input[type=text]')].map(i => { const c = getComputedStyle(i); return { w: i.getBoundingClientRect().width, box: i.closest('.sd-formbox').getBoundingClientRect().width, bg: c.backgroundColor, color: c.color }; }));
  check('ダーク表示でも、1 行の欄は外枠いっぱいで、本体の背景（黒）と文字の色が入らない',
    inp.length >= 2 && inp.every(x => x.w > x.box * 0.8 && x.bg === 'rgba(0, 0, 0, 0)' && x.color === 'rgb(31, 35, 40)'), JSON.stringify(inp));
  await p.locator('#ahSurvey .sd-table__row').filter({ hasText: '本番' }).locator('.sd-item__decorator').nth(1).click();
  await done();
  const gfRows = await p.evaluate(() => window.__gf.then(r => r.rows));
  const gget = q => (gfRows.find(r => r[1] === q) || [])[2];
  check('変換した定義：回答を行にする（チェックボックスのグリッドは行ごとの値、答えていない設問は空の値）',
    gget('q03') === 'ある' && gget('q07.本番') === 'ホイール' && gget('q07.練習') === '' && gget('q01') === '' && !gfRows.some(r => r[1].startsWith('section') || r[1] === 'answer') && gfRows.length === 12, JSON.stringify(gfRows.map(r => r.slice(1, 3))));

  check('ページのエラーが無い', !errs.length, errs.join(' / '));
  await browser.close();
})().catch(e => { console.log('FAIL 例外', e.message); process.exit(1); });
