// ---- HaloLight / Gradient HaloLight（色の円） ----
(() => {
  const { pen } = AH;
  const { opts, h, shown, nowRow, toggle, squareVal, bindHold, planeCanvas, drawSquareFrame, stick } = AH.ui;
  let c, g, halo, now; const PAD = 14;
  const stk = stick();   // ジョイスティックが使える間は記録オン（R）の間の記録（EMuJoy と同じ）
  AH.register({
    id: 'halolight', group: '時間連続・2次元', label: 'HaloLight（色の円）', model: 'series', init: { v: 5, a: 5 }, side: 'normal', get animate() { return stk.on(); },
    options: { gradient: true },
    writeMode: () => (stk.on() ? 'armed' : 'hold'), writeAxes: () => ['v', 'a'], sample: () => (stk.on() ? stk.val() : pen),
    help: '<p>右の入力面を押して動かすと、動画下部の円の色（黄＝高覚醒・快、赤＝高覚醒・不快、青＝低覚醒・不快、緑＝低覚醒・快）と濃さ（強度）が変わります。再生中に押している間だけ記録・上書きします。「グラデーション」オンで Gradient HaloLight（隣接2象限の色を混ぜる）。</p><p>ジョイスティック（ゲームパッド）をつなぐと、スティックの位置がそのまま値になり（離すと中性）、記録オン（<kbd>R</kbd> またはボタン0）の間だけ記録します。マウスもそのまま使えます（スティックを倒している間はスティックが優先）。</p>',
    mount({ panel, overlay }) {
      halo = h('div', { class: 'halo' }); overlay.appendChild(halo);
      ({ c } = planeCanvas(panel, 'HaloLight 入力面')); now = nowRow(c.parentNode);
      const o = h('div', { class: 'opts' }); toggle(o, 'gradient', 'グラデーション'); c.parentNode.appendChild(o);
      bindHold(c, e => squareVal(c, e, PAD));
    },
    resize() { g = AH.fitCanvas(c); },
    update(t) {
      if (!g) return;
      const q = drawSquareFrame(g, c, PAD, false), cur = stk.on() ? stk.shown(t) : shown(t);
      g.fillStyle = AH.isWriting() ? AH.css('--pen') : AH.css('--muted'); g.beginPath(); g.arc(q.X(cur.v), q.Y(cur.a), 4, 0, 7); g.fill();
      const col = opts().gradient ? AH.gradColor(cur.v, cur.a) : AH.quadColor(cur.v, cur.a), it = AH.intensity(cur.v, cur.a);
      // 円全体をその色で塗る。濃さ（不透明度）が強度
      halo.style.background = AH.rgba(col, it); halo.style.boxShadow = `0 0 18px 4px ${AH.rgba(col, it * 0.6)}`;
      now(cur);
    },
  });
})();
