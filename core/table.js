// 区間表モデル
(() => {
  const _ = AH._;
  const { S, addLog, pushUndo, secLabel } = _;
  // ---------- 区間表モデル ----------
  // 発声なしの事前設定（実験モードの setup.json の novoice → S.meta.novoice_preset．core/experiment.js）：
  // 区間の中央が範囲 [始め, 終わり) に入る区間は固定で、値は 0（発声なし）。入力・音声・グラフの編集では変えられない
  function novoiceLocked(s) {
    const pr = S.meta.novoice_preset; if (!pr || !pr.length || s < 0 || s >= _.nSec()) return false;
    const m = (_.binStart(s) + _.binEnd(s)) / 2;
    return pr.some(([a, b]) => m >= a && m < b);
  }
  // 固定の区間の値を 0 にそろえる（取り消し・全消去・区間の変更のあとも保つため、画面更新のたびに呼ぶ）。区間表の方式だけ
  function applyNoVoice() {
    if (!S.data || !S.meta.novoice_preset || !_.M || _.M.model !== 'table') return;
    for (let s = 0; s < _.nSec(); s++) if (novoiceLocked(s)) for (const ax of ['v', 'a']) if (S.data.cells[ax][s] !== 0) S.data.cells[ax][s] = 0;
  }
  const lockedHint = () => _.hintMsg('この区間は発声なし（事前設定）です。変えられません');
  function setCell(axis, s, val, how = 'input') {
    if (_.reviewing()) return false;   // 視聴の間は値を変えない
    if (novoiceLocked(s)) { lockedHint(); return false; }
    const c = S.data.cells[axis];
    if (c[s] === 'curve') return false;   // 区間内で変化の変化の区間（core/curve.js）はセルの値で上書きしない（音声入力・数字キーなど）
    if ((c[s] ?? null) === (val ?? null)) return false;   // 未入力（undefined）と空欄（null）は同じ扱い
    pushUndo(); c[s] = val;
    addLog('cell_' + how, { axis, value: val ?? '', detail: 'bin ' + s + ' (' + secLabel(s) + ')' });
    _.refresh(); return true;
  }
  function setCells(s, vals, how = 'input') {   // 複数軸をまとめて1回の取り消し単位で
    if (_.reviewing()) return false;
    if (novoiceLocked(s)) { lockedHint(); return false; }
    const c = S.data.cells;
    vals = Object.fromEntries(Object.entries(vals).filter(([ax]) => c[ax][s] !== 'curve'));   // 変化の区間の軸は変えない
    if (Object.entries(vals).every(([ax, v]) => (c[ax][s] ?? null) === (v ?? null))) return false;
    pushUndo();
    for (const [ax, v] of Object.entries(vals)) c[ax][s] = v;
    addLog('cell_' + how, { axis: Object.keys(vals).join(''), value: Object.values(vals).join('/'), detail: 'bin ' + s + ' (' + secLabel(s) + ')' });
    _.refresh(); return true;
  }

  Object.assign(_, { setCell, setCells, novoiceLocked, applyNoVoice });
})();
