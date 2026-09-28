// ---- SAM（9段階の絵） ----
(() => {
  const { S } = AH;
  const { h, toggle, secStrip, autoNext, samRows } = AH.ui;
  let rows = {}, strip;
  AH.register({
    id: 'sam', group: '離散（区間ごと）', label: 'SAM（9段階の絵）', model: 'table', side: 'narrow', init: { v: 5, a: 5 },
    options: { autoNext: false },
    help: '<p>今の区間（下の帯で強調）について、快度と覚醒度の絵をそれぞれ1つ選びます。絵と絵の間の小円は中間の値です。「入力後に次の区間へ」をオンにすると、両方選んだ時点で次の区間へ進みます。</p>',
    mount({ panel, under }) {
      // 絵が読めるよう、SAM の行は動画の下の広い欄に置く
      const box = h('div', { class: 'planeBox sam' });
      rows = samRows(box, (ax, i) => {
        const s = AH.curSec(); AH.setCell(ax, s, i, 'sam');
        if (S.data.cells.v[s] != null && S.data.cells.a[s] != null) autoNext(s);
      });
      under.appendChild(box); strip = secStrip(under);
      const side = h('div', { class: 'planeBox' }), o = h('div', { class: 'opts' });
      toggle(o, 'autoNext', '入力後に次の区間へ'); side.appendChild(o); panel.appendChild(side);
    },
    update() {
      const s = AH.curSec();
      for (const ax of ['v', 'a']) if (rows[ax]) for (const b of rows[ax].children) b.classList.toggle('on', +b.dataset.v === S.data.cells[ax][s]);
      strip();
    },
  });
})();
