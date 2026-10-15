// 発声者の区切り（core/speaker.js）：発声者の結果（試行の zip・圧縮し直した zip・_session.json）から評価区間を読む。
// setup.json の書き出しの画面で録画の評価区間に取り込み、通常の画面で開いた動画に当てて、区間ごとに再生する
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('playwright-core');
const { URL, VID, BROWSER, out } = require('./_env');
const { makeZip, crc32 } = require('../core/zip.js');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);

// 発声者の録画の試行の _session.json（take.mp4 を 1〜10.5 秒で評価し、3.5 秒と 6 秒で区切った。基準音声の録画は ref.mp4）
const SIZE = fs.statSync(VID).size;
const session = (file, edges, refVideo) => ({
  meta: { participant: 'P01', video_file: file, duration: 12, mode: 'excel',
    range: { start: edges[0], count: edges.length - 1, bin: 1, label: 'countdown', target: edges[edges.length - 1], edges },
    experiment: { name: 'spk', trial: 1, record: { file, size: SIZE, duration: 12, start: edges[0], end: edges[edges.length - 1], ...(refVideo ? { ref_video: refVideo } : {}) } } },
  data: {}, log: [],
});
const bom = o => '﻿' + JSON.stringify(o);
// エクスプローラーなどで圧縮し直した zip（deflate）
function deflateZip(name, text) {
  const n = Buffer.from(name), d = Buffer.from(text), z = zlib.deflateRawSync(d), crc = crc32(d);
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
  lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(z.length, 18); lh.writeUInt32LE(d.length, 22); lh.writeUInt16LE(n.length, 26);
  const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
  ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(z.length, 20); ch.writeUInt32LE(d.length, 24); ch.writeUInt16LE(n.length, 28);
  const body = Buffer.concat([lh, n, z]), cen = Buffer.concat([ch, n]), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(cen.length, 12); end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, cen, end]);
}

const DIR = out('spk_folder'), RES = out('spk_results');
for (const d of [DIR, RES]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); }
for (const v of ['take.mp4', 'take2.mp4', 'ref.mp4', 'a.mp4']) fs.copyFileSync(VID, path.join(DIR, v));
fs.writeFileSync(path.join(DIR, 'setup.json'), JSON.stringify({ settings: { listen: false }, videos: { 'a.mp4': { start: 0, end: 12, bin: 1, novoice: [[2, 3]] } } }));
const ZIP1 = path.join(RES, 'P01_t02_take_excel.zip'), ZIP2 = path.join(RES, 'P01_t03_take2_excel.zip'), ZIP3 = path.join(RES, 'P01_t04_lost_excel.zip'), JS = path.join(RES, 'P02_take_excel_session.json');
fs.writeFileSync(ZIP1, makeZip([{ name: 'P01_take_excel_60hz.csv', data: 't\n' }, { name: 'P01_take_excel_session.json', data: bom(session('take.mp4', [1, 3.5, 6, 10.5], 'ref.mp4')) }]));
fs.writeFileSync(ZIP2, deflateZip('P01_take2_excel_session.json', bom(session('take2.mp4', [0.5, 2, 9], null))));
fs.writeFileSync(ZIP3, makeZip([{ name: 'P01_lost_excel_session.json', data: bom(session('lost.mp4', [0, 5], null)) }]));
fs.writeFileSync(JS, bom(session('take.mp4', [2, 4, 8], null)));

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true });
  const errs = [], dialogs = [];
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  const downloads = []; p.on('download', d => downloads.push(d));
  await p.goto(URL); await p.evaluate(() => localStorage.clear()); await p.reload();

  // ---- setup.json の書き出しの画面：発声者の結果を取り込む
  await p.setInputFiles('#expSetupDir', DIR);
  await p.waitForSelector('#esSpk');
  await p.selectOption('#es_rate', '0.75');   // 取り込んで描き直しても、欄の値を残す
  await p.setInputFiles('#esSpkFile', [ZIP1, ZIP2, ZIP3]);
  await p.waitForFunction(() => [...document.querySelectorAll('.expVids tr')].some(t => t.textContent.includes('発声者')));
  const rows = await p.$$eval('.expVids tr', trs => trs.map(t => t.textContent));
  const notes = await p.$$eval('#expCover .expMiss', ps => ps.map(x => x.textContent));
  check('取り込んだ録画に発声者の区切りを出す（格納の zip）', rows.some(r => r.startsWith('take.mp4') && r.includes('1〜10.5 秒（自分で区切った 3 区間）') && r.includes('P01 試行 2')), JSON.stringify(rows));
  check('圧縮し直した zip（deflate）も読む', rows.some(r => r.startsWith('take2.mp4') && r.includes('0.5〜9 秒（自分で区切った 2 区間）')), JSON.stringify(rows));
  check('基準音声の録画は評価区間が要らない動画として出す', rows.some(r => r.startsWith('ref.mp4') && r.includes('基準音声の動画')), JSON.stringify(rows));
  check('フォルダに無い録画は案内を出す', notes.some(m => m.includes('lost.mp4') && m.includes('ありません')), JSON.stringify(notes));
  check('描き直しても欄の値を残す', await p.$eval('#es_rate', el => el.value) === '0.75');
  await p.click('#esSave'); await p.waitForTimeout(300);
  const su = JSON.parse(fs.readFileSync(await downloads.find(d => d.suggestedFilename() === 'setup.json').path(), 'utf8').replace(/^﻿/, ''));
  const t = su.videos['take.mp4'];
  check('setup.json に区切り・列の表記・長さ・基準音声の録画を書く', !!t && JSON.stringify(t.edges) === '[1,3.5,6,10.5]' && t.label === 'countdown' && Math.abs(t.duration - 12) < 0.1 && t.refVideo === 'ref.mp4', JSON.stringify(t));
  check('取り込まなかった動画は setup.json の区間と novoice を残す', su.videos['a.mp4'] && su.videos['a.mp4'].end === 12 && JSON.stringify(su.videos['a.mp4'].novoice) === '[[2,3]]' && !su.videos['ref.mp4'], JSON.stringify(su.videos));
  check('setup.json を検査に通る形で書く', su.settings.rate === 0.75 && JSON.stringify(su.videos['take2.mp4'].edges) === '[0.5,2,9]', JSON.stringify(su));
  await p.click('#esClose');

  // ---- 通常の画面：取り込んだ区間をブラウザに覚えているので、録画を開くと同じ区切りになる
  await p.setInputFiles('#file', path.join(DIR, 'take.mp4'));
  await p.waitForFunction(() => AH.S.meta.duration > 0);
  await p.waitForTimeout(300);
  check('取り込んだ区切りを、通常の画面で録画を開いたときにも使う', JSON.stringify(await p.evaluate(() => AH.S.meta.range.edges)) === '[1,3.5,6,10.5]', JSON.stringify(await p.evaluate(() => AH.S.meta.range)));

  // ---- 評価区間の欄：別の発声者の _session.json を読み込んで当て、区間ごとに再生する
  await p.click('#rgBtn');
  await p.setInputFiles('#spkFile', JS);
  await p.waitForFunction(() => AH.nSec() === 2);
  const segs = await p.$$eval('#segList button', bs => bs.map(b => b.textContent));
  check('_session.json の区切りを当てて、区間の一覧を出す', JSON.stringify(await p.evaluate(() => AH.S.meta.range.edges)) === '[2,4,8]' && segs.length === 2 && segs[1].includes('0:04.0〜0:08.0'), JSON.stringify(segs));
  check('読み込んだ発声者を出し、操作ログに range_speaker を残す', (await p.$eval('#spkInfo', el => el.textContent)).includes('P01 試行 2') && await p.evaluate(() => AH.S.log.some(l => l.type === 'range_speaker')));
  await p.click('#segList button[data-sec="0"]');
  await p.waitForFunction(() => AH.video.paused && AH.video.currentTime > 3.5, null, { timeout: 8000 }).catch(() => {});
  const st = await p.evaluate(() => ({ t: AH.video.currentTime, paused: AH.video.paused, on: document.querySelector('#segList button.on')?.dataset.sec, log: AH.S.log.some(l => l.type === 'seg_play') }));
  check('区間 1 を押すと 2 秒から再生し、区間の終わり（4 秒）で止める', st.paused && Math.abs(st.t - 4) < 0.1 && st.log, JSON.stringify(st));
  check('今の区間の一覧のボタンを強調する', st.on === '0', JSON.stringify(st));
  await p.keyboard.press('Control+KeyZ'); await p.waitForTimeout(200);
  check('Ctrl+Z で当てる前の区切りに戻る', JSON.stringify(await p.evaluate(() => AH.S.meta.range.edges)) === '[1,3.5,6,10.5]', JSON.stringify(await p.evaluate(() => AH.S.meta.range)));

  // ---- 名前の違う動画には確かめてから当てる。動画の長さを超える区間は当てない
  await p.setInputFiles('#file', path.join(DIR, 'a.mp4'));
  await p.waitForFunction(() => AH.S.meta.video_file === 'a.mp4' && AH.S.meta.duration > 0);
  await p.click('#rgBtn').catch(() => {});
  // テストの動画はどれも同じ大きさなので、大きさの違う録画の結果にする（同じ大きさなら名前が違っても同じ録画とみなす）
  const OTHER = path.join(RES, 'P02_other_session.json'), so = session('take.mp4', [2, 4, 8], null);
  so.meta.experiment.record.size = SIZE + 1; fs.writeFileSync(OTHER, bom(so));
  dialogs.length = 0;
  await p.setInputFiles('#spkFile', OTHER);
  await p.waitForFunction(() => AH.nSec() === 2);
  check('名前の違う動画には確かめてから当てる', dialogs.some(m => m.includes('違います')), JSON.stringify(dialogs));
  const LONG = path.join(RES, 'P03_long_session.json');
  fs.writeFileSync(LONG, bom(session('a.mp4', [0, 5, 20], null)));
  dialogs.length = 0;
  await p.setInputFiles('#spkFile', LONG); await p.waitForTimeout(400);
  check('動画の長さを超える区間は当てない', dialogs.some(m => m.includes('超えて')) && JSON.stringify(await p.evaluate(() => AH.S.meta.range.edges)) === '[2,4,8]', JSON.stringify(dialogs));

  await p.screenshot({ path: out('speaker.png') });
  console.log('errs:', errs.length ? errs.join(' / ') : 'none');
  await browser.close();
})();
