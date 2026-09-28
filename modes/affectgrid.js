// ---- Affect Grid（9×9） ----
(() => {
  const { S } = AH;
  const { h, toggle, planeCanvas, secStrip, setBoth, autoNext } = AH.ui;
  let c, g, strip; const PAD = 34;
  AH.register({
    id: 'affectgrid', group: '離散（区間ごと）', label: 'Affect Grid（9×9・クリック）', model: 'table', side: 'wide', init: { v: 5, a: 5 },
    options: { autoNext: false },
    help: '<p>今の区間（下の帯で強調）について、グリッドのマスを1つクリックします（横＝快度、縦＝覚醒度）。帯のマスを押すとその秒へ移動します。「入力後に次の秒へ」をオンにすると自動で次の区間へ進みます。</p>',
    mount({ panel, under }) {
      ({ c } = planeCanvas(panel, 'Affect Grid'));
      const o = h('div', { class: 'opts' }); toggle(o, 'autoNext', '入力後に次の区間へ'); c.parentNode.appendChild(o);
      strip = secStrip(under);
      c.addEventListener('pointerdown', e => {
        const r = c.getBoundingClientRect(), s9 = (c.clientWidth - PAD * 2) / 9;
        const i = Math.floor((e.clientX - r.left - PAD) / s9), j = Math.floor((e.clientY - r.top - PAD) / s9);
        if (i < 0 || i > 8 || j < 0 || j > 8) return;
        const s = AH.inputSec(); if (s == null) return;
        setBoth(s, i + 1, 9 - j, 'grid'); autoNext(s);
      });
    },
    resize() { g = AH.fitCanvas(c); },
    update() {
      if (!g) return;
      const w = c.clientWidth, s9 = (w - PAD * 2) / 9, s = AH.curSec();
      g.clearRect(0, 0, w, w);
      const cv = S.data.cells.v[s], ca = S.data.cells.a[s], pv = S.data.cells.v[s - 1], pa = S.data.cells.a[s - 1];
      for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) {
        const x = PAD + i * s9, y = PAD + j * s9;
        if (pv === i + 1 && pa === 9 - j) { g.fillStyle = AH.css('--grid'); g.fillRect(x, y, s9, s9); }
        if (cv === i + 1 && ca === 9 - j) { g.fillStyle = AH.css('--val'); g.fillRect(x, y, s9, s9); }
        g.strokeStyle = AH.css('--line'); g.lineWidth = (i === 4 || j === 4) ? 1.6 : 1; g.strokeRect(x, y, s9, s9);
      }
      g.fillStyle = AH.css('--muted'); g.font = '11px system-ui, sans-serif'; g.textAlign = 'center';
      const L = PAD, R = w - PAD, T = PAD, B = w - PAD, M = w / 2;
      g.fillText('覚醒', M, T - 8); g.fillText('眠気', M, B + 16);
      g.fillText('ストレス', L + 10, T - 8); g.fillText('興奮', R - 10, T - 8); g.fillText('憂鬱', L + 10, B + 16); g.fillText('安堵', R - 10, B + 16);
      g.save(); g.translate(L - 12, M); g.rotate(-Math.PI / 2); g.fillText('不快', 0, 0); g.restore();
      g.save(); g.translate(R + 12, M); g.rotate(Math.PI / 2); g.fillText('快', 0, 0); g.restore();
      g.textAlign = 'left';
      strip();
    },
  });
})();
