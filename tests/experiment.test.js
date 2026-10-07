// 実験モード（core/experiment.js）：実験フォルダの読み込みと検査、隠す要素、開始前に操作が効かないこと、
// 開始から完了までの時間と書き出し、次の試行への切り替えと設定の適用、抜けたときに設定が戻ること
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const { URL, VID, BROWSER, out } = require('./_env');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
const JOY = 'Test Joystick (Vendor: 1234 Product: 0001)';

// 実験フォルダを作る（tests/out/ の下。動画はテスト動画の複製）
function makeFolder(name, cfg, videos) {
  const dir = out(name);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  for (const v of videos) fs.copyFileSync(VID, path.join(dir, v));
  fs.writeFileSync(path.join(dir, 'experiment.json'), JSON.stringify(cfg, null, 1));
  return dir;
}
const GOOD = makeFolder('exp_good', {
  name: 'exptest',
  settings: { f0: false },
  survey: 'https://survey.test/form?pid={pid}&t={trial}&m={mode}&v={video}',
  participants: {
    P01: [
      { mode: 'emujoy', video: 'practice.mp4', practice: true, options: { face: false } },
      { mode: 'excel', video: 'a.mp4', settings: { review: true }, range: { start: 1, end: 11, bin: 2 } },
    ],
    P02: [{ mode: 'sam', video: 'a.mp4' }],
  },
}, ['practice.mp4', 'a.mp4']);
const BAD = makeFolder('exp_bad', {
  name: 'bad',
  settings: { rate: 2, nosuch: 1 },
  participants: { P01: [{ mode: 'nosuch', video: 'a.mp4' }, { mode: 'excel', video: 'missing.mp4' }, { mode: 'excel', video: 'a.mp4' }, { mode: 'excel', video: 'a.mp4' }] },
}, ['a.mp4']);

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true });
  await ctx.addInitScript(() => {
    window.__pads = [];
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => { const a = [null, null, null, null]; for (const p of window.__pads) a[p.index] = p; return a; } });
    window.__connect = (id, index) => { const p = { id, index, connected: true, mapping: '', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 8 }, () => ({ pressed: false, touched: false, value: 0 })) }; window.__pads.push(p); return p; };
  });
  await ctx.route('https://survey.test/**', r => r.fulfill({ contentType: 'text/html', body: '<p>survey</p>' }));
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  const downloads = [];
  p.on('download', d => downloads.push(d));
  await p.goto(URL);
  // 参加者のブラウザに残った設定（実験では使わず、抜けたら戻る）
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('ahann_axes', 'pana'); localStorage.setItem('ahann_f0', '1'); });
  await p.reload();
  const vis = sel => p.evaluate(s => { const el = document.querySelector(s); return !!el && !el.hidden && getComputedStyle(el).display !== 'none' && !!el.offsetParent; }, sel);
  const state = () => p.evaluate(() => AH._.expState());

  // ---- 誤りのある設定ファイル：誤りを一覧で出して始めない
  await p.setInputFiles('#expDir', BAD);
  await p.waitForSelector('.expErr li');
  const bad = await p.$$eval('.expErr li', ls => ls.map(l => l.textContent));
  const want = ['rate', 'nosuch', '方式「nosuch」', 'missing.mp4', '重複'];
  check('誤りのある設定ファイルは誤りを一覧で出す', want.every(w => bad.some(b => b.includes(w))), JSON.stringify(bad));
  await p.click('#expCancel');
  check('閉じると覆いが消え、実験モードにならない', !(await vis('#expCover')) && (await state()) === null);

  // ---- 正しいフォルダ：参加者と始める試行を選ぶ
  await p.setInputFiles('#expDir', GOOD);
  await p.waitForSelector('#expGo');
  const from = await p.$$eval('#expFrom option', os => os.map(o => o.textContent));
  check('始める試行の一覧に練習と方式・動画が出る', from.length === 2 && from[0].includes('練習') && from[1].includes('a.mp4'), JSON.stringify(from));
  await p.click('#expGo');
  await p.waitForFunction(() => AH._.expState() === 'ready');
  const hidden = {};
  for (const s of ['#pid', '#mode', '#openBtn', '#expBtn', '#setBtn', '#rgBtn', '#helpBtn', '#tlBtn', '#exportBtn', '#reviewBtn', '#voiceBtn', '#vwinBtn']) hidden[s] = !(await vis(s));
  check('参加者 ID・方式・設定・評価区間・グラフ・書き出し・見返し・音声入力・別ウィンドウを隠す', Object.values(hidden).every(Boolean), JSON.stringify(hidden));
  const r1 = await p.evaluate(() => ({ mode: AH.S.meta.mode, pid: AH.S.meta.participant, face: AH.S.meta.options.face, axes: AH._.axesId(), f0: AH._.f0Shown(),
    opt: [...document.querySelectorAll('#panel .optCtl')].every(e => getComputedStyle(e).display === 'none') }));
  check('1 つ目の試行：方式・参加者・方式の設定・全体の設定（VA、F0 なし）を当て、方式の設定の欄を隠す',
    r1.mode === 'emujoy' && r1.pid === 'P01' && r1.face === false && r1.axes === 'va' && r1.f0 === false && r1.opt, JSON.stringify(r1));

  // 開始前：キー・ゲームパッドのボタン 0 が効かない
  await p.evaluate(id => window.__connect(id, 0), JOY); await p.waitForTimeout(150);
  await p.keyboard.press('Space'); await p.keyboard.press('KeyR');
  await p.evaluate(() => { window.__pads[0].buttons[0].pressed = true; }); await p.waitForTimeout(100);
  await p.evaluate(() => { window.__pads[0].buttons[0].pressed = false; }); await p.waitForTimeout(100);
  const pre = await p.evaluate(() => ({ paused: AH.video.paused, armed: AH.S.armed, play: AH.S.log.filter(l => l.type === 'play').length }));
  check('開始前は Space・R・ボタン 0 が効かない', pre.paused && !pre.armed && pre.play === 0, JSON.stringify(pre));
  await p.evaluate(() => { window.__pads.length = 0; }); await p.waitForTimeout(100);

  // 開始 → 再生 → 停止 → 完了
  await p.click('#expStart');
  check('開始で覆いが消え、完了ボタンが出る', (await state()) === 'running' && !(await vis('#expCover')) && (await vis('#expDoneBtn')));
  await p.keyboard.press('Space'); await p.waitForTimeout(1000); await p.keyboard.press('Space'); await p.waitForTimeout(200);
  await p.keyboard.press('KeyV'); await p.waitForTimeout(100);
  check('見返しを許していない試行では V が効かない', !(await p.evaluate(() => AH._.reviewing())));
  await p.click('#expDoneBtn');
  await p.waitForFunction(() => AH._.expState() === 'done');
  await p.waitForTimeout(500);
  const names1 = downloads.map(d => d.suggestedFilename());
  check('完了で試行の番号つきのファイル名で書き出す', names1.includes('P01_t01p_practice_emujoy_session.json') && names1.includes('P01_t01p_practice_emujoy_events.csv'), JSON.stringify(names1));
  const sess = JSON.parse(fs.readFileSync(await downloads.find(d => d.suggestedFilename() === 'P01_t01p_practice_emujoy_session.json').path(), 'utf8').replace(/^﻿/, ''));
  const X1 = sess.meta.experiment, T = X1 && X1.task;
  check('meta.experiment に試行・練習・要約（タスク時間と再生時間）が入る',
    X1 && X1.trial === 0 && X1.practice === true && T.task_ms >= 1000 && T.play_ms >= 800 && T.play_ms <= T.task_ms && T.n_play === 1, JSON.stringify(T));
  const types = sess.log.map(l => l.type);
  check('操作ログに exp_trial・task_start・task_end が順に残る', types.indexOf('exp_trial') < types.indexOf('task_start') && types.indexOf('task_start') < types.indexOf('task_end'), types.join(','));
  const post = await p.evaluate(() => { const before = AH.video.currentTime; return { before, paused: AH.video.paused }; });
  await p.keyboard.press('Space'); await p.waitForTimeout(200);
  check('完了後は再生できない', await p.evaluate(() => AH.video.paused), JSON.stringify(post));

  check('練習の試行にはアンケートを出さず、すぐ「次へ」を出す', !(await vis('#expSurvey')) && (await vis('#expNext')));

  // 次の試行：方式・試行ごとの設定・評価区間
  await p.click('#expNext');
  await p.waitForFunction(() => AH._.expState() === 'ready' && AH.S.meta.mode === 'excel');
  const r2 = await p.evaluate(() => ({ n: AH.nSec(), s0: AH.binStart(0), log: AH.S.log.filter(l => l.type === 'task_start').length, file: AH.S.meta.video_file }));
  check('2 つ目の試行：Excel・評価区間（1〜11 秒、2 秒ごと → 5 区間）を当て、ログは新しく始まる', r2.n === 5 && r2.s0 === 1 && r2.log === 0 && r2.file === 'a.mp4', JSON.stringify(r2));
  await p.click('#expStart');
  check('見返しを許した試行では見返しボタンが出る', await vis('#reviewBtn'));
  await p.click('#expDoneBtn');
  await p.waitForFunction(() => AH._.expState() === 'finished');
  await p.waitForTimeout(500);
  check('本番の試行の後は「アンケートを開く」だけを出す', (await vis('#expSurvey')) && !(await vis('#expSum')));
  const [pop] = await Promise.all([ctx.waitForEvent('page'), p.click('#expSurvey')]);
  await pop.waitForLoadState();
  check('アンケートを別のタブで開き、URL に参加者・試行・方式・動画が入る', pop.url() === 'https://survey.test/form?pid=P01&t=2&m=excel&v=a.mp4', pop.url());
  await pop.close();
  const slog = await p.evaluate(() => AH.S.log.filter(l => l.type === 'survey_open').map(l => l.value));
  check('開いた後に終わりの案内が出て、操作ログに survey_open が残る', (await vis('#expSum')) && JSON.stringify(slog) === '[2]', JSON.stringify(slog));
  const sum = downloads.find(d => d.suggestedFilename() === 'P01_exptest_trials.csv');
  const csv = sum ? fs.readFileSync(await sum.path(), 'utf8').replace(/^﻿/, '').trim().split('\n') : [];
  check('最後の試行の後に全試行の要約を書き出す', csv.length === 3 && csv[0].startsWith('trial,practice,mode,video') && csv[1].startsWith('1,1,emujoy') && csv[2].startsWith('2,0,excel'), JSON.stringify(csv));
  const prog = await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('ahann_exp:exptest:P01')).done));
  check('進行をブラウザに残す', JSON.stringify(prog) === '["0","1"]', JSON.stringify(prog));

  // ---- 抜ける：設定が実験前の値に戻る
  await p.keyboard.press('Control+Shift+KeyE');
  await p.waitForLoadState('load'); await p.waitForTimeout(300);
  const after = await p.evaluate(() => ({ axes: localStorage.getItem('ahann_axes'), f0: localStorage.getItem('ahann_f0'), exp: document.body.classList.contains('exp'), pid: !!document.getElementById('pid').offsetParent }));
  check('Ctrl+Shift+E で抜けると、ブラウザの設定が実験前に戻る', after.axes === 'pana' && after.f0 === '1' && !after.exp && after.pid, JSON.stringify(after));

  // ---- もう一度選ぶと、終えた試行に「済」が付き、P02 を選べる
  await p.setInputFiles('#expDir', GOOD);
  await p.waitForSelector('#expGo');
  const again = await p.$$eval('#expFrom option', os => os.map(o => o.textContent));
  check('終えた試行に（済）が付く', again.every(t => t.includes('（済）')), JSON.stringify(again));

  await p.evaluate(() => localStorage.clear());
  console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
