// ---- EMuJoy（四角い平面・顔・尾） ----
(() => {
  const { pen } = AH;
  const { opts, h, shown, nowRow, toggle, squareVal, bindHold, planeCanvas, drawSquareFrame, trail, drawFace, stick } = AH.ui;
  let c, g, now; const PAD = 22;
  const stk = stick();   // ジョイスティックが使える間は記録オン（R）の間の記録
  AH.register({
    id: 'emujoy', group: '時間連続・2次元', label: 'EMuJoy（マウス・四角平面）', model: 'series', init: { v: 5, a: 5 }, side: 'wide', get animate() { return stk.on(); },
    options: { face: true, tail: true },
    writeMode: () => (stk.on() ? 'armed' : 'hold'), writeAxes: () => ['v', 'a'], sample: () => (stk.on() ? stk.val() : pen),
    help: '<p>再生中に平面上でボタンを押している間だけ記録され、その区間は前の記録を上書きします。押さずに再生すれば見直すだけです。一時停止中のクリックはその時刻に変化点を1つ置きます。</p><p>ジョイスティック（ゲームパッド）をつなぐと、スティックの位置がそのまま値になり（離すと中性）、記録オン（<kbd>R</kbd> またはボタン0）の間だけ記録します。マウスもそのまま使えます（スティックを倒している間はスティックが優先）。</p>',
    mount({ panel }) {
      ({ c } = planeCanvas(panel, AH.ax('v').name + '・' + AH.ax('a').name + 'の平面')); now = nowRow(c.parentNode);
      const o = h('div', { class: 'opts' }); toggle(o, 'face', '顔'); toggle(o, 'tail', '軌跡'); c.parentNode.appendChild(o);
      bindHold(c, e => squareVal(c, e, PAD));
    },
    resize() { g = AH.fitCanvas(c); },
    update(t) {
      if (!g) return;
      const q = drawSquareFrame(g, c, PAD), cur = stk.on() ? stk.shown(t) : shown(t), col = AH.isWriting() ? AH.css('--pen') : AH.css('--ink');
      if (opts().tail) {
        const tr = trail(t, 1.5, 24, cur); g.strokeStyle = col; g.lineWidth = 2;
        for (let i = 1; i < tr.length; i++) { g.globalAlpha = 0.6 * (1 - tr[i].age); g.beginPath(); g.moveTo(q.X(tr[i - 1].v), q.Y(tr[i - 1].a)); g.lineTo(q.X(tr[i].v), q.Y(tr[i].a)); g.stroke(); }
        g.globalAlpha = 1;
      }
      if (opts().face) drawFace(g, q.X(cur.v), q.Y(cur.a), cur.v, cur.a, col);
      else { g.fillStyle = col; g.beginPath(); g.arc(q.X(cur.v), q.Y(cur.a), 6, 0, 7); g.fill(); }
      now(cur);
    },
  });
})();
