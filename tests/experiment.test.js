// 実験モード（core/experiment.js）：setup.json の書き出し、実験フォルダの読み込みと検査、隠す要素、開始前に操作が効かないこと、
// 開始から完了までの時間と zip の書き出し、動画ごとの評価区間、次の試行への切り替えと設定の適用、アンケート、
// 途中で抜けたときの _partial の zip と書き出し直し、抜けたときに設定が戻ること
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const { URL, VID, BROWSER, out } = require('./_env');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
const JOY = 'Test Joystick (Vendor: 1234 Product: 0001)';

// 実験フォルダを作る（tests/out/ の下。動画はテスト動画の複製）
function makeFolder(name, files, videos) {
  const dir = out(name);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  for (const v of videos) fs.copyFileSync(VID, path.join(dir, v));
  for (const [f, obj] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), JSON.stringify(obj, null, 1));
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
const GOOD = makeFolder('exp_good', {
  'experiment.json': {
    name: 'exptest',
    settings: { review: false, videoWindow: false, listen: false },
    survey: 'https://survey.test/form?pid={pid}&t={trial}&m={mode}&v={video}',
    participants: {
      P01: [
        { mode: 'emujoy', video: 'practice.mp4', practice: true, options: { face: false } },
        { mode: 'excel', video: 'a.mp4', settings: { review: true } },
      ],
      P02: [{ mode: 'sam', video: 'a.mp4' }],
      P03: [{ mode: 'sam', video: 'c.mp4' }],
    },
  },
  // 動画ごとの評価区間。c.mp4 は動画（12 秒）より長い終了にして、試行を始められないことを確かめる
  'setup.json': { settings: { f0: false }, videos: { 'practice.mp4': { start: 0, end: 12, bin: 1 }, 'a.mp4': { start: 1, end: 11, bin: 2 }, 'c.mp4': { start: 0, end: 20, bin: 1 } } },
}, ['practice.mp4', 'a.mp4', 'c.mp4']);
const BAD = makeFolder('exp_bad', {
  'experiment.json': {
    name: 'bad',
    settings: { rate: 2, nosuch: 1 },
    participants: { P01: [{ mode: 'nosuch', video: 'a.mp4' }, { mode: 'excel', video: 'missing.mp4' }, { mode: 'excel', video: 'a.mp4' }, { mode: 'excel', video: 'a.mp4' }] },
  },
  'setup.json': { videos: { 'a.mp4': { start: 0, end: 12 } } },
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
  const dl = name => downloads.find(d => d.suggestedFilename() === name);
  const text = async name => fs.readFileSync(await dl(name).path(), 'utf8').replace(/^﻿/, '');
  const zip = async name => (dl(name) ? readZip(fs.readFileSync(await dl(name).path())) : {});
  await p.goto(URL);
  // 参加者のブラウザに残った設定（実験では使わず、抜けたら戻る）
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('ahann_axes', 'pana'); localStorage.setItem('ahann_f0', '1'); indexedDB.deleteDatabase('ahann_exp'); });
  await p.reload();
  const vis = sel => p.evaluate(s => { const el = document.querySelector(s); return !!el && !el.hidden && getComputedStyle(el).display !== 'none' && !!el.offsetParent; }, sel);
  const state = () => p.evaluate(() => AH._.expState());

  // ---- 通常の画面：a.mp4 の評価区間を合わせてから、setup.json を書き出す
  await p.setInputFiles('#file', path.join(GOOD, 'a.mp4'));
  await p.waitForFunction(() => AH.S.meta.duration > 0);
  await p.evaluate(() => AH._.setRange({ edges: null, start: 2, bin: 1, label: 'countdown', target: 10, count: 8 }));
  await p.setInputFiles('#expSetupDir', GOOD);
  await p.waitForSelector('#esSave');
  const rows = await p.$$eval('.expVids tr', trs => trs.map(t => t.textContent));
  check('setup.json の画面：フォルダの動画と、覚えてある評価区間を並べる', rows.some(r => r.includes('a.mp4') && r.includes('2〜10 秒，1 秒ごと')), JSON.stringify(rows));
  const form = await p.evaluate(() => ({ grid: document.getElementById('es_grid').checked, axes: document.getElementById('es_axes').value, review: document.getElementById('es_review').checked, voice: document.getElementById('es_voice').checked }));
  check('設定の欄は今の画面の値（評価軸は PANA）で、ボタンの欄は既定（見返しは出す・音声入力は出さない）', form.axes === 'pana' && form.review && !form.voice, JSON.stringify(form));
  await p.check('#es_voice'); await p.selectOption('#es_axes', 'va');
  await p.click('#esSave'); await p.waitForTimeout(300);
  const su = JSON.parse(await text('setup.json'));
  check('setup.json に欄の値と動画ごとの評価区間（長さつき）を書く', su.settings.voice === true && su.settings.axes === 'va' && su.videos['a.mp4'].start === 2 && su.videos['a.mp4'].end === 10 && su.videos['a.mp4'].bin === 1
    && Math.abs(su.videos['a.mp4'].duration - 12) < 0.1 && Object.keys(su.settings).length === 15, JSON.stringify(su));
  await p.click('#esClose');

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
  const warns = await p.$$eval('.expWarn li', ls => ls.map(l => l.textContent));
  check('警告（練習の抜けなど）を出すが、始められる', warns.some(w => w.includes('P01：本番の前に練習が無い方式があります（excel）')) && await vis('#expGo'), JSON.stringify(warns));
  await p.click('#expGo');
  await p.waitForFunction(() => AH._.expState() === 'ready');
  const hidden = {};
  for (const s of ['#pid', '#mode', '#openBtn', '#expBtn', '#setBtn', '#rgBtn', '#helpBtn', '#tlBtn', '#exportBtn', '#reviewBtn', '#voiceBtn', '#vwinBtn']) hidden[s] = !(await vis(s));
  check('参加者 ID・方式・設定・評価区間・グラフの開閉・書き出し・見返し・音声入力・別ウィンドウを隠す', Object.values(hidden).every(Boolean), JSON.stringify(hidden));
  const r1 = await p.evaluate(() => ({ mode: AH.S.meta.mode, pid: AH.S.meta.participant, face: AH.S.meta.options.face, axes: AH._.axesId(), f0: AH._.f0Shown(),
    tl: !document.body.classList.contains('noTl'), grid: AH._.gridShown(), edit: document.getElementById('graphEdit').checked,
    opt: [...document.querySelectorAll('#panel .optCtl')].every(e => getComputedStyle(e).display === 'none') }));
  check('1 つ目の試行：方式・参加者・方式の設定・既定の設定（VA、F0 なし、グラフとグリッド線を出す、グラフの編集オン）を当て、方式の設定の欄を隠す',
    r1.mode === 'emujoy' && r1.pid === 'P01' && r1.face === false && r1.axes === 'va' && r1.f0 === false && r1.tl && r1.grid && r1.edit && r1.opt, JSON.stringify(r1));

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
  const tb = await p.locator('#tl').boundingBox();
  await p.mouse.click(tb.x + tb.width * 0.5, tb.y + tb.height * 0.3, { button: 'right' }); await p.waitForTimeout(100);
  check('グラフを出していても、右クリックで評価区間の区切りを置けない', await p.evaluate(() => !AH.S.meta.range.edges && !AH.S.log.some(l => l.type === 'range_cut')));
  await p.keyboard.press('KeyV'); await p.waitForTimeout(100);
  check('見返しを許していない試行では V が効かない', !(await p.evaluate(() => AH._.reviewing())));
  await p.click('#expDoneBtn');
  await p.waitForFunction(() => AH._.expState() === 'done');
  await p.waitForTimeout(500);
  const names1 = downloads.map(d => d.suggestedFilename());
  check('完了で試行の番号つきの zip を 1 つだけ書き出す', names1.includes('P01_t01p_practice_emujoy.zip') && !names1.some(n => n.endsWith('.csv')), JSON.stringify(names1));
  const z1 = await zip('P01_t01p_practice_emujoy.zip');
  check('zip には書き出しのファイル一式と、その時点までの要約が入る', ['_60hz.csv', '_bins.csv', '_events.csv', '_session.json'].every(s => z1['P01_t01p_practice_emujoy' + s] != null)
    && (z1['P01_exptest_trials.csv'] || '').split('\n').length === 2, JSON.stringify(Object.keys(z1)));
  const sess = JSON.parse(z1['P01_t01p_practice_emujoy_session.json'] || '{}');
  const X1 = sess.meta && sess.meta.experiment, T = X1 && X1.task;
  check('meta.experiment に試行・練習・要約（タスク時間と再生時間）が入る',
    !!T && X1.trial === 0 && X1.practice === true && T.task_ms >= 1000 && T.play_ms >= 800 && T.play_ms <= T.task_ms && T.n_play === 1, JSON.stringify(T));
  const types = (sess.log || []).map(l => l.type);
  check('操作ログに exp_trial・task_start・task_end が順に残る', types.indexOf('exp_trial') >= 0 && types.indexOf('exp_trial') < types.indexOf('task_start') && types.indexOf('task_start') < types.indexOf('task_end'), types.join(','));
  check('書き出したら、その試行の自動保存は消す', await p.evaluate(() => localStorage.getItem('ahann4:emujoy:P01:practice.mp4') === null));
  await p.keyboard.press('Space'); await p.waitForTimeout(200);
  check('完了後は再生できない', await p.evaluate(() => AH.video.paused));
  check('練習の試行にはアンケートを出さず、すぐ「次へ」を出す', !(await vis('#expSurvey')) && (await vis('#expNext')));

  // 次の試行：方式・試行ごとの設定・動画ごとの評価区間（setup.json）
  await p.click('#expNext');
  await p.waitForFunction(() => AH._.expState() === 'ready' && AH.S.meta.mode === 'excel');
  const r2 = await p.evaluate(() => ({ n: AH.nSec(), s0: AH.binStart(0), end: AH._.rangeEnd(), log: AH.S.log.filter(l => l.type === 'task_start').length, file: AH.S.meta.video_file }));
  check('2 つ目の試行：Excel・a.mp4 の評価区間（1〜11 秒、2 秒ごと → 5 区間）を当て、ログは新しく始まる', r2.n === 5 && r2.s0 === 1 && Math.abs(r2.end - 11) < 1e-6 && r2.log === 0 && r2.file === 'a.mp4', JSON.stringify(r2));
  await p.click('#expStart');
  check('見返しを許した試行では見返しボタンが出る', await vis('#reviewBtn'));
  await p.click('#expDoneBtn');
  await p.waitForFunction(() => AH._.expState() === 'finished');
  await p.waitForTimeout(500);
  const z2 = await zip('P01_t02_a_excel.zip');
  const csv = (z2['P01_exptest_trials.csv'] || '').trim().split('\n');
  check('最後の試行の zip の要約に全試行が入る', csv.length === 3 && csv[0].startsWith('trial,practice,mode,video') && csv[1].startsWith('1,1,emujoy') && csv[2].startsWith('2,0,excel'), JSON.stringify(csv));
  check('本番の試行の後は「アンケートを開く」だけを出す', (await vis('#expSurvey')) && !(await vis('#expSum')));
  const [pop] = await Promise.all([ctx.waitForEvent('page'), p.click('#expSurvey')]);
  await pop.waitForLoadState();
  check('アンケートを別のタブで開き、URL に参加者・試行・方式・動画が入る', pop.url() === 'https://survey.test/form?pid=P01&t=2&m=excel&v=a.mp4', pop.url());
  await pop.close();
  const prog = await p.evaluate(() => JSON.parse(localStorage.getItem('ahann_exp:exptest:P01')).done);
  check('開いた後に終わりの案内が出て、要約に survey_opened が残る', (await vis('#expSum')) && prog[1].survey_opened === 1 && prog[0].survey_opened === 0, JSON.stringify(prog[1]));
  check('進行をブラウザに残す', JSON.stringify(Object.keys(prog)) === '["0","1"]');

  // ---- 抜ける：設定が実験前の値に戻る
  await p.keyboard.press('Control+Shift+KeyE');
  await p.waitForLoadState('load'); await p.waitForTimeout(300);
  const after = await p.evaluate(() => ({ axes: localStorage.getItem('ahann_axes'), f0: localStorage.getItem('ahann_f0'), exp: document.body.classList.contains('exp'), pid: !!document.getElementById('pid').offsetParent }));
  check('Ctrl+Shift+E で抜けると、ブラウザの設定が実験前に戻る', after.axes === 'pana' && after.f0 === '1' && !after.exp && after.pid, JSON.stringify(after));
  const kept = await p.evaluate(() => JSON.parse(localStorage.getItem('ahann_range:a.mp4') || 'null'));
  check('実験モードで当てた評価区間は、通常の画面で覚えた区間（a.mp4 は 2〜10 秒）を上書きしない', !!kept && kept.start === 2 && kept.target === 10 && kept.bin === 1, JSON.stringify(kept));

  // ---- 試行の途中で抜ける：_partial の zip を書き出し、次に開いたとき（途中）と出て、ブラウザから書き出し直せる
  await p.setInputFiles('#expDir', GOOD);
  await p.waitForSelector('#expGo');
  await p.selectOption('#expPid', 'P02');
  await p.click('#expGo');
  await p.waitForFunction(() => AH._.expState() === 'ready');
  await p.click('#expStart');
  await p.keyboard.press('Space'); await p.waitForTimeout(500); await p.keyboard.press('Space');
  await p.keyboard.press('Control+Shift+KeyE');
  await p.waitForLoadState('load'); await p.waitForTimeout(1500);
  const zp = await zip('P02_t01_a_sam_partial.zip');
  const pj = zp['P02_t01_a_sam_session.json'] ? JSON.parse(zp['P02_t01_a_sam_session.json']) : null;
  check('試行の途中で抜けると _partial の zip を書き出す（partial と task_abort が残る）', !!pj && pj.meta.experiment.partial === true && pj.log.some(l => l.type === 'task_abort') && pj.meta.experiment.task.partial === 1,
    JSON.stringify(downloads.map(d => d.suggestedFilename())));
  await p.setInputFiles('#expDir', GOOD);
  await p.waitForSelector('#expGo');
  await p.selectOption('#expPid', 'P02');
  await p.waitForSelector('#expZips li');
  const again = await p.$$eval('#expFrom option', os => os.map(o => o.textContent));
  const zl = await p.$$eval('#expZips li', ls => ls.map(l => l.textContent));
  check('途中の試行に（途中）が付き、ブラウザに残った zip が並ぶ', again[0].includes('（途中）') && zl.some(t => t.includes('P02_t01_a_sam_partial.zip')), JSON.stringify([again, zl]));
  // 途中の試行を再開する：通常の画面で覚えた区間（2〜10 秒）ではなく、実験の区間（1〜11 秒、2 秒ごと）のまま続ける
  await p.click('#expGo');
  await p.waitForFunction(() => AH._.expState() === 'running');
  const rs = await p.evaluate(() => ({ n: AH.nSec(), s0: AH.binStart(0), end: AH._.rangeEnd() }));
  check('途中の試行を再開すると、実験の評価区間のまま続ける', rs.n === 5 && rs.s0 === 1 && Math.abs(rs.end - 11) < 1e-6, JSON.stringify(rs));
  await p.keyboard.press('Control+Shift+KeyE');
  await p.waitForLoadState('load'); await p.waitForTimeout(1500);
  await p.setInputFiles('#expDir', GOOD);
  await p.waitForSelector('#expGo');
  await p.selectOption('#expPid', 'P02');
  await p.waitForSelector('#expZips li');
  const n0 = downloads.length;
  await p.click('#expZips button[data-k="0"]'); await p.waitForTimeout(300);
  check('「書き出す」でブラウザに残った zip をもう一度書き出せる', downloads.length === n0 + 1 && downloads[n0].suggestedFilename() === 'P02_t01_a_sam_partial.zip');
  await p.click('#expZipDel'); await p.waitForTimeout(500);
  const cleared = await p.evaluate(() => ({ prog: localStorage.getItem('ahann_exp:exptest:P02'), auto: localStorage.getItem('ahann4:sam:P02:a.mp4') }));
  check('「ブラウザから消す」で zip・進行・自動保存を消す', (await p.$$eval('#expZips li', ls => ls.length)) === 0 && cleared.prog === null && cleared.auto === null, JSON.stringify(cleared));
  await p.click('#expCancel');

  // ---- 動画より長い評価区間：試行を始めない
  await p.setInputFiles('#expDir', GOOD);
  await p.waitForSelector('#expGo');
  await p.selectOption('#expPid', 'P03');
  await p.click('#expGo');
  await p.waitForFunction(() => AH._.expState() === 'error');
  const em = await p.$eval('#expCard', c => c.textContent);
  check('評価区間の終了が動画より長ければ、誤りを出して試行を始めない', em.includes('c.mp4') && em.includes('動画の長さ') && !(await vis('#expStart')), em);

  await p.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase('ahann_exp'); });
  console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
