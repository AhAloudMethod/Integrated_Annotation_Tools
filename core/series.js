// 時間系列（変化点）モデル
(() => {
  const _ = AH._;
  const { SNAP, S, pushUndo } = _;
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

  Object.assign(_, { idxAt, valueIn, valueAt, placePoint, deletePointBefore });
})();
