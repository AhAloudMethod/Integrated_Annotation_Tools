// 発声の帯が出ない理由の診断（tools/voiced-why.js）：合成した音で理由の振り分けと，値を変えたときの帯の長さを確かめる
const C = require('../core/f0-calc');
const { diagnose, gaps } = require('../tools/voiced-why');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);

// 乱数は毎回同じにする
let seed = 1; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
const x = new Float32Array(C.SR * 10);
const tone = (t0, t1, f, amp) => { for (let i = Math.round(t0 * C.SR); i < t1 * C.SR; i++) x[i] += amp * (Math.sin(2 * Math.PI * f * i / C.SR) + 0.5 * Math.sin(4 * Math.PI * f * i / C.SR)); };
const noise = (t0, t1, amp) => { for (let i = Math.round(t0 * C.SR); i < t1 * C.SR; i++) x[i] += amp * rnd(); };
noise(0.2, 0.4, 0.9);          // 効果音：大きな音（以前の既定では、これで下限が上がった）
tone(1, 2, 200, 0.02);         // 効果音の最大の 5% 未満の声：今は帯になる
tone(3, 4, 200, 0.3);          // 普通の声：帯あり
noise(5, 6, 0.3);              // 息・雑音：周期がはっきりしない
tone(7, 8, 55, 0.3);           // 低すぎる声：70 Hz 未満
tone(8.3, 8.6, 1500, 0.3);     // 1000 Hz を超える声は半分の高さに読まれる（帯になる）
tone(9, 9.02, 200, 0.3);       // 短すぎる声
tone(9.3, 9.8, 200, 0.002);    // -50 dBFS 未満の小さい声：今は帯になる
tone(9.85, 9.98, 200, 0.0005); // -60 dBFS 未満の声：帯にならない

const d = diagnose(x);
const g = gaps(d, 0, d.n);
const at = t => g.find(s => s.k * C.HOP <= t && t < s.e * C.HOP);
const mainOf = t => (at(t) ? at(t).main[0][0] : null);
check('普通の声は帯になる', d.spans.some(([a, b]) => a <= 3.05 && b >= 3.95), JSON.stringify(d.spans));
check('下限は -60 dBFS だけで決まり，効果音で上がらない', d.floor === C.FLOOR_ABS && Math.abs(20 * Math.log10(C.FLOOR_ABS) + 60) < 1e-9, d.floor);
check('効果音の最大の 5% 未満の声も帯になる', d.reason[150] === 'voiced', d.reason[150]);
check('以前の既定（最大の 5%）なら声なしになる', diagnose(x, { rel: 0.05 }).reason[150] === 'below');
check('雑音：周期がはっきりしない', mainOf(5.5) === 'aperiodic', JSON.stringify(at(5.5)));
check('55 Hz：70 Hz 未満', mainOf(7.2) === 'range', JSON.stringify(at(7.2)));
const k75 = Math.round(8.45 / C.HOP);
check('1500 Hz は 750 Hz に読まれて帯になる', d.reason[k75] === 'voiced' && Math.abs(d.f0[k75] - 750) < 10, d.f0[k75]);
const k9 = Math.round(9.0 / C.HOP);
check('短すぎる声は帯にならず「短すぎる」', d.reason.slice(k9 - 3, k9 + 3).includes('short') && !d.spans.some(([a]) => Math.abs(a - 9) < 0.1));
check('既定の値の帯の長さは振り分けの「帯あり」と同じ', Math.abs(d.bandSec(0, 0.15) - d.reason.filter(r => r === 'voiced').length * C.HOP) < 1e-6);
check('下限を 5% にすると小さい声が帯から外れる', d.bandSec(0.05, 0.15) < d.bandSec(0, 0.15) - 0.9, `${d.bandSec(0, 0.15).toFixed(2)} → ${d.bandSec(0.05, 0.15).toFixed(2)}`);
check('-50 dBFS 未満の声も帯になる', d.reason[Math.round(9.5 / C.HOP)] === 'voiced', d.reason[Math.round(9.5 / C.HOP)]);
check('-60 dBFS 未満の声は「小さい声」で帯にならない', d.reason[Math.round(9.9 / C.HOP)] === 'quiet', d.reason[Math.round(9.9 / C.HOP)]);
