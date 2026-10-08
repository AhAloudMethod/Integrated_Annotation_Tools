// 区間内で変化（カスタムの Excel で値を「区間内で変化」にしたとき）：値は連続の方式と同じ変化点の系列に持ち、区間ごとに読む。
// 自由に描くのはグラフでの編集（core/timeline.js）と同じ。表のセルは表示だけで、区間の始めの値→終わりの値と形を出す。
// 形（テンプレート）の記録は系列とは別に S.data.shapes（{ axis, t0, t1, shape }）に持つ。区間をちょうど覆う記録があればその形、無ければ free
(() => {
  const _ = AH._;
  const { FPS, S, binStart } = _;
  const on = () => !!(_.M && _.M.curve);
  const EPS = 1e-6, TOL = 1.5 / FPS;   // 記録が区間をちょうど覆うとみなす幅
  const frames = s => {   // 区間 s のフレーム [f0, f1)（動画の最後のフレームまで）
    const N = Math.floor((S.meta.duration || 0) * FPS);
    return [Math.round(binStart(s) * FPS), Math.min(Math.round(_.binEnd(s) * FPS), N + 1)];
  };
  // 書き込み（グラフ・テンプレート・発声なし）が少しでもかかった区間を「入れた区間」とする
  const entered = (ax, s) => {
    const b0 = binStart(s), b1 = _.binEnd(s);
    return S.data.strokes.some(st => st.axes.includes(ax) && st.t_start < b1 - EPS && st.t_end >= b0 - EPS);
  };
  // 区間 s・軸 ax の読み：{ entered, from, to, shape, mean? }。shape は line・early・late・free、どの値も 0 なら zero（発声なし）
  function info(ax, s, withMean = false) {
    const [f0, f1] = frames(s); if (f1 <= f0) return null;
    const from = _.valueAt(ax, f0 / FPS), to = _.valueAt(ax, (f1 - 1) / FPS);
    let mean, zero = from === 0 && to === 0;
    if (withMean || zero) {
      let sum = 0, nz = 0; for (let f = f0; f < f1; f++) { const v = _.valueAt(ax, f / FPS); sum += v; if (v !== 0) nz++; }
      mean = sum / (f1 - f0); zero = nz === 0;
    }
    const b0 = binStart(s), b1 = _.binEnd(s);
    const rec = (S.data.shapes || []).find(r => r.axis === ax && Math.abs(r.t0 - b0) < TOL && Math.abs(r.t1 - b1) < TOL);
    return { entered: entered(ax, s), from, to, mean, shape: zero ? 'zero' : rec ? rec.shape : 'free' };
  }
  // 形の記録から [t0, t1) を除く（自由に描き直した範囲）。直線の残りは直線のまま、ほかの形の残りは式の形ではないので消す（free）
  function trim(ax, t0, t1) {
    if (!S.data.shapes) return;
    const out = [];
    for (const r of S.data.shapes) {
      if (r.axis !== ax || r.t1 <= t0 + EPS || r.t0 >= t1 - EPS) { out.push(r); continue; }
      if (r.shape !== 'line') continue;
      if (r.t0 < t0 - EPS) out.push({ ...r, t1: t0 });
      if (r.t1 > t1 + EPS) out.push({ ...r, t0: t1 });
    }
    S.data.shapes = out;
  }

  Object.assign(_, { curveOn: on, curveInfo: info, curveTrim: trim, curveFrames: frames });
})();
