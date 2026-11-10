// F0（声の高さ）と発声の区間の計算。ブラウザ（core/f0.js・core/voiced.js）と Node（tools/voiced-why.js）の両方で使う。
// 音声は 16kHz・モノラル。10 ms ごとに 40 ms の窓で音量（RMS）を求め，音量が足りる窓だけ YIN で F0 を求める
(() => {
  const SR = 16000, HOP = 0.01, WIN = 640;        // 16kHz、10ms ごと、窓 40ms
  const FMIN = 70, FMAX = 1000;                   // 探す範囲（Hz）。叫び声の高い「あ」も入るよう広めに
  const YIN_TH = 0.15;                            // YIN のしきい値（小さいほど厳しく「声あり」とする）
  // 小さすぎる音は声なし（-60dBFS）。声かどうかは YIN の周期で決め、音量の下限は低く置く。
  // 以前は -50dBFS と最大の 5% だったが、小さく録れた声（実験3 の P02 は最大 -37dBFS）や、効果音で最大が上がった録画の声を切っていた
  const FLOOR_ABS = 0.001, FLOOR_REL = 0;
  const GAP = 10, MIN_RUN = 5;                    // 発声の区間：つなぐ切れ目・除く短さ（10 ms の窓の数）

  // YIN（de Cheveigné & Kawahara, 2002）。f0 は声がはっきりしなければ NaN。
  // dmin は探す範囲での正規化差分の最小（小さいほど周期がはっきりしている。th 未満なら声あり）
  function yinDetail(x, off, sr = SR, win = WIN, fmin = FMIN, fmax = FMAX, th = YIN_TH) {
    const tMin = Math.max(2, Math.floor(sr / fmax)), tMax = Math.min(Math.floor(sr / fmin), win - 1);
    const d = new Float32Array(tMax + 2);
    for (let tau = 1; tau <= tMax + 1; tau++) {
      let s = 0;
      for (let i = 0; i < win - tMax - 1; i++) { const v = x[off + i] - x[off + i + tau]; s += v * v; }
      d[tau] = s;
    }
    // 累積平均で正規化した差分関数
    let run = 0; const dn = new Float32Array(tMax + 2); dn[0] = 1;
    for (let tau = 1; tau <= tMax + 1; tau++) { run += d[tau]; dn[tau] = run > 0 ? d[tau] * tau / run : 1; }
    let dmin = Infinity; for (let t = tMin; t <= tMax; t++) if (dn[t] < dmin) dmin = dn[t];
    let tau = -1;
    for (let t = tMin; t <= tMax; t++) if (dn[t] < th) { while (t + 1 <= tMax && dn[t + 1] < dn[t]) t++; tau = t; break; }
    if (tau < 0) return { f0: NaN, dmin };
    // 放物線補間で細かく
    const a = dn[tau - 1], b = dn[tau], c = dn[tau + 1], den = a - 2 * b + c;
    const shift = den !== 0 ? 0.5 * (a - c) / den : 0;
    return { f0: sr / (tau + (Math.abs(shift) < 1 ? shift : 0)), dmin };
  }
  const yin = (...a) => yinDetail(...a).f0;

  const nFrames = len => Math.max(0, Math.floor((len - WIN) / (SR * HOP)) + 1);
  const frameOff = k => Math.round(k * SR * HOP);
  // 窓ごとの音量（RMS）
  function rmsFrames(samples) {
    const n = nFrames(samples.length), rms = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const off = frameOff(k);
      let e = 0; for (let i = 0; i < WIN; i++) e += samples[off + i] * samples[off + i];
      rms[k] = Math.sqrt(e / WIN);
    }
    return rms;
  }
  // 声なしとする音量の下限：録画全体の最大の rel 倍と abs の大きいほう（既定は rel = 0 で abs だけ）
  function floorOf(rms, rel = FLOOR_REL, abs = FLOOR_ABS) {
    let mx = 0; for (const v of rms) if (v > mx) mx = v;
    return Math.max(abs, mx * rel);
  }

  // 声のある区間 [[t0, t1], …]（秒）。短い切れ目をつなぎ、短すぎる声を除く
  function spans(f0, hop = HOP) {
    const out = [], n = f0.length, v = k => f0[k] > 0;
    for (let k = 0; k < n;) {
      if (!v(k)) { k++; continue; }
      let e = k; while (e < n && v(e)) e++;
      // 短い切れ目をつなぐ
      for (;;) { let g = e; while (g < n && !v(g) && g - e < GAP) g++; if (g < n && v(g) && g - e < GAP) { e = g; while (e < n && v(e)) e++; } else break; }
      if (e - k >= MIN_RUN) out.push([k * hop, e * hop + WIN / SR]);   // 窓（40 ms）の終わりまで
      k = e;
    }
    return out;
  }

  const api = { SR, HOP, WIN, FMIN, FMAX, YIN_TH, FLOOR_ABS, FLOOR_REL, GAP, MIN_RUN, yinDetail, yin, nFrames, frameOff, rmsFrames, floorOf, spans };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else AH._.f0calc = api;
})();
