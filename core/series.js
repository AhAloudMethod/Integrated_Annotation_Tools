// 時間系列（変化点）モデル
(() => {
  const _ = AH._;
  const { FPS, SNAP, S, pushUndo } = _;
  // ---------- 時間系列（変化点）モデル ----------
  function idxAt(ps, t) {
    let lo = 0, hi = ps.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ps[mid].t <= t + 1e-9) lo = mid; else hi = mid - 1; }
    return lo;
  }
  const valueIn = (ps, t) => ps[idxAt(ps, t)].val;
  const valueAt = (axis, t) => valueIn(S.data.points[axis], t);

  function placePoint(axis, t, val) {
    const ps = S.data.points[axis];
    const near = ps.findIndex(p => Math.abs(p.t - t) < SNAP);
    if (near >= 0) { if (ps[near].val === val) return false; ps[near].val = val; }
    else { if (valueIn(ps, t) === val) return false; ps.splice(idxAt(ps, t) + 1, 0, { t, val }); }
    return true;
  }
  function deletePointBefore(axis, t) {
    const ps = S.data.points[axis];
    for (let i = ps.length - 1; i >= 0; i--) if (ps[i].t <= t + 1e-9 && !ps[i].init) { pushUndo(); return ps.splice(i, 1)[0]; }
    return null;
  }

  // フレームごとの値（samples：フレーム番号→値）で、その範囲の変化点を描き換えた新しい変化点の列を返す。
  // 範囲の外の変化点はそのまま残し、範囲の直後は元の値に戻す（グラフでの編集と「区間内で変化」のテンプレートで使う）
  function rewriteFrames(src, samples) {
    const fs = [...samples.keys()].sort((a, b) => a - b);
    const fmin = fs[0], fmax = fs[fs.length - 1], tmin = fmin / FPS, tmax = (fmax + 1) / FPS;
    const old = valueIn(src, tmax), init = { ...src[0] };
    const keep = src.filter(p => !p.init && (p.t < tmin - 1e-9 || p.t >= tmax - 1e-9)).map(p => ({ ...p }));
    const ins = [];
    let last = fmin === 0 ? null : valueIn(src, tmin - 1e-6);
    for (let f = fmin; f <= fmax; f++) {
      const v = samples.get(f); if (v === undefined || v === last) continue;
      if (f === 0) init.val = v; else ins.push({ t: +(f / FPS).toFixed(4), val: v });
      last = v;
    }
    if (tmax < S.meta.duration && last !== old && !keep.some(p => Math.abs(p.t - tmax) < 1e-9)) ins.push({ t: +tmax.toFixed(4), val: old });
    return [init, ...[...keep, ...ins].sort((a, b) => a.t - b.t)];
  }

  Object.assign(_, { idxAt, valueIn, valueAt, placePoint, deletePointBefore, rewriteFrames });
})();
