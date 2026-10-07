// ---- DARMA（物理ジョイスティック） ----
(() => {
  const { h, stored, nowRow, squareVal, bindHold, planeCanvas, drawSquareFrame, stick } = AH.ui;
  let c, g, now, stat; const PAD = 22;
  const stk = stick();   // スティックの位置＝値（遊びの外はスティック、遊びの中は押している間のマウス、どちらもなければ中性）
  AH.register({
    id: 'darma', group: '時間連続・2次元', label: 'DARMA（ジョイスティック・四角平面）', model: 'series', init: { v: 5, a: 5 }, side: 'wide', animate: true,
    writeMode: () => 'armed', writeAxes: () => ['v', 'a'], sample: () => stk.val(),
    help: '<p>スティックの位置がそのまま値です。マウス入力もできます。</p>',
    mount({ panel }) {
      ({ c } = planeCanvas(panel, 'DARMA の平面')); now = nowRow(c.parentNode);
      stat = h('div', { class: 'opts' }); c.parentNode.appendChild(stat);
      bindHold(c, e => squareVal(c, e, PAD));
    },
    resize() { g = AH.fitCanvas(c); },
    update(t) {
      if (!g) return;
      const q = drawSquareFrame(g, c, PAD), st = stored(t), ctrl = stk.val(), j = AH.padJoy();
      g.fillStyle = AH.css('--muted'); g.beginPath(); g.arc(q.X(st.v), q.Y(st.a), 5, 0, 7); g.fill();   // 記録値
      g.strokeStyle = AH.isWriting() ? AH.css('--pen') : AH.css('--ink'); g.lineWidth = 2;               // 入力中の位置
      g.beginPath(); g.arc(q.X(ctrl.v), q.Y(ctrl.a), 9, 0, 7); g.stroke();
      stat.textContent = j ? `ジョイスティック：${j.id}（● 記録値　○ スティック）` : 'ゲームパッド未接続：何かボタンを押すと認識されます';
      now(AH.S.armed || stk.active() || AH.pen.down || !AH.hasVideo() ? ctrl : st);
    },
  });
})();
