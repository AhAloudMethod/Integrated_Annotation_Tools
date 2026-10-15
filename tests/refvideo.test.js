// 基準音声の動画（core/ref.js）：評価する動画とは別の動画の最初の声を、基準音声のボタンで鳴らす。
// 通常の画面（設定で選ぶ・外す）、実験モードの setup.json の refVideo（と検査）、録画の試行（区間合わせで実験者が選び、後の試行に引き継ぐ）
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { URL, VID, BROWSER, out } = require('./_env');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);

// 基準音声の動画：1.5〜2.5 秒だけ 300Hz の声が入る 4 秒の動画
const REFV = out('refvoice.mp4');
const made = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=160x90:r=15:d=4',
  '-f', 'lavfi', '-i', "aevalsrc='if(between(t,1.5,2.5),0.5*sin(2*PI*300*t),0)':s=44100:d=4", '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', REFV]).status === 0;
function makeFolder(name, files, videos) {
  const dir = out(name);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  for (const v of videos) fs.copyFileSync(VID, path.join(dir, v));
  if (made) fs.copyFileSync(REFV, path.join(dir, 'ref.mp4'));
  for (const [f, obj] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), JSON.stringify(obj, null, 1));
  return dir;
}

(async () => {
  if (!made) { console.log('skip  基準音声の動画（ffmpeg がありません）'); return; }
  const SETUP = makeFolder('ref_setup', {
    'experiment.json': { name: 'reftest', participants: { P01: [{ mode: 'excel', video: 'a.mp4' }, { mode: 'sam', video: 'b.mp4' }] } },
    'setup.json': { settings: { listen: false }, videos: { 'a.mp4': { start: 0, end: 10, bin: 1, refVideo: 'ref.mp4' }, 'b.mp4': { start: 0, end: 10, bin: 1 } } },
  }, ['a.mp4', 'b.mp4']);
  const REC = makeFolder('ref_rec', {
    'experiment.json': { name: 'refrec', participants: { R01: [{ mode: 'excel', record: true }, { mode: 'sam', record: true }] } },
  }, ['take.mp4']);

  const browser = await chromium.launch({ executablePath: BROWSER, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true });
  const errs = [];
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(URL); await p.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase('ahann_exp'); }); await p.reload();
  const refReady = () => p.waitForFunction(() => AH._.refVideoF0.status === 'ready', null, { timeout: 30000 });

  // ---- 通常の画面：設定で基準音声の動画を選ぶと、その動画の最初の声を鳴らし、評価する動画は止めたまま動かさない
  await p.setInputFiles('#file', VID); await p.waitForFunction(() => AH._.F0.status === 'ready', null, { timeout: 30000 });
  await p.evaluate(() => new Promise(ok => { AH.video.addEventListener('seeked', ok, { once: true }); AH.seekTo(6); }));
  await p.setInputFiles('#refVideoFile', REFV); await refReady();
  const sp = await p.evaluate(() => ({ span: AH._.refSpan(), name: document.getElementById('refVideoName').textContent, clear: !document.getElementById('refVideoClear').hidden, title: document.getElementById('refBtn').title }));
  check('設定で選んだ基準音声の動画の最初の声（1.5〜2.5 秒）を基準音声にする', Math.abs(sp.span.t0 - 1.5) < 0.03 && Math.abs(sp.span.t1 - 2.54) < 0.04 && sp.name === 'refvoice.mp4' && sp.clear && sp.title.includes('refvoice.mp4'), JSON.stringify(sp));
  await p.click('#refBtn');
  const mid = await p.waitForFunction(() => { const a = document.getElementById('refAudio'); return !a.paused && a.currentTime > 1.3 && a.currentTime < 2.9; }, null, { timeout: 3000 }).then(() => true).catch(() => false);
  const during = await p.evaluate(() => ({ vpaused: AH.video.paused, vt: AH.video.currentTime, playing: AH._.refPlaying() }));
  await p.waitForFunction(() => !AH._.refPlaying(), null, { timeout: 5000 }).catch(() => {});
  const after = await p.evaluate(() => ({ vt: AH.video.currentTime, vpaused: AH.video.paused, apaused: document.getElementById('refAudio').paused, at: document.getElementById('refAudio').currentTime,
    log: AH.S.log.filter(l => l.type === 'ref_audio').map(l => l.value + ' ' + l.detail) }));
  check('基準音声の動画を声の前から鳴らし、その間は評価する動画を止めたまま（6 秒）にする', mid && during.vpaused && Math.abs(during.vt - 6) < 0.01 && during.playing, JSON.stringify({ mid, during }));
  check('声の終わりで止め、評価する動画は 6 秒のまま。操作ログに基準音声の動画の名前を残す', after.apaused && after.at < 3.2 && after.vpaused && Math.abs(after.vt - 6) < 0.01
    && after.log.length === 2 && after.log[0].includes('video=refvoice.mp4') && after.log[1] === 'end end', JSON.stringify(after));
  // 鳴らしている間に評価する動画を再生したら、基準音声を止める
  await p.click('#refBtn'); await p.waitForTimeout(200);
  await p.keyboard.press('Space'); await p.waitForTimeout(200);
  const st = await p.evaluate(() => ({ playing: AH._.refPlaying(), apaused: document.getElementById('refAudio').paused, vpaused: AH.video.paused, last: AH.S.log.filter(l => l.type === 'ref_audio').pop() }));
  check('基準音声を鳴らしている間に評価する動画を再生すると、基準音声を止める', !st.playing && st.apaused && !st.vpaused && st.last.detail === 'play', JSON.stringify(st));
  await p.keyboard.press('Space');
  // 別の動画を開いても基準音声の動画は残し、外すと評価する動画の最初の声に戻る
  await p.setInputFiles('#file', VID); await p.waitForFunction(() => AH._.F0.status === 'ready', null, { timeout: 30000 });
  const kept = await p.evaluate(() => (AH._.refVideo() || {}).name);
  await p.click('#setBtn'); await p.click('#refVideoClear'); await p.click('#setBtn');
  const cl = await p.evaluate(() => ({ rv: AH._.refVideo(), name: document.getElementById('refVideoName').textContent, span: AH._.refSpan(), log: AH.S.log.filter(l => l.type === 'ref_video').map(l => l.value) }));
  check('動画を開き直しても基準音声の動画は残し、「外す」で評価する動画の最初の声に戻る（操作ログに残す）', kept === 'refvoice.mp4' && cl.rv === null && cl.name === '評価する動画の最初の声' && cl.span.t0 < 0.1 && cl.log[cl.log.length - 1] === 'clear', JSON.stringify({ kept, cl }));

  // ---- setup.json の検査：refVideo はフォルダにある動画の相対パス。refVideo があれば ref はその動画の秒（評価する動画の長さで検査しない）
  const ck = await p.evaluate(() => {
    const env = { modes: ['excel'], axes: ['va'], has: f => ['a.mp4', 'ref.mp4'].includes(f) };
    const exp = { name: 'x', participants: { P: [{ mode: 'excel', video: 'a.mp4' }] } };
    const run = v => AH._.expCheck.check(exp, env, { videos: { 'a.mp4': { start: 0, end: 5, duration: 5, ...v } } }).errors;
    return { ok: run({ refVideo: 'ref.mp4', ref: 8 }), missing: run({ refVideo: 'nosuch.mp4' }), bad: run({ refVideo: 3 }), refOver: run({ ref: 8 }) };
  });
  check('検査：refVideo がフォルダにあれば通り、ref はその動画の秒として長さで弾かない', ck.ok.length === 0, JSON.stringify(ck.ok));
  check('検査：refVideo がフォルダに無い・文字列でないなら誤り', ck.missing.some(e => e.includes('nosuch.mp4')) && ck.bad.some(e => e.includes('refVideo')) && ck.refOver.some(e => e.includes('ref')), JSON.stringify(ck));

  // ---- setup.json の書き出し：基準音声の動画は「未設定」と出さず、書き出し直しても refVideo を残す
  await p.setInputFiles('#expSetupDir', SETUP);
  await p.waitForSelector('#esSave');
  const rows = await p.$$eval('.expVids tr', trs => trs.map(t => t.textContent));
  const miss = await p.$$eval('.expCard .expMiss', es => es.map(e => e.textContent));
  const dls = []; p.on('download', d => dls.push(d));
  await p.click('#esSave'); await p.waitForTimeout(300);
  const su = dls.length ? JSON.parse(fs.readFileSync(await dls[0].path(), 'utf8').replace(/^﻿/, '')) : {};
  check('setup.json の書き出し：基準音声の動画は「未設定」と出さず、refVideo を残す', rows.some(r => r.includes('ref.mp4') && r.includes('基準音声の動画')) && !miss.length
    && su.videos && su.videos['a.mp4'].refVideo === 'ref.mp4' && !su.videos['ref.mp4'], JSON.stringify({ rows, miss, videos: su.videos }));
  await p.click('#esClose');

  // ---- 実験モード：setup.json の refVideo の動画を基準音声にし、refVideo の無い動画の試行では評価する動画の最初の声に戻す
  await p.setInputFiles('#expDir', SETUP);
  await p.waitForSelector('#expGo'); await p.click('#expGo');
  await p.waitForFunction(() => AH._.expState() === 'ready'); await refReady();
  const e1 = await p.evaluate(() => ({ rv: (AH._.refVideo() || {}).name, span: AH._.refSpan(), log: AH.S.log.filter(l => l.type === 'ref_video').map(l => l.value + ' ' + l.detail) }));
  check('実験モード：setup.json の refVideo の動画の最初の声を基準音声にする（操作ログに setup と残す）', e1.rv === 'ref.mp4' && Math.abs(e1.span.t0 - 1.5) < 0.03 && e1.log.join() === 'set ref.mp4 setup', JSON.stringify(e1));
  await p.click('#expStart'); await p.click('#expDoneBtn');
  await p.waitForFunction(() => AH._.expState() === 'done'); await p.click('#expNext');
  await p.waitForFunction(() => AH._.expState() === 'ready');
  const e2 = await p.evaluate(() => ({ rv: AH._.refVideo(), log: AH.S.log.filter(l => l.type === 'ref_video').map(l => l.value) }));
  check('refVideo の無い動画の試行では、評価する動画の最初の声に戻す', e2.rv === null && e2.log.join() === 'clear', JSON.stringify(e2));
  await Promise.all([p.waitForNavigation({ waitUntil: 'load' }), p.keyboard.press('Control+Shift+KeyE')]);
  await p.waitForTimeout(300);

  // ---- 録画の試行：区間合わせで実験者が基準音声の録画を選ぶと、それを鳴らし、後の録画の試行にも引き継ぐ
  await p.setInputFiles('#expDir', REC);
  await p.waitForSelector('#expGo'); await p.click('#expGo');
  await p.waitForFunction(() => AH._.expState() === 'pick');
  await p.setInputFiles('#expRecFile', path.join(REC, 'take.mp4'));
  await p.waitForFunction(() => AH._.expState() === 'align');
  const a0 = await p.$eval('#expAlign', b => b.textContent);
  await p.setInputFiles('#expRefFile', path.join(REC, 'ref.mp4')); await refReady();
  const a1 = await p.evaluate(() => ({ text: document.getElementById('expAlign').textContent, rv: (AH._.refVideo() || {}).name, prog: JSON.parse(localStorage.getItem('ahann_exp:refrec:R01')).refVideo }));
  check('区間合わせで基準音声の録画を選べ、帯に名前を出して進行に残す', a0.includes('この録画の最初の声') && a1.text.includes('「ref.mp4」の最初の声') && a1.rv === 'ref.mp4' && a1.prog.file === 'ref.mp4', JSON.stringify({ a0, a1 }));
  await p.click('#expRecGo'); await p.waitForFunction(() => AH._.expState() === 'ready');
  const r1 = await p.evaluate(() => AH.S.meta.experiment.record);
  check('渡すと meta.experiment.record に基準音声の録画の名前を残す', r1.ref_video === 'ref.mp4', JSON.stringify(r1));
  await p.click('#expStart'); await p.click('#expDoneBtn');
  await p.waitForFunction(() => AH._.expState() === 'done'); await p.click('#expNext');
  await p.waitForFunction(() => AH._.expState() === 'pick');
  await p.setInputFiles('#expRecFile', path.join(REC, 'take.mp4'));
  await p.waitForFunction(() => AH._.expState() === 'align');
  const r2 = await p.evaluate(() => ({ rv: (AH._.refVideo() || {}).name, text: document.getElementById('expAlign').textContent }));
  check('次の録画の試行にも基準音声の録画を引き継ぐ', r2.rv === 'ref.mp4' && r2.text.includes('「ref.mp4」の最初の声'), JSON.stringify(r2));
  await p.click('#expRecRefOff');
  const r3 = await p.evaluate(() => ({ rv: AH._.refVideo(), text: document.getElementById('expAlign').textContent, prog: JSON.parse(localStorage.getItem('ahann_exp:refrec:R01')).refVideo }));
  check('「外す」で録画の最初の声に戻す', r3.rv === null && r3.text.includes('この録画の最初の声') && r3.prog === null, JSON.stringify(r3));
  // 再読み込みの後は、前に選んだ基準音声の録画の名前を出して選び直させる
  await p.setInputFiles('#expRefFile', path.join(REC, 'ref.mp4'));
  await p.reload(); await p.waitForTimeout(300);
  await p.setInputFiles('#expDir', REC);
  await p.waitForSelector('#expGo'); await p.selectOption('#expFrom', '1'); await p.click('#expGo');
  await p.waitForFunction(() => AH._.expState() === 'pick');
  check('再開するときは、前に選んだ基準音声の録画の名前を出して選び直させる', (await p.$eval('#expCard', c => c.textContent)).includes('基準音声の録画に「ref.mp4」'));

  await p.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase('ahann_exp'); });
  console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
