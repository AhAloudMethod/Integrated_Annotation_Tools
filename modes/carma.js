// ---- CARMA（1次元スライダー） ----
(() => {
  const { video } = AH;
  const { opts, follower, h, heldRate, passSelector } = AH.ui;
  const follow = follower();
  let c, g; let ctrl = 5, drag = false; const RATE = 4;
  const k = heldRate(['ArrowUp'], ['ArrowDown']);
  const ax = () => opts().axis || 'v';
  const setFromY = e => { const r = c.getBoundingClientRect(), y0 = 30, y1 = r.height - 30; ctrl = AH.r2(AH.clamp(1 + (1 - (e.clientY - r.top - y0) / (y1 - y0)) * 8, 1, 9)); };
  AH.register({
    id: 'carma', group: '時間連続・1次元', label: 'CARMA（1次元スライダー・2回）', model: 'series', init: { v: 5, a: 5 }, side: 'normal', animate: true,
    options: { axis: 'v' },
    writeMode: () => 'armed', writeAxes: () => [ax()], sample: () => ({ [ax()]: ctrl }), peek: () => ({ [ax()]: ctrl }),
    help: '<p>快度と覚醒度を1軸ずつ、2回に分けて評価します（右の「評価する軸」で切り替え）。スライダーをマウスでドラッグするか <kbd>↑</kbd>/<kbd>↓</kbd> で動かします。記録オン（<kbd>R</kbd>）の間、再生中の値を記録・上書きします。</p>',
    mount({ panel }) {
      const box = h('div', { class: 'planeBox' }); passSelector(box);
      c = h('canvas', { class: 'bars', 'aria-label': 'CARMA スライダー' }); box.appendChild(c); panel.appendChild(box);
      c.addEventListener('pointerdown', e => { drag = true; follow.touch(); c.setPointerCapture(e.pointerId); setFromY(e); });
      c.addEventListener('pointermove', e => { if (drag) setFromY(e); });
      c.addEventListener('pointerup', () => { drag = false; });
    },
    resize() { g = AH.fitCanvas(c); },
    tick(dt) {
      if (follow() && !drag) ctrl = AH.valueAt(ax(), video.currentTime);
      if (k.any()) { follow.touch(); ctrl = AH.r2(AH.clamp(ctrl + k.dir() * RATE * dt, 1, 9)); }
    },
    onKey(e) { return k.key(e, true); },
    onKeyUp(e) { k.key(e, false); }, onBlur() { k.clear(); },
    update() {
      if (!g) return;
      const w = c.clientWidth, H = c.clientHeight, x = w / 2, y0 = 30, y1 = H - 30, Y = v => y1 - (v - 1) / 8 * (y1 - y0);
      const isV = ax() === 'v', col = AH.css(isV ? '--val' : '--aro');
      g.clearRect(0, 0, w, H); g.font = '11px system-ui, sans-serif'; g.textAlign = 'center'; g.fillStyle = AH.css('--muted');
      g.fillText(isV ? '快' : '覚醒', x, 18); g.fillText(isV ? '不快' : '眠気', x, H - 8);
      g.strokeStyle = AH.css('--line'); g.lineWidth = 6; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke();
      g.lineWidth = 1; g.textAlign = 'right';
      for (let i = 1; i <= 9; i++) { g.beginPath(); g.moveTo(x - 14, Y(i)); g.lineTo(x - 6, Y(i)); g.stroke(); g.fillText(i, x - 18, Y(i) + 4); }
      g.fillStyle = AH.isWriting() ? AH.css('--pen') : col; g.fillRect(x - 20, Y(ctrl) - 6, 40, 12);
      g.fillStyle = AH.css('--ink'); g.textAlign = 'left'; g.font = '600 14px system-ui, sans-serif'; g.fillText(ctrl.toFixed(2), x + 26, Y(ctrl) + 5);
    },
  });
})();
