// 列の表記の 0 の時刻（setup.json の動画ごとの labelZero．core/range.js の secLabel）：
// ゲームのタイマーに合わせて表記を 0 にする時刻を決め、それより後の列は「-0:01」のように出す。
// 1秒固定・自分で区切る・事前の区切りのどれでも効き、labelZero の無い次の試行には持ち越さない。検査は 0 以上の秒だけを通す
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const { URL, VID, BROWSER, out } = require('./_env');
const EC = require('../core/exp-check.js');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);

const DIR = out('labelzero_folder');
fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
for (const v of ['a.mp4', 'b.mp4']) fs.copyFileSync(VID, path.join(DIR, v));
const XL = { rep: 'excel', time: 'disc', input: 'keyboard', values: 'int' };
const experiment = {
  name: 'lz',
  participants: {
    // 1秒固定の試行の後に、labelZero の無い動画の試行を続ける（前の試行の labelZero を持ち越さないか）
    P01: [{ mode: 'custom', video: 'a.mp4', options: { ...XL, cuts: 'sec1' } }, { mode: 'custom', video: 'b.mp4', options: { ...XL, cuts: 'sec1' } }],
    P02: [{ mode: 'custom', video: 'a.mp4', options: { ...XL, cuts: 'self', curve: 'on', curveInput: 'draw' } }],
  },
};
// a.mp4：2〜10 秒を 1 秒ごと。表記の 0 は 9 秒（9〜10 秒の列が -0:01）
const setup = { settings: { listen: false }, videos: { 'a.mp4': { start: 2, end: 10, bin: 1, label: 'countdown', labelZero: 9 }, 'b.mp4': { start: 2, end: 10, bin: 1, label: 'countdown' } } };
fs.writeFileSync(path.join(DIR, 'experiment.json'), JSON.stringify(experiment));
fs.writeFileSync(path.join(DIR, 'setup.json'), JSON.stringify(setup));

// 検査：labelZero は使える項目で、0 以上の秒だけを通す
{
  const env = { modes: ['custom'], axes: ['va'], has: () => true };
  const ok = EC.check(experiment, env, setup);
  const bad = EC.check(experiment, env, { ...setup, videos: { ...setup.videos, 'a.mp4': { ...setup.videos['a.mp4'], labelZero: -1 } } });
  check('検査：labelZero を使える項目として通す', !ok.errors.some(e => e.includes('labelZero')), JSON.stringify(ok.errors));
  check('検査：負の labelZero は誤りにする', bad.errors.some(e => e.includes('labelZero')), JSON.stringify(bad.errors));
}

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
  const errs = [];
  const labels = p => p.evaluate(() => [...Array(AH.nSec()).keys()].map(s => AH.secLabel(s)));
  const open = async pid => {
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
    await p.goto(URL); await p.evaluate(() => localStorage.clear()); await p.reload();
    await p.setInputFiles('#expDir', DIR); await p.waitForSelector('#expGo');
    await p.selectOption('#expPid', pid); await p.click('#expGo');
    await p.waitForFunction(() => AH.S.meta.duration > 0 && AH.nSec() > 0); await p.waitForTimeout(200);
    return p;
  };

  // ---- 1秒固定：0 を 9 秒に置く
  {
    const p = await open('P01');
    const l1 = await labels(p);
    check('1秒固定：labelZero までの残りを出し、その後の列は -0:01 にする', JSON.stringify(l1) === JSON.stringify(['0:06', '0:05', '0:04', '0:03', '0:02', '0:01', '0:00', '-0:01']), JSON.stringify(l1));
    const head = await p.$$eval('table.xl th', ths => ths.map(t => t.textContent.trim()).filter(Boolean));
    check('Excel の列見出しにも -0:01 を出す', head.includes('-0:01') && head.includes('0:00'), JSON.stringify(head));
    check('区間の範囲は変えない（2〜10 秒，8 区間）', await p.evaluate(() => AH.nSec() === 8 && AH.binStart(0) === 2 && Math.abs(AH._.rangeEnd() - 10) < 1e-6));
    // 次の試行（labelZero の無い b.mp4）へ進む
    await p.click('#expStart'); await p.waitForTimeout(200);
    await p.click('#expDoneBtn'); await p.waitForSelector('#expNext', { state: 'visible' });
    await p.click('#expNext');
    await p.waitForFunction(() => AH.S.meta.video_file === 'b.mp4' && AH.nSec() > 0); await p.waitForTimeout(200);
    const l2 = await labels(p);
    check('labelZero の無い次の試行には持ち越さない（区間の終わりが 0:00）', l2[l2.length - 1] === '0:00' && l2[0] === '0:07' && await p.evaluate(() => !('labelZero' in AH.S.meta.range)), JSON.stringify(l2));
    await p.close();
  }

  // ---- 自分で区切る：区切りを置いても 0 の時刻は 9 秒のまま
  {
    const p = await open('P02');
    const l0 = await labels(p);
    check('自分で区切る：1 区間（2〜10 秒）の表記は 9 秒までの残り（-0:01．自分で区切るときは小数第 1 位まで出す）', l0.length === 1 && /^-0:01/.test(l0[0]), JSON.stringify(l0));
    await p.click('#expStart'); await p.waitForTimeout(200);
    await p.evaluate(() => { AH._.addCut(9); AH._.addCut(5); });
    await p.waitForTimeout(100);
    const l1 = await labels(p);
    check('区切りを置いても labelZero を保ち、9 秒で終わる区間が 0:00，9 秒より後の区間が -0:01', l1.length === 3 && /^0:04/.test(l1[0]) && /^0:00/.test(l1[1]) && /^-0:01/.test(l1[2]) && await p.evaluate(() => AH.S.meta.range.labelZero === 9), JSON.stringify(l1));
    await p.close();
  }

  console.log('errs:', errs.length ? errs.join(' / ') : 'none');
  await browser.close();
})();
