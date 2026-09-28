// 区間表モデル
(() => {
  const _ = AH._;
  const { S, addLog, pushUndo, secLabel } = _;
  // ---------- 区間表モデル ----------
  function setCell(axis, s, val, how = 'input') {
    const c = S.data.cells[axis];
    if (c[s] === val) return false;
    pushUndo(); c[s] = val;
    addLog('cell_' + how, { axis, value: val ?? '', detail: 'bin ' + s + ' (' + secLabel(s) + ')' });
    _.refresh(); return true;
  }
  function setCells(s, vals, how = 'input') {   // 複数軸をまとめて1回の取り消し単位で
    const c = S.data.cells;
    if (Object.entries(vals).every(([ax, v]) => c[ax][s] === v)) return false;
    pushUndo();
    for (const [ax, v] of Object.entries(vals)) c[ax][s] = v;
    addLog('cell_' + how, { axis: Object.keys(vals).join(''), value: Object.values(vals).join('/'), detail: 'bin ' + s + ' (' + secLabel(s) + ')' });
    _.refresh(); return true;
  }

  Object.assign(_, { setCell, setCells });
})();
