// ---- Full Throttle の操作（快度・覚醒度を両手で1軸ずつ） ----
(() => {
  const { video } = AH;
  const { follower, h, stored, heldRate, sliders, gridBar } = AH.ui;
  const follow = follower();
  let c, g; const ctrl = { v: 5, a: 5 }; const RATE = 4;
  const kv = heldRate(['KeyW'], ['KeyS']), ka = heldRate(['ArrowUp'], ['ArrowDown']);
  const sl = sliders();   // 1本目＝横軸、2本目＝縦軸（位置がそのまま値）
  const withPad = () => ({ ...ctrl, ...(sl.owned() ? { pad: 'slider' } : {}) });
  AH.register({
    id: 'throttle', group: '時間連続・2次元', label: 'スロットル操作（両手・1軸ずつ）', model: 'series', init: { v: 5, a: 5 }, side: 'normal', animate: true,
    writeMode: () => 'armed', writeAxes: () => ['v', 'a'], sample: withPad, peek: () => ({ ...ctrl }),
    // 記録オンにした瞬間は、記録オフで動かした位置から始める
    help: '<p>左手 <kbd>W</kbd>/<kbd>S</kbd> で快度、右手 <kbd>↑</kbd>/<kbd>↓</kbd> で覚醒度のレバーを上下します（押している間動き、離すとその位置に留まります）。スライダーの機器（ゲームパッドの軸2・3）をつなぐと、1本目＝快度、2本目＝覚醒度の位置がそのまま値になります（最後に動かしたほうが優先：スライダーを動かすとスライダーの位置、キーを押すとキーで動かせます）。記録オン（<kbd>R</kbd> またはボタン0）の間、再生中の値を記録・上書きします。</p>',
    mount({ panel }) { const box = h('div', { class: 'planeBox' }); c = h('canvas', { class: 'bars', 'aria-label': 'スロットル' }); box.appendChild(c); panel.appendChild(box); },
    resize() { g = AH.fitCanvas(c); },
    tick(dt) {
      if (follow()) { Object.assign(ctrl, stored(video.currentTime)); sl.release(); }   // 追従に戻ったらスライダーを手放す
      const dv = kv.dir(), da = ka.dir();
      if (dv) sl.release(0); if (da) sl.release(1);   // キーを押したらキーが優先
      if (dv || da) follow.touch();
      ctrl.v = AH.r2(AH.clamp(ctrl.v + dv * RATE * dt, 1, 9)); ctrl.a = AH.r2(AH.clamp(ctrl.a + da * RATE * dt, 1, 9));
      const s0 = sl.get(0), s1 = sl.get(1);   // スライダーを動かしたら、その位置がそのまま値
      if (s0 != null) ctrl.v = s0; if (s1 != null) ctrl.a = s1;
      if (sl.owned()) follow.touch();
    },
    onKey(e) { return kv.key(e, true) || ka.key(e, true); },
    onKeyUp(e) { kv.key(e, false); ka.key(e, false); },
    onBlur() { kv.clear(); ka.clear(); },
    update() {
      if (!g) return;
      const w = c.clientWidth, H = c.clientHeight; g.clearRect(0, 0, w, H);
      const V = AH.ax('v'), A = AH.ax('a');
      const bars = [[V.name, sl.owned(0) ? 'スライダー1' : 'W / S', ctrl.v, AH.css('--val'), V.hi, V.lo], [A.name, sl.owned(1) ? 'スライダー2' : '↑ / ↓', ctrl.a, AH.css('--aro'), A.hi, A.lo]];
      bars.forEach(([name, keys, val, col, hi, lo], i) => {
        const x = w * (i ? 0.72 : 0.28), y0 = 34, y1 = H - 40, Y = v => y1 - (v - 1) / 8 * (y1 - y0);
        g.fillStyle = AH.css('--muted'); g.font = '12px system-ui, sans-serif'; g.textAlign = 'center';
        g.fillText(name, x, 14); g.fillText(keys, x, H - 8); g.font = '10px system-ui, sans-serif'; g.fillText(hi, x, 28); g.fillText(lo, x, H - 24);
        gridBar(g, x, Y);
        g.strokeStyle = AH.css('--line'); g.lineWidth = 8; g.lineCap = 'round'; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke();
        g.strokeStyle = col; g.beginPath(); g.moveTo(x, Y(5)); g.lineTo(x, Y(val)); g.stroke(); g.lineCap = 'butt';
        g.fillStyle = AH.isWriting() ? AH.css('--pen') : col; g.fillRect(x - 22, Y(val) - 5, 44, 10);
        g.fillStyle = AH.css('--ink'); g.font = '600 14px system-ui, sans-serif'; g.fillText(val.toFixed(2), x + (i ? 50 : -50), Y(val) + 5);
      });
      g.textAlign = 'left';
    },
  });
})();
