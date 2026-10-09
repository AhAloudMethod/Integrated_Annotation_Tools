// 区間表モデル
(() => {
  const _ = AH._;
  const { S, addLog, pushUndo, secLabel } = _;
  // ---------- 区間表モデル ----------
  function setCell(axis, s, val, how = 'input') {
    if (_.reviewing()) return false;   // 視聴の間は値を変えない
    const c = S.data.cells[axis];
    if (c[s] === 'curve') return false;   // 区間内で変化の変化の区間（core/curve.js）はセルの値で上書きしない（音声入力・数字キーなど）
    if ((c[s] ?? null) === (val ?? null)) return false;   // 未入力（undefined）と空欄（null）は同じ扱い
    pushUndo(); c[s] = val;
    addLog('cell_' + how, { axis, value: val ?? '', detail: 'bin ' + s + ' (' + secLabel(s) + ')' });
    _.refresh(); return true;
  }
  function setCells(s, vals, how = 'input') {   // 複数軸をまとめて1回の取り消し単位で
    if (_.reviewing()) return false;
    const c = S.data.cells;
    vals = Object.fromEntries(Object.entries(vals).filter(([ax]) => c[ax][s] !== 'curve'));   // 変化の区間の軸は変えない
    if (Object.entries(vals).every(([ax, v]) => (c[ax][s] ?? null) === (v ?? null))) return false;
    pushUndo();
    for (const [ax, v] of Object.entries(vals)) c[ax][s] = v;
    addLog('cell_' + how, { axis: Object.keys(vals).join(''), value: Object.values(vals).join('/'), detail: 'bin ' + s + ' (' + secLabel(s) + ')' });
    _.refresh(); return true;
  }

  Object.assign(_, { setCell, setCells });
})();
