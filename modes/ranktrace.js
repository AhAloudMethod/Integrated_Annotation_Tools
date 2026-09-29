// ---- RankTrace（1次元・上下限なし・ホイール・過去の軌跡全体を表示） ----
(() => {
  const { S, video } = AH;
  const { opts, follower, h, heldRate, passSelector } = AH.ui;
  const follow = follower();
  let c, g; let ctrl = 0;
  const k = heldRate(['ArrowUp'], ['ArrowDown']);
  const ax = () => opts().axis || 'v';
  AH.register({
    id: 'ranktrace', group: '時間連続・1次元', label: 'RankTrace（ホイール・上下限なし・2回）', model: 'series', init: { v: 0, a: 0 }, unbounded: true, side: 'wide', animate: true,
    options: { axis: 'v' },
    writeMode: () => 'armed', writeAxes: () => [ax()], sample: () => ({ [ax()]: ctrl }), peek: () => ({ [ax()]: ctrl }),
    help: '<p>快度と覚醒度を1軸ずつ、2回に分けて評価します。マウスホイール（または <kbd>↑</kbd>/<kbd>↓</kbd>）で「さっきより上がった／下がった」を入力します。上限・下限はなく、数値は表示しません。これまでの軌跡全体を見ながら相対的に判断してください。記録オン（<kbd>R</kbd>）の間、再生中の値を記録・上書きします。</p>',
    mount({ panel }) {
      const box = h('div', { class: 'planeBox' }); passSelector(box);
      c = h('canvas', { class: 'trace', 'aria-label': 'RankTrace の軌跡。ホイールで入力' }); box.appendChild(c); panel.appendChild(box);
      c.addEventListener('wheel', e => {
        e.preventDefault();
        follow.touch();
        ctrl = AH.r2(ctrl - Math.sign(e.deltaY) * Math.min(3, Math.abs(e.deltaY) / 100) * 0.5);
      }, { passive: false });
    },
    resize() { g = AH.fitCanvas(c); },
    tick(dt) {
      if (follow()) ctrl = AH.valueAt(ax(), video.currentTime);
      if (k.any()) { follow.touch(); ctrl = AH.r2(ctrl + k.dir() * 2 * dt); }
    },
    onKey(e) { return k.key(e, true); },
    onKeyUp(e) { k.key(e, false); }, onBlur() { k.clear(); },
    update(t) {
      if (!g) return;
      const w = c.clientWidth, H = c.clientHeight, D = S.meta.duration || 1, P = 12;
      const ps = S.data.points[ax()].filter(p => p.t <= t + 1e-9);
      const vs = [...ps.map(p => p.val), ctrl]; const lo = Math.min(...vs) - 1, hi = Math.max(...vs) + 1;
      const X = tt => P + tt / D * (w - 2 * P), Y = v => H - P - (v - lo) / (hi - lo) * (H - 2 * P);
      g.clearRect(0, 0, w, H);
      g.strokeStyle = AH.css('--line'); g.strokeRect(P, P, w - 2 * P, H - 2 * P);
      g.strokeStyle = AH.css(ax() === 'v' ? '--val' : '--aro'); g.lineWidth = 2; g.beginPath();
      ps.forEach((p, i) => { const nx = i + 1 < ps.length ? ps[i + 1].t : t; if (!i) g.moveTo(X(p.t), Y(p.val)); else g.lineTo(X(p.t), Y(p.val)); g.lineTo(X(nx), Y(p.val)); });
      g.stroke();
      g.fillStyle = AH.isWriting() ? AH.css('--pen') : AH.css('--ink'); g.beginPath(); g.arc(X(t), Y(ctrl), 5, 0, 7); g.fill();
      g.fillStyle = AH.css('--muted'); g.font = '11px system-ui, sans-serif'; g.fillText(AH.ax(ax()).name + '（相対）', P + 4, P + 14);
    },
  });
})();
