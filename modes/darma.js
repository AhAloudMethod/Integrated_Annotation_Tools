// ---- DARMA（物理ジョイスティック） ----
(() => {
  const { h, stored, nowRow, squareVal, planeCanvas, drawSquareFrame, dead } = AH.ui;
  let c, g, now, stat; const PAD = 22;
  const ctrl = { v: 5, a: 5 }; let mouseDown = false, hasPad = false;
  AH.register({
    id: 'darma', group: '時間連続・2次元', label: 'DARMA（ゲームパッド／ジョイスティック）', model: 'series', init: { v: 5, a: 5 }, side: 'wide', animate: true,
    writeMode: () => 'armed', writeAxes: () => ['v', 'a'], sample: () => ctrl,
    help: '<p>スティックの位置がそのまま値です（離すと中性に戻ります）。記録オン（<kbd>R</kbd> またはAボタン）の間、再生中の値を記録・上書きします。ゲームパッドがない場合は平面をマウスで押して代用できます（離すと中性）。</p>',
    mount({ panel }) {
      ({ c } = planeCanvas(panel, 'DARMA の平面')); now = nowRow(c.parentNode);
      stat = h('div', { class: 'opts' }); c.parentNode.appendChild(stat);
      c.addEventListener('pointerdown', e => { mouseDown = true; c.setPointerCapture(e.pointerId); Object.assign(ctrl, squareVal(c, e, PAD)); });
      c.addEventListener('pointermove', e => { if (mouseDown) Object.assign(ctrl, squareVal(c, e, PAD)); });
      const up = () => { mouseDown = false; if (!hasPad) Object.assign(ctrl, { v: 5, a: 5 }); };
      c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    },
    resize() { g = AH.fitCanvas(c); },
    tick() {
      const gp = AH.gamepad(); hasPad = !!gp;
      if (gp && !mouseDown) { ctrl.v = AH.r2(5 + dead(gp.axes[0] || 0) * 4); ctrl.a = AH.r2(5 - dead(gp.axes[1] || 0) * 4); }
    },
    update(t) {
      if (!g) return;
      const q = drawSquareFrame(g, c, PAD), st = stored(t);
      g.fillStyle = AH.css('--muted'); g.beginPath(); g.arc(q.X(st.v), q.Y(st.a), 5, 0, 7); g.fill();   // 記録値
      g.strokeStyle = AH.isWriting() ? AH.css('--pen') : AH.css('--ink'); g.lineWidth = 2;               // 入力中の位置
      g.beginPath(); g.arc(q.X(ctrl.v), q.Y(ctrl.a), 9, 0, 7); g.stroke();
      stat.textContent = hasPad ? 'ゲームパッド接続中（● 記録値　○ スティック）' : 'ゲームパッド未接続：何かボタンを押すと認識されます（マウスで代用可）';
      now(AH.isWriting() || !AH.hasVideo() ? ctrl : st);
    },
  });
})();
