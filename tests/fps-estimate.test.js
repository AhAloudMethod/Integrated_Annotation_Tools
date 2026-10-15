// フレームレートの推定（core/frame.js の estimateFps）：表示されたフレームの記録から fps を決める
// 記録は { n: presentedFrames, t: mediaTime, play: 再生中か } の並び。描画が間引かれてまばらな記録・フレームが捨てられた記録でも推定できるか
const { chromium } = require('playwright-core');
const { URL, BROWSER } = require('./_env');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const errs = [];
  const p = await browser.newPage(); p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL);
  const est = recs => p.evaluate(r => AH._.estimateFps(r), recs);
  // フレーム番号の列 ks（fps の格子上）を、presentedFrames の増え方 dns とともに記録にする
  const rec = (fps, ks, dns, play = true, t0 = 0) => {
    let n = 100;
    return ks.map((k, i) => ({ n: n += (i ? dns[i - 1] : 0), t: +(t0 + k / fps).toFixed(6), play }));
  };
  const range = (a, step, cnt) => Array.from({ length: cnt }, (_, i) => a + i * step);

  // 描画が間引かれ、0.5 秒に 1 回しか記録が無い（60 fps の動画を 0.5 倍速、30 フレームおき）
  const sparse = rec(60, range(0, 30, 12), Array(11).fill(30));
  check('まばらな記録（30 フレームおき）でも 60 fps と推定する', await est(sparse) === 60, JSON.stringify(await est(sparse)));

  // 負荷が高く、記録の間隔がばらばら（実機で観測した dn=4,38,69,… の形）
  const ks2 = [0, 4, 42, 111, 189, 238, 250, 257], dn2 = [4, 38, 69, 70, 49, 12, 7];
  check('間隔がばらばらな記録でも 60 fps と推定する', await est(rec(60, ks2, dn2)) === 60, JSON.stringify(await est(rec(60, ks2, dn2))));

  // フレームが半分以上捨てられる（presentedFrames は 1 ずつしか増えないのに 2 フレーム進む）。ときどき連続して出る
  const ks3 = [], dn3 = []; let k = 0;
  for (let i = 0; i < 40; i++) { ks3.push(k); k += i % 3 === 2 ? 1 : 2; dn3.push(1); }
  check('フレームが半分以上捨てられても 60 fps と推定する（30 にしない）', await est(rec(60, ks3, dn3)) === 60, JSON.stringify(await est(rec(60, ks3, dn3))));

  // 29.97 と 30 を見分ける（まばらな記録）
  const ntsc = rec(30000 / 1001, range(0, 15, 20), Array(19).fill(15));
  check('まばらな記録で 29.97 fps と推定する', await est(ntsc) === 29.97, JSON.stringify(await est(ntsc)));
  const d30 = rec(30, range(0, 1, 40), Array(39).fill(1));
  check('連続した記録で 30 fps と推定する', await est(d30) === 30, JSON.stringify(await est(d30)));

  // 先頭のフレームが 0 秒でない動画でも格子のずれに惑わされない
  const off = rec(60, range(0, 7, 15), Array(14).fill(7), true, 0.0213);
  check('先頭が 0 秒でない動画でも 60 fps と推定する', await est(off) === 60, JSON.stringify(await est(off)));

  // よく使う値に無いフレームレート（15 fps）は記録から直接求める
  const f15 = rec(15, range(0, 1, 30), Array(29).fill(1));
  check('よく使う値に無い 15 fps も推定する', await est(f15) === 15, JSON.stringify(await est(f15)));

  // 決められないときは null（今の値を変えない）
  check('記録が少ないと決めない', await est(rec(60, [0, 30, 60], [30, 30])) === null);
  // 一時停止中のシーク（, と . など）だけでは決めない：仮の 30 fps で 1 フレームずつ動くと 60 fps の動画では 2 フレームずつ進む
  const paused = rec(60, range(0, 2, 20), Array(19).fill(1), false);
  check('一時停止中の記録だけでは決めない', await est(paused) === null, JSON.stringify(await est(paused)));

  console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
