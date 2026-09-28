// 表示の小道具（色・書式・キャンバス）
(() => {
  const _ = AH._;
  const { clamp } = _;
  // ---------- 表示 ----------
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  const fmt = s => { if (!isFinite(s)) s = 0; const m = Math.floor(s / 60); return m + ':' + (s - m * 60).toFixed(2).padStart(5, '0'); };
  function fitCanvas(c) {
    const r = c.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(r.width * d)); c.height = Math.max(1, Math.round(r.height * d));
    const g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); return g;
  }
  // 象限の色（RCEA・HaloLight）：高覚醒・快=黄、高覚醒・不快=赤、低覚醒・不快=青、低覚醒・快=緑
  const QUAD = { hh: [242, 194, 48], hl: [217, 59, 48], ll: [59, 111, 217], lh: [59, 170, 92] };
  function quadColor(v, a) { return QUAD[(a >= 5 ? 'h' : 'l') + (v >= 5 ? 'h' : 'l')]; }
  // 最も近い2象限の色を角度で混ぜる（Gradient HaloLight・FEELTRACE）
  function gradColor(v, a) {
    const ang = (Math.atan2(a - 5, v - 5) * 180 / Math.PI + 360) % 360;   // 0=快, 90=高覚醒
    const cs = [[45, QUAD.hh], [135, QUAD.hl], [225, QUAD.ll], [315, QUAD.lh], [405, QUAD.hh]];
    const x = ang < 45 ? ang + 360 : ang;
    for (let i = 0; i < 4; i++) if (x >= cs[i][0] && x <= cs[i + 1][0]) {
      const f = (x - cs[i][0]) / 90;
      return cs[i][1].map((c, k) => Math.round(c + (cs[i + 1][1][k] - c) * f));
    }
    return QUAD.hh;
  }
  const intensity = (v, a) => clamp(Math.hypot(v - 5, a - 5) / 4, 0, 1);
  const rgba = (c, al) => `rgba(${c[0]},${c[1]},${c[2]},${al})`;

  Object.assign(_, { css, fmt, fitCanvas, quadColor, gradColor, intensity, rgba });
})();
