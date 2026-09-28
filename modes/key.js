// ---- 変化点キー（本研究の試作） ----
(() => {
  const { h } = AH.ui;
  let lastAxis = 'v', els = {};
  function setValue(axis, val) {
    lastAxis = axis;
    const before = AH.snapshot();
    if (!AH.placePoint(axis, AH.vt(), val)) { AH.addLog('input_same', { axis, value: val }); return; }
    AH.pushUndo(before); AH.addLog('input', { axis, value: val }); AH.refresh();
  }
  AH.register({
    id: 'key', group: '時間連続・2次元', label: '変化点キー（試作）', model: 'series', init: { v: 5, a: 5 }, side: 'narrow', integer: true,
    help: '<p>値が変わったと思った瞬間に数字を押すと、その時刻から次の変化点までその値が続きます。<kbd>1</kbd>〜<kbd>9</kbd> 快度、<kbd>Shift</kbd>+数字またはテンキーで覚醒度。<kbd>Backspace</kbd> 直前の変化点を削除（枠が濃いほうの軸）。</p>',
    mount({ panel }) {
      for (const [ax, name, keys, lo, hi] of [['v', '快度', 'キー 1〜9', '不快', '快'], ['a', '覚醒度', 'Shift+1〜9', '眠気', '覚醒']]) {
        const box = h('div', { class: 'axis ' + ax }, `<h2><span>${name}</span><span class="time">${keys}</span></h2><div class="now">5</div><div class="keys"></div><div class="ends"><span>${lo}</span><span>中立</span><span>${hi}</span></div>`);
        const kc = box.querySelector('.keys');
        for (let i = 1; i <= 9; i++) kc.appendChild(h('button', { 'data-v': i, onclick: e => { setValue(ax, i); e.currentTarget.blur(); } }, String(i)));
        panel.appendChild(box); els[ax] = box;
      }
    },
    update(t) {
      for (const ax of ['v', 'a']) {
        const val = AH.valueAt(ax, t), b = els[ax]; if (!b) continue;
        b.querySelector('.now').textContent = val;
        for (const k of b.querySelectorAll('.keys button')) k.classList.toggle('on', +k.dataset.v === val);
        b.classList.toggle('target', lastAxis === ax);
      }
    },
    onKey(e) {
      const m = e.code.match(/^(Digit|Numpad)([1-9])$/);
      if (m) { setValue(m[1] === 'Numpad' || e.shiftKey ? 'a' : 'v', +m[2]); return true; }
      if (e.code === 'Backspace') { const p = AH.deletePointBefore(lastAxis, AH.vt()); if (p) { AH.addLog('delete', { axis: lastAxis, value: p.val, detail: 'at ' + p.t }); AH.refresh(); } return true; }
      return false;
    },
  });
})();
