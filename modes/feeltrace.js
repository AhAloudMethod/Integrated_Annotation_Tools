// ---- FEELTRACE（円形・位置の色・感情語・縮む円の軌跡） ----
(() => {
  const { pen } = AH;
  const { shown, nowRow, circleVal, bindHold, planeCanvas, trail, stick, gridCircle } = AH.ui;
  let c, g, now; const PAD = 30;
  const stk = stick(true);   // 円の外は円周に吸着
  // 感情語の目印（角度: 0=快, 90=高覚醒）。原典の英語の語と配置は論文系/FEELTRACE の図で要確認
  const WORDS = [[20, '喜び'], [55, '興奮'], [100, '驚き'], [125, '恐れ'], [145, '怒り'], [165, '苛立ち'],
                 [200, '悲しみ'], [225, '憂鬱'], [250, '退屈'], [295, '穏やか'], [320, 'くつろぎ'], [340, '満足']];
  AH.register({
    vaOnly: true,   // 絵・感情語が VA 前提なので、評価の軸の組にかかわらず VA（core/axes.js）
    id: 'feeltrace', group: '時間連続・2次元', label: 'FEELTRACE（マウス・円形）', model: 'series', init: { v: 5, a: 5 }, side: 'wide', get animate() { return stk.on(); },
    writeMode: () => (stk.on() ? 'armed' : 'hold'), writeAxes: () => ['v', 'a'], sample: () => (stk.on() ? stk.val() : pen),
    help: '<p>中央が中性、円周が最大強度です。再生中に円の中でボタンを押している間だけ記録・上書きします。円の外に出たカーソルは円周に吸着します。</p><p>ジョイスティック（ゲームパッド）をつなぐと、スティックの位置がそのまま値になり（離すと中性）、記録オン（<kbd>R</kbd> またはボタン0）の間だけ記録します。マウスもそのまま使えます（スティックを倒している間はスティックが優先）。スティックも円の外は円周に吸着します。</p>',
    mount({ panel }) {
      ({ c } = planeCanvas(panel, 'FEELTRACE の円')); now = nowRow(c.parentNode);
      bindHold(c, e => circleVal(c, e, PAD));
    },
    resize() { g = AH.fitCanvas(c); },
    update(t) {
      if (!g) return;
      const w = c.clientWidth, R = (w - PAD * 2) / 2, cx = PAD + R, cy = PAD + R;
      const X = v => cx + (v - 5) / 4 * R, Y = a => cy - (a - 5) / 4 * R;
      g.clearRect(0, 0, w, w);
      g.strokeStyle = AH.css('--line'); g.lineWidth = 1;
      g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
      g.setLineDash([3, 3]); g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke(); g.setLineDash([]);
      gridCircle(g, cx, cy, R);
      g.fillStyle = AH.css('--muted'); g.font = '11px system-ui, sans-serif'; g.textAlign = 'center';
      g.fillText('とても活発', cx, cy - R - 8); g.fillText('とても不活発', cx, cy + R + 16);
      g.save(); g.translate(cx + R + 12, cy); g.rotate(Math.PI / 2); g.fillText('とてもポジティブ', 0, 0); g.restore();
      g.save(); g.translate(cx - R - 12, cy); g.rotate(-Math.PI / 2); g.fillText('とてもネガティブ', 0, 0); g.restore();
      for (const [deg, wd] of WORDS) { const r = deg * Math.PI / 180; g.fillText(wd, cx + Math.cos(r) * R * 0.72, cy - Math.sin(r) * R * 0.72 + 4); }
      g.textAlign = 'left';
      const cur = stk.on() ? stk.shown(t) : shown(t);
      for (const p of trail(t, 2, 8, cur)) {   // 過去の位置を縮む円で
        const col = AH.gradColor(p.v, p.a), al = 0.25 + 0.75 * AH.intensity(p.v, p.a);
        g.fillStyle = AH.rgba(col, p.age ? 0.5 * al * (1 - p.age) : al);
        g.beginPath(); g.arc(X(p.v), Y(p.a), p.age ? 9 * (1 - p.age) + 2 : 10, 0, 7); g.fill();
      }
      if (AH.isWriting()) { g.strokeStyle = AH.css('--pen'); g.lineWidth = 2; g.beginPath(); g.arc(X(cur.v), Y(cur.a), 12, 0, 7); g.stroke(); }
      now(cur);
    },
  });
})();
