// 相対イベントモデル
(() => {
  const _ = AH._;
  const { S, vt, addLog, pushUndo } = _;
  // ---------- 相対イベントモデル ----------
  function addEvent(ev) {
    pushUndo();
    const e = { t: vt(), ...ev };
    const ev2 = S.data.events; let i = ev2.length; while (i > 0 && ev2[i - 1].t > e.t) i--;
    ev2.splice(i, 0, e);
    addLog('rank', { value: e.label, detail: `dv=${e.dv} da=${e.da}` + (e.source ? ` source=${e.source}` : '') }); _.refresh();
  }
  function deleteEventBefore(t) {
    const ev = S.data.events;
    for (let i = ev.length - 1; i >= 0; i--) if (ev[i].t <= t + 1e-9) { pushUndo(); const e = ev.splice(i, 1)[0]; addLog('delete', { value: e.label, detail: 'at ' + e.t }); _.refresh(); return; }
  }

  Object.assign(_, { addEvent, deleteEventBefore });
})();
