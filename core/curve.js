// 区間内で変化（カスタムの Excel で「区間内で変化」を使うとき）：選んだ区間だけ、区間の中で値が動いてよいことにする。
// 普通のセルは今までの Excel（表のモデル）のまま。変化にした区間はセルに印 'curve' を置き、値は連続の方式と同じ変化点の系列（S.data.points）に持つ。
// 細かい区切りをたくさん入れる手間を省くための入れ方である。変化の区間のセルは表示だけで、区間の始めの値→終わりの値と形を出す。
// 自由に描くのはグラフでの編集（core/timeline.js）と同じ。形（テンプレート）の記録は S.data.shapes（{ axis, t0, t1, shape }）に持ち、
// 区間をちょうど覆う記録があればその形、無ければ free
(() => {
  const _ = AH._;
  const { FPS, S, binStart, binAt, nSec, r2, clamp, snapshot, pushUndo, addLog, wall } = _;
  const on = () => !!(_.M && _.M.curve);
  const CURVE = 'curve';   // 変化にした区間のセルの印
  const isCurve = (ax, s) => on() && !!S.data && S.data.cells[ax][s] === CURVE;
  const secOf = t => { const s = binAt(t); return s >= 0 && s < nSec() ? s : -1; };
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

  // 区切りを置いたとき（core/range.js）：形の記録を切り分ける。直線の半分は直線のまま、前半・後半で変化の半分は式の形ではないので外す（free）
  function splitAt(t) {
    if (!S.data || !S.data.shapes) return;
    const out = [];
    for (const r of S.data.shapes) {
      if (!(r.t0 < t - EPS && r.t1 > t + EPS)) { out.push(r); continue; }
      if (r.shape === 'line') out.push({ ...r, t1: t }, { ...r, t0: t });
    }
    S.data.shapes = out;
  }

  // ---------- テンプレート ----------
  // 区間の中の位置 u（0〜1）での変わり方。前半で変化は始めに大きく動き、後半で変化は終わりに大きく動く
  const SHAPES = { line: u => u, early: u => 1 - (1 - u) ** 2, late: u => u * u };
  function samples(s, from, to, shape) {
    const [f0, f1] = frames(s), n = f1 - f0, m = new Map(), fn = SHAPES[shape] || SHAPES.line;
    for (let k = 0; k < n; k++) { const u = n > 1 ? k / (n - 1) : 1; m.set(f0 + k, r2(from + (to - from) * fn(u))); }
    return m;
  }
  // 区間 s・軸 ax を形の曲線で描き換え（base の系列から）、形の記録と書き込みの記録（_strokes）に残す。取り消しの記録は呼び出し側
  function put(base, ax, s, from, to, shape, reason, source = 'template') {
    const m = samples(s, from, to, shape); if (!m.size) return false;
    S.data.points[ax] = _.rewriteFrames(base.points[ax], m);
    const b0 = binStart(s), b1 = _.binEnd(s);
    trim(ax, b0, b1);
    if (SHAPES[shape]) (S.data.shapes || (S.data.shapes = [])).push({ axis: ax, t0: +b0.toFixed(4), t1: +b1.toFixed(4), shape });
    const fs = [...m.keys()];
    S.data.strokes.push({ id: S.data.strokes.length, source, axes: ax, shape, t_start: fs[0] / FPS, t_end: fs[fs.length - 1] / FPS, end_reason: reason, wall_ms_end: wall(),
      samples: fs.map(f => [+(f / FPS).toFixed(4), ax === 'v' ? m.get(f) : '', ax === 'a' ? m.get(f) : '']) });
    return true;
  }
  const q = v => r2(clamp(v, 1, 9));
  // グラフのドラッグ（core/timeline.js）：区間の中で押した高さが始めの値、離した高さが終わりの値。ドラッグの間は曲線を予覧する
  let drag = null;
  function down(axis, t, v) {
    const s = secOf(t);
    if (s < 0 || !isCurve(axis, s) || _.M.curveTool() !== 'template') return false;   // 変化の区間でなければ、普通のグラフでの編集（セルの値）
    drag = { axis, s, before: snapshot(), from: q(v), to: q(v) };
    preview(); return true;
  }
  function preview() {
    const d = drag; S.data.points[d.axis] = _.rewriteFrames(d.before.points[d.axis], samples(d.s, d.from, d.to, _.M.curveShape())); _.refresh();
  }
  const move = v => { if (drag) { drag.to = q(v); preview(); } };
  function up() {
    const d = drag; drag = null; if (!d) return;
    const shape = _.M.curveShape();
    S.data.points[d.axis] = d.before.points[d.axis].map(p => ({ ...p }));   // 予覧を捨ててから、記録つきで描き換える
    if (put(d.before, d.axis, d.s, d.from, d.to, shape, 'template')) {
      pushUndo(d.before);
      addLog('graph_curve', { axis: d.axis, value: `${d.from}->${d.to}`, detail: `bin ${d.s} ${shape}` });
    }
    _.refresh();
  }
  // 形を変える（パネルの形のボタン）：入れた区間の始めと終わりの値を保ったまま、その形の曲線にする。自由に描いた区間も同じ。発声なしの区間は変えない
  function reshape(s, shape, axes) {
    if (!on() || _.reviewing() || s < 0 || s >= nSec()) return false;
    const before = snapshot(), done = [];
    for (const ax of axes) {
      const c = isCurve(ax, s) && info(ax, s);
      if (!c || !c.entered || c.shape === 'zero' || c.shape === shape) continue;
      if (put(S.data, ax, s, c.from, c.to, shape, 'reshape')) done.push(ax);
    }
    if (!done.length) return false;
    pushUndo(before);
    addLog('curve_shape', { axis: done.join(''), value: shape, detail: 'bin ' + s });
    _.refresh(); return true;
  }

  // 発声なし（パネルのボタン）：変化の区間を両軸とも 0 で描き換える（形の記録は外す）。読みでは shape が zero になる。
  // 普通のセルはセルに 0 を打つ（modes/_shared.js の xlTable）
  function noVoice(s, axes) {
    if (!on() || _.reviewing() || s < 0 || s >= nSec()) return false;
    const before = snapshot();
    let ch = false; for (const ax of axes) if (isCurve(ax, s)) ch = put(S.data, ax, s, 0, 0, 'none', 'novoice', 'novoice') || ch;
    if (!ch) return false;
    pushUndo(before);
    addLog('curve_novoice', { axis: axes.join(''), detail: 'bin ' + s });
    _.refresh(); return true;
  }

  // ---------- 変化の区間にする・一定に戻す（パネルのボタン） ----------
  // 変化にすると、最初はセルの値のまま一定の線にする（値が入っていなければ初期値の 5 にし、入れた区間とはしない）
  function mark(s, axes) {
    if (!on() || _.reviewing() || s < 0 || s >= nSec()) return false;
    const before = snapshot(), done = [];
    for (const ax of axes) {
      const v = S.data.cells[ax][s]; if (v === CURVE) continue;
      if (typeof v === 'number') put(S.data, ax, s, v, v, v === 0 ? 'none' : 'line', 'mark', 'cell');
      else { const iv = _.M.init[ax]; S.data.points[ax] = _.rewriteFrames(S.data.points[ax], samples(s, iv, iv, 'line')); trim(ax, binStart(s), _.binEnd(s)); }
      S.data.cells[ax][s] = CURVE; done.push(ax);
    }
    if (!done.length) return false;
    pushUndo(before);
    addLog('curve_mark', { axis: done.join(''), value: 'on', detail: 'bin ' + s });
    _.refresh(); return true;
  }
  // 一定に戻す：区間の平均を、普通のセルの刻み（9 段階なら整数、連続値なら小数第 1 位）に丸めた値にする。入れていない区間は空欄、発声なしは 0
  function unmark(s, axes) {
    if (!on() || _.reviewing() || s < 0 || s >= nSec()) return false;
    const before = snapshot(), done = [];
    for (const ax of axes) {
      if (!isCurve(ax, s)) continue;
      const c = info(ax, s, true), round = _.isInt() ? Math.round : x => Math.round(x * 10) / 10;
      S.data.cells[ax][s] = !c || !c.entered ? null : c.shape === 'zero' ? 0 : clamp(round(c.mean), 1, 9);
      trim(ax, binStart(s), _.binEnd(s)); done.push(ax);
    }
    if (!done.length) return false;
    pushUndo(before);
    addLog('curve_mark', { axis: done.join(''), value: 'off', detail: 'bin ' + s });
    _.refresh(); return true;
  }
  // グラフで自由に描くとき（core/timeline.js）：押した所が変化の区間なら系列を描く。描くのは変化の区間のフレームだけ
  const seriesAt = (ax, t) => { const s = secOf(t); return s >= 0 && isCurve(ax, s); };

  Object.assign(_, { curveIsCurve: isCurve, curveSeriesAt: seriesAt, curveMark: mark, curveUnmark: unmark, curveSplitAt: splitAt, curveNoVoice: noVoice, curveOn: on, curveInfo: info, curveTrim: trim, curveFrames: frames, curveDown: down, curveMove: move, curveUp: up, curveReshape: reshape, curveDragging: () => (drag ? drag.axis : null) });
})();
