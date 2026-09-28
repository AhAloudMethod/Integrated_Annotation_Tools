// ---- AffectRank（変化を感じたときだけ8方向から選ぶ） ----
(() => {
  const { S } = AH;
  const { h } = AH.ui;
  let btns = {}, list;
  // [ラベル, dv, da, テンキー]
  const DIRS = [['活発', 0, 1, 'Numpad8'], ['活発・快', 1, 1, 'Numpad9'], ['快', 1, 0, 'Numpad6'], ['非活発・快', 1, -1, 'Numpad3'],
                ['非活発', 0, -1, 'Numpad2'], ['非活発・不快', -1, -1, 'Numpad1'], ['不快', -1, 0, 'Numpad4'], ['活発・不快', -1, 1, 'Numpad7']];
  function fire(d) {
    AH.addEvent({ label: d[0], dv: d[1], da: d[2] });
    const b = btns[d[0]]; b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 350);
  }
  AH.register({
    id: 'affectrank', group: '相対（変化の方向）', label: 'AffectRank（変化時に8方向）', model: 'events', side: 'wide', init: { v: 5, a: 5 },
    help: '<p>快度・覚醒度が「変わった」と感じたときだけ、変化の方向を8つから選んでクリックします（テンキーでも可：8＝活発、9＝活発・快、6＝快 …）。変化がなければ何もしません。<kbd>Backspace</kbd> で今の時刻より前の直近の入力を削除します。</p>',
    mount({ panel }) {
      const box = h('div', { class: 'planeBox' }), pl = h('div', { class: 'arPlane' });
      pl.appendChild(h('div', { class: 'arAxis h' })); pl.appendChild(h('div', { class: 'arAxis v' }));
      for (const d of DIRS) {
        const b = h('button', { class: 'arBtn', title: d[0], style: `left:${50 + d[1] * 38}%;top:${50 - d[2] * 38}%`, onclick: e => { fire(d); e.currentTarget.blur(); } }, `<span>${d[0]}</span>`);
        pl.appendChild(b); btns[d[0]] = b;
      }
      box.appendChild(pl); list = h('div', { class: 'arList' }); box.appendChild(list); panel.appendChild(box);
    },
    onKey(e) {
      const d = DIRS.find(x => x[3] === e.code); if (d) { fire(d); return true; }
      if (e.code === 'Backspace') { AH.deleteEventBefore(AH.vt()); return true; }
      return false;
    },
    update() {
      if (!list) return;
      const ev = S.data.events.slice(-5).reverse();
      list.innerHTML = ev.length ? ev.map(e => `<div>${AH.fmt(e.t)}　${e.label}</div>`).join('') : '<div class="muted">まだ入力がありません</div>';
    },
  });
})();
