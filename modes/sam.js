// ---- SAM（9段階の絵） ----
(() => {
  const { S } = AH;
  const { h, toggle, secStrip, autoNext, samRows } = AH.ui;
  let rows = {}, strip;
  AH.register({
    vaOnly: true,   // 絵・感情語が VA 前提なので、評価の軸の組にかかわらず VA（core/axes.js）
    id: 'sam', group: '離散（区間ごと）', label: 'SAM（9段階の絵）', model: 'table', side: 'narrow', init: { v: 5, a: 5 },
    options: { autoNext: false },
    help: '<p>今の区間（下の帯で強調）について、快度と覚醒度の絵をそれぞれ1つ選びます。絵と絵の間の小円は中間の値です。「入力後に次の区間へ」をオンにすると、両方選んだ時点で次の区間へ進みます。</p>',
    mount({ panel, under }) {
      // SAM の行はツールの列に置き、絵の大きさは空いている高さに合わせる（layout.js）
      const box = h('div', { class: 'planeBox sam' });
      rows = samRows(box, (ax, i) => {
        const s = AH.inputSec(); if (s == null) return;
        AH.setCell(ax, s, i, 'sam');
        if (S.data.cells.v[s] != null && S.data.cells.a[s] != null) autoNext(s);
      });
      const o = h('div', { class: 'opts' }); toggle(o, 'autoNext', '入力後に次の区間へ'); box.appendChild(o);
      panel.appendChild(box); strip = secStrip(under);
    },
    update() {
      const s = AH.curSec();
      for (const ax of ['v', 'a']) if (rows[ax]) for (const b of rows[ax].children) b.classList.toggle('on', +b.dataset.v === S.data.cells[ax][s]);
      strip();
    },
  });
})();
