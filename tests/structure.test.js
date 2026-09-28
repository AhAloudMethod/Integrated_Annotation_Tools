// 構造の回帰：入力方式の並び順（optgroup と option）、AH の公開 API、localStorage のキー
const { chromium } = require('playwright-core');
const { URL, VID, BROWSER } = require('./_env');

const EXPECTED_ORDER = [
  '時間連続・2次元: key emujoy feeltrace rcea darma throttle halolight',
  '時間連続・1次元: carma ranktrace',
  '離散（区間ごと）: excel affectgrid sam',
  '相対（変化の方向）: affectrank',
  'カスタム: custom',
];
// 方式ファイルや外部から使われる公開 API（分割で増えるのは可、減るのは不可）
const EXPECTED_API = ['S', 'pen', 'video', 'init', 'register', 'refresh', 'remount', 'addLog', 'pushUndo', 'snapshot', 'css', 'fitCanvas', 'fmt', 'clamp', 'r2',
  'vt', 'valueAt', 'placePoint', 'deletePointBefore', 'penDown', 'penMove', 'penUp', 'setArmed', 'endStroke', 'isWriting',
  'nSec', 'curSec', 'binStart', 'secLabel', 'rangeSig', 'inRange', 'setCell', 'setCells', 'addEvent', 'deleteEventBefore', 'seekTo', 'togglePlay', 'setOption',
  'gamepad', 'quadColor', 'gradColor', 'intensity', 'rgba', 'hasVideo', 'mode'];

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const p = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss());
  await p.goto(URL);
  const order = await p.$$eval('#mode optgroup', gs => gs.map(g => g.label + ': ' + [...g.children].map(o => o.value).join(' ')));
  const initial = await p.$eval('#mode', s => s.value);
  const api = await p.evaluate(() => Object.keys(AH));
  await p.fill('#pid', 'S1'); await p.selectOption('#mode', 'key');
  await p.setInputFiles('#file', VID); await p.waitForFunction(() => AH.S.meta.duration > 0); await p.waitForTimeout(300);
  await p.keyboard.press('Digit7'); await p.waitForTimeout(100);
  const keys = await p.evaluate(() => Object.keys(localStorage).sort());
  console.log('order', JSON.stringify(order), '\ninitial', initial, '\nlocalStorage', JSON.stringify(keys));
  const missing = EXPECTED_API.filter(k => !api.includes(k));
  if (JSON.stringify(order) !== JSON.stringify(EXPECTED_ORDER)) console.log('FAIL order differs');
  if (initial !== 'key') console.log('FAIL initial mode', initial);
  if (missing.length) console.log('FAIL missing API', missing.join(' '));
  if (JSON.stringify(keys) !== JSON.stringify(['ahann4:key:S1:test.mp4', 'ahann_vidsize'])) console.log('FAIL localStorage keys');
  console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
