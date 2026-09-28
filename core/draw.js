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
  // 色の設定（RCEA・HaloLight・FEELTRACE・カスタムの位置の色／画面枠の色で使う）。「設定」パネルで変えられる（core/colors.js）
  // 象限：hh＝高覚醒・快（既定 黄）、hl＝高覚醒・不快（赤）、ll＝低覚醒・不快（青）、lh＝低覚醒・快（緑）
  // 軸方向：vp＝快、ap＝覚醒、vn＝不快、an＝眠気。null は「自動」（両隣の象限の色の中間）
  const DEFAULT_QUAD = { hh: [242, 194, 48], hl: [217, 59, 48], ll: [59, 111, 217], lh: [59, 170, 92] };
  const QUAD = { ...DEFAULT_QUAD };
  const AXIS = { vp: null, ap: null, vn: null, an: null };
  const AXIS_NEIGHBORS = { vp: ['lh', 'hh'], ap: ['hh', 'hl'], vn: ['hl', 'll'], an: ['ll', 'lh'] };
  const mix = (a, b, f) => a.map((c, k) => Math.round(c + (b[k] - c) * f));
  const axisColor = k => AXIS[k] || mix(QUAD[AXIS_NEIGHBORS[k][0]], QUAD[AXIS_NEIGHBORS[k][1]], 0.5);
  function quadColor(v, a) { return QUAD[(a >= 5 ? 'h' : 'l') + (v >= 5 ? 'h' : 'l')]; }
  // 8方向（軸4＋象限4、45度ごと）の色を角度で補間する（Gradient HaloLight・FEELTRACE など）
  function gradColor(v, a) {
    const ang = (Math.atan2(a - 5, v - 5) * 180 / Math.PI + 360) % 360;   // 0=快, 90=高覚醒
    const ring = [axisColor('vp'), QUAD.hh, axisColor('ap'), QUAD.hl, axisColor('vn'), QUAD.ll, axisColor('an'), QUAD.lh];
    const i = Math.floor(ang / 45) % 8, f = (ang - i * 45) / 45;
    return mix(ring[i], ring[(i + 1) % 8], f);
  }
  const intensity = (v, a) => clamp(Math.hypot(v - 5, a - 5) / 4, 0, 1);
  const rgba = (c, al) => `rgba(${c[0]},${c[1]},${c[2]},${al})`;

  Object.assign(_, { css, fmt, fitCanvas, quadColor, gradColor, axisColor, intensity, rgba, QUAD, AXIS, DEFAULT_QUAD });
})();
