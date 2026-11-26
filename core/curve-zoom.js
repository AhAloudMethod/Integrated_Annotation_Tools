// 区間内で変化（core/curve.js）の拡大の入力欄：変化の区間を 1 つ、1 軸だけ画面いっぱいに出して、なぞって入れる。
// 評価グラフの欄は低いので、区間の中の細かい動きを入れやすくするためのもの。入れ方（描く・テンプレート）は評価グラフと同じ。
// 開く：「なぞって評価する」で変化の区間にしたとき、パネルの「拡大」（F キー）。閉じる：「閉じる」・Esc
(() => {
  const _ = AH._;
  const { FPS, S, video, binStart, nSec, r2, clamp, snapshot, pushUndo, addLog, wall, css } = _;
  const PAD_L = 56, PAD_R = 20, PAD_T = 18, PAD_B = 30;
  let root = null, cv = null, g = null, head = null, axBtns = null, proxies = null;
  let z = null;   // 開いている間：{ s（区間）, ax（軸） }
  let edit = null, playTo = null;
  let lastAx = 'v';
  const axes = () => (_.M && _.M.curveAxes ? _.M.curveAxes() : ['v', 'a']);
  const span = () => { const b0 = binStart(z.s), b1 = Math.min(_.binEnd(z.s), S.meta.duration || 0); return [b0, b1]; };
  const frameRange = () => _.curveFrames(z.s);
  function geom() {
    const w = cv.clientWidth, h = cv.clientHeight, [b0, b1] = span(), y0 = PAD_T, y1 = h - PAD_B;
    return {
      w, h, b0, b1, y0, y1,
      xOf: t => PAD_L + (t - b0) / (b1 - b0 || 1) * (w - PAD_L - PAD_R),
      tOf: x => b0 + clamp((x - PAD_L) / (w - PAD_L - PAD_R), 0, 1) * (b1 - b0),
      yOf: v => y1 - (v - 1) / 8 * (y1 - y0),
      vOf: y => clamp(1 + (y1 - y) / (y1 - y0) * 8, 1, 9),
    };
  }

  function build() {
    root = document.createElement('div'); root.id = 'curveZoom'; root.hidden = true;
    root.innerHTML = '<div class="czBar"><span class="czHead"></span><span class="czAxes"></span><span class="czTools"></span><span class="czFill"></span>'
      + '<button type="button" class="czPlay">区間を再生</button><button type="button" class="czClose">閉じる <kbd>Esc</kbd></button></div><canvas></canvas>';
    document.body.appendChild(root);
    cv = root.querySelector('canvas'); head = root.querySelector('.czHead'); axBtns = root.querySelector('.czAxes'); proxies = root.querySelector('.czTools');
    root.querySelector('.czClose').addEventListener('click', () => close());
    root.querySelector('.czPlay').addEventListener('click', e => { e.currentTarget.blur(); playSec(); });
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    window.addEventListener('resize', () => { if (z) { g = _.fitCanvas(cv); draw(); } });
    // Esc で閉じる（ほかのキーは今までどおり。D・T・Q・W・E の入れ方と形のキーも効く）
    document.addEventListener('keydown', e => {
      if (!z) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    }, true);
  }

  // 軸の切り替えのボタンと、パネルの入れ方・形・発声なしのボタンの写し（押すとパネルのボタンを押したのと同じ）
  function fillBar() {
    axBtns.innerHTML = '';
    if (axes().length > 1) for (const ax of axes()) {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.ax = ax; b.textContent = _.ax(ax).name;
      b.addEventListener('click', e => { e.currentTarget.blur(); setAx(ax); });
      axBtns.appendChild(b);
    }
    proxies.innerHTML = '';
    for (const src of document.querySelectorAll('.curveBox .tool, .curveBox .shape, .curveBox .novoice')) {
      const b = document.createElement('button'); b.type = 'button'; b.className = src.className; b.textContent = src.textContent;
      if (src.dataset.key) { b.dataset.key = src.dataset.key; b.title = src.title; }
      b.addEventListener('click', e => { e.currentTarget.blur(); target(); src.click(); });
      b._src = src; proxies.appendChild(b);
    }
  }
  const target = () => { if (z && _.M.curveSelect) _.M.curveSelect(z.s); };   // パネルのボタンとキーの対象をこの区間にする
  function setAx(ax) {
    if (!z || !axes().includes(ax)) return;
    z.ax = lastAx = ax; addLog('curve_zoom', { axis: ax, value: 'axis', detail: 'bin ' + z.s }); draw();
  }

  function open(s, ax) {
    if (!_.curveOn() || s < 0 || s >= nSec() || !axes().some(a => _.curveIsCurve(a, s))) return false;
    if (!root) build();
    const a = axes().includes(ax) ? ax : axes().includes(lastAx) ? lastAx : axes()[0];
    z = { s, ax: a }; lastAx = a;
    root.hidden = false; document.body.classList.add('czOpen');
    fillBar(); target();
    g = _.fitCanvas(cv);
    addLog('curve_zoom', { axis: a, value: 'open', detail: 'bin ' + s });
    draw(); return true;
  }
  function close() {
    if (!z) return;
    if (edit || _.curveDragging()) up();
    addLog('curve_zoom', { axis: z.ax, value: 'close', detail: 'bin ' + z.s });
    if (playTo != null) { playTo = null; video.pause(); }
    z = null; root.hidden = true; document.body.classList.remove('czOpen');
    _.refresh();
  }
  // 区間を始めから終わりまで再生し、終わりで止めて区間の始めに戻す（対象の区間のままにする）
  function playSec() {
    if (!z) return;
    const [b0, b1] = span();
    playTo = b1; _.seekTo(b0 + 0.001); video.play();
  }

  // ---------- なぞる ----------
  const tIn = t => { const [f0, f1] = frameRange(); return clamp(t, f0 / FPS, (f1 - 1) / FPS); };
  function down(e) {
    if (!z || e.button !== 0 || _.reviewing() || _.novoiceLocked(z.s) || !_.curveIsCurve(z.ax, z.s)) return;
    cv.setPointerCapture(e.pointerId);
    _.endStroke('graph'); target();
    const G = geom(), r = cv.getBoundingClientRect(), t = tIn(G.tOf(e.clientX - r.left)), v = G.vOf(e.clientY - r.top);
    addLog('graph_down', { axis: z.ax, detail: 't=' + t.toFixed(4) + ' zoom' });
    if (_.curveDown(z.ax, t, v)) return;   // テンプレート：押した高さ→離した高さの曲線（core/curve.js）
    edit = { ax: z.ax, before: snapshot(), samples: new Map(), lastF: null, lastV: null, wall0: wall() };
    drawAt(e);
  }
  function drawAt(e) {
    const G = geom(), r = cv.getBoundingClientRect(), [f0, f1] = frameRange();
    const f = clamp(Math.round(G.tOf(e.clientX - r.left) * FPS), f0, f1 - 1), v = r2(G.vOf(e.clientY - r.top));
    if (edit.lastF != null) { const d = f - edit.lastF, v0 = edit.lastV; for (let k = 1; k < Math.abs(d); k++) edit.samples.set(edit.lastF + Math.sign(d) * k, r2(v0 + (v - v0) * k / Math.abs(d))); }
    edit.samples.set(f, v); edit.lastF = f; edit.lastV = v;
    S.data.points[edit.ax] = _.rewriteFrames(edit.before.points[edit.ax], new Map([...edit.samples].sort((a, b) => a[0] - b[0])));
    _.refresh();
  }
  function move(e) {
    if (!z) return;
    if (_.curveDragging()) { const r = cv.getBoundingClientRect(); _.curveMove(geom().vOf(e.clientY - r.top)); return; }
    if (edit) drawAt(e);
  }
  function up() {
    if (_.curveDragging()) { _.curveUp(); return; }
    const e = edit; edit = null; if (!e || !e.samples.size) return;
    pushUndo(e.before);
    const fs = [...e.samples.keys()].sort((a, b) => a - b), ax = e.ax;
    S.data.strokes.push({ id: S.data.strokes.length, source: 'graph', axes: ax, t_start: fs[0] / FPS, t_end: fs[fs.length - 1] / FPS, end_reason: 'graph_zoom', wall_ms_start: e.wall0, wall_ms_end: wall(),
      samples: fs.map(f => [+(f / FPS).toFixed(4), ax === 'v' ? e.samples.get(f) : '', ax === 'a' ? e.samples.get(f) : '']) });
    addLog('graph_draw', { axis: ax, detail: `${(fs[0] / FPS).toFixed(3)}-${(fs[fs.length - 1] / FPS).toFixed(3)} zoom` });
    _.curveTrim(ax, fs[0] / FPS, (fs[fs.length - 1] + 1) / FPS);   // 描き直した範囲は形の記録から外す
    _.refresh();
  }

  // ---------- 描く（refresh のたびに core/timeline.js から呼ぶ） ----------
  function draw() {
    if (!z) return;
    if (!axes().some(a => _.curveIsCurve(a, z.s)) || z.s >= nSec()) { close(); return; }   // 一定に戻した・区切りが消えたなど
    if (playTo != null && (video.paused || video.currentTime >= playTo - 1 / FPS)) { const b0 = binStart(z.s); playTo = null; video.pause(); _.seekTo(b0 + 0.001); target(); }
    if (!g) return;
    const G = geom(), { w, h, b0, b1, y0, y1, xOf, yOf } = G, ax = z.ax, L = _.ax(ax), col = css(ax === 'v' ? '--axv' : '--axa');
    head.textContent = '対象：' + _.secLabel(z.s) + '　' + L.name + (_.curveIsCurve(ax, z.s) ? '' : '（この軸は普通のセル）');
    for (const b of axBtns.children) b.classList.toggle('on', b.dataset.ax === ax);
    for (const b of proxies.children) b.classList.toggle('on', b._src.classList.contains('on'));
    g.clearRect(0, 0, w, h);
    g.font = '13px system-ui, sans-serif';
    // 発声の区間（core/voiced.js）
    if (_.voicedShown()) {
      g.fillStyle = css('--f0'); g.globalAlpha = 0.13;
      for (const [t0, t1] of _.voicedSpans()) if (t1 > b0 && t0 < b1) g.fillRect(xOf(Math.max(t0, b0)), y0, xOf(Math.min(t1, b1)) - xOf(Math.max(t0, b0)), y1 - y0);
      g.globalAlpha = 1;
    }
    // 1〜9 の目盛り（5 は実線）と軸の名前
    for (let k = 1; k <= 9; k++) {
      g.strokeStyle = css('--line'); g.lineWidth = k === 5 ? 1.5 : 1; g.setLineDash(k === 5 ? [] : [3, 4]);
      g.beginPath(); g.moveTo(PAD_L, yOf(k)); g.lineTo(w - PAD_R, yOf(k)); g.stroke();
      g.fillStyle = css('--muted'); g.textAlign = 'right'; g.fillText(String(k), PAD_L - 8, yOf(k) + 4);
    }
    g.setLineDash([]); g.textAlign = 'left';
    g.fillText(L.hi, 4, y0 + 4); g.fillText(L.lo, 4, y1 + 4);
    g.strokeStyle = css('--line'); g.strokeRect(PAD_L, y0, w - PAD_L - PAD_R, y1 - y0);
    // 時刻の目盛り
    const step = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5].find(st => st * (w - PAD_L - PAD_R) / (b1 - b0 || 1) >= 70) || 5;
    g.fillStyle = css('--muted'); g.textAlign = 'center';
    for (let k = Math.ceil(b0 / step - 1e-9); k * step <= b1 + 1e-9; k++) g.fillText((k * step).toFixed(step < 1 ? 2 : 0) + 's', xOf(k * step), h - 10);
    g.textAlign = 'left';
    // 値の線（0 は発声なしの灰色の帯）
    if (_.curveIsCurve(ax, z.s)) {
      const ps = S.data.points[ax], segs = []; let t = b0, v = _.valueIn(ps, b0);
      for (const p of ps) if (p.t > b0 + 1e-4 && p.t < b1 - 1e-6) { segs.push([t, p.t, v]); t = p.t; v = p.val; }
      segs.push([t, b1, v]);
      g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); let on = false;
      for (const [t0, t1, val] of segs) {
        if (val === 0) { g.save(); g.fillStyle = css('--muted'); g.globalAlpha = 0.25; g.fillRect(xOf(t0), y0, xOf(t1) - xOf(t0), y1 - y0); g.restore(); on = false; continue; }
        if (!on) { g.moveTo(xOf(t0), yOf(val)); on = true; } else g.lineTo(xOf(t0), yOf(val));
        g.lineTo(xOf(t1), yOf(val));
      }
      g.stroke();
    }
    // 再生位置（区間の中にあるとき）
    const ct = video.currentTime || 0;
    if (ct >= b0 && ct <= b1) { g.strokeStyle = css('--head'); g.lineWidth = 1.5; g.beginPath(); g.moveTo(xOf(ct), y0); g.lineTo(xOf(ct), y1); g.stroke(); }
  }

  // F キー（modes/custom.js）・パネルの「拡大」：対象の区間を開く。開いていれば閉じる
  const toggle = (s, ax) => (z ? (close(), true) : open(s, ax));
  Object.assign(_, { curveZoomOpen: open, curveZoomClose: close, curveZoomToggle: toggle, curveZoomDraw: draw, curveZoomState: () => (z ? { ...z } : null), curveZoomSetAxis: setAx });
})();
