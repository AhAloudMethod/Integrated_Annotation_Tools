// タイムライン（シーク＋グラフ直接編集）と画面の再描画（refresh）
(() => {
  const _ = AH._;
  const { FPS, $, video, tl, tctx, S, model, isInt, wall, r2, clamp, addLog, snapshot, pushUndo, css, fmt, RG, nSec, binStart, rangeEnd, binAt, inRange, valueIn, endStroke, writeMode } = _;
  // ---------- タイムライン（シーク＋直接編集） ----------
  const PAD_L = 44, PAD_R = 8, RULER = 18;   // 下端 RULER px はシーク用の目盛り帯
  function geom() {
    const w = tl.clientWidth, h = tl.clientHeight, D = S.meta.duration;
    const xOf = t => PAD_L + (D ? t / D : 0) * (w - PAD_L - PAD_R);
    const tOf = x => clamp((x - PAD_L) / (w - PAD_L - PAD_R), 0, 1) * D;
    // F0 を表示するときは、下に F0 の欄（FH px）を足す
    const FH = _.f0Shown && _.f0Shown() && video.src ? 56 : 0, H2 = h - RULER - FH;
    const lanes = [{ ax: 'v', name: _.ax('v').short, col: css('--val'), y0: 8, y1: H2 / 2 - 8 },
                   { ax: 'a', name: _.ax('a').short, col: css('--aro'), y0: H2 / 2 + 8, y1: H2 - 8 }];
    const f0Lane = FH ? { y0: H2 + 8, y1: h - RULER - 4, top: H2 } : null;
    for (const L of lanes) {
      L.lo = 1; L.hi = 9;
      if (_.M && _.M.unbounded && S.data) { const vs = S.data.points[L.ax].map(p => p.val); L.lo = Math.min(...vs) - 1; L.hi = Math.max(...vs) + 1; }
      L.yOf = v => L.y1 - (v - L.lo) / (L.hi - L.lo) * (L.y1 - L.y0);
      L.vOf = y => L.lo + (L.y1 - y) / (L.y1 - L.y0) * (L.hi - L.lo);
    }
    return { w, h, D, xOf, tOf, lanes, f0Lane };
  }

  function drawTimeline() {
    const g = tctx, G = geom(), { w, h, D, xOf } = G;
    g.clearRect(0, 0, w, h);
    g.font = '11px system-ui, sans-serif';
    if (D) {
      // 評価区間の外を薄く塗る
      g.fillStyle = css('--grid'); g.globalAlpha = 0.6;
      if (RG().start > 0) g.fillRect(PAD_L, 0, xOf(Math.min(RG().start, D)) - PAD_L, h - RULER);
      if (rangeEnd() < D) g.fillRect(xOf(rangeEnd()), 0, xOf(D) - xOf(rangeEnd()), h - RULER);
      g.globalAlpha = 1;
      // 区間の境界（評価区間に合わせた格子）と動画時刻の目盛り
      for (let s = 0; s <= nSec(); s++) {
        const x = xOf(binStart(s)); if (binStart(s) > D + 1e-6) break;
        g.strokeStyle = css('--grid'); g.lineWidth = s % 5 === 0 ? 1.2 : 0.6;
        g.beginPath(); g.moveTo(x, 4); g.lineTo(x, h - RULER); g.stroke();
      }
      g.fillStyle = css('--bg'); g.fillRect(PAD_L, h - RULER, w - PAD_L - PAD_R, RULER);
      g.fillStyle = css('--muted');
      for (let t = 0; t <= D; t += 5) g.fillText(t + 's', xOf(t) + 2, h - 5);
    }
    // 快度と覚醒度の欄の区切り線
    const yDiv = Math.round((G.lanes[0].y1 + G.lanes[1].y0) / 2) + 0.5;
    g.strokeStyle = css('--pen'); g.lineWidth = 1.5;   // 赤
    g.beginPath(); g.moveTo(0, yDiv); g.lineTo(w, yDiv); g.stroke();
    for (const L of G.lanes) {
      g.fillStyle = css('--muted'); g.fillText(L.name, 2, L.y0 + 10);
      if (!(_.M && _.M.unbounded)) {
        g.fillText('5', PAD_L - 12, L.yOf(5) + 4);
        g.strokeStyle = css('--line'); g.lineWidth = 1;   // 中立（5）の線は実線
        g.beginPath(); g.moveTo(PAD_L, L.yOf(5)); g.lineTo(w - PAD_R, L.yOf(5)); g.stroke();
      }
      if (!D || !S.data) continue;
      g.strokeStyle = L.col; g.fillStyle = L.col; g.lineWidth = 2;
      if (model() === 'series') {
        const ps = S.data.points[L.ax];
        g.beginPath();
        ps.forEach((p, i) => {
          const y = L.yOf(p.val);
          if (i === 0) g.moveTo(xOf(p.t), y); else g.lineTo(xOf(p.t), y);
          const nx = i + 1 < ps.length ? xOf(ps[i + 1].t) : xOf(D);
          g.lineTo(nx, y); if (i + 1 < ps.length) g.lineTo(nx, L.yOf(ps[i + 1].val));
        });
        g.stroke();
        if (isInt() && ps.length < 400) for (const p of ps) if (!p.init) { g.beginPath(); g.arc(xOf(p.t), L.yOf(p.val), 2.5, 0, 7); g.fill(); }
      } else if (model() === 'table') {
        const c = S.data.cells[L.ax];
        for (let s = 0; s < nSec(); s++) if (c[s] != null) g.fillRect(xOf(binStart(s)) + 1, L.yOf(c[s]) - 1.5, xOf(Math.min(binStart(s + 1), D)) - xOf(binStart(s)) - 2, 3);
      } else if (model() === 'events') {
        const mid = (L.y0 + L.y1) / 2;
        for (const e of S.data.events) {
          if (!e.dv && !e.da) { g.fillRect(xOf(e.t) - 1, L.y0 + 2, 2, L.y1 - L.y0 - 4); continue; }   // 方向のない変化（変化ボタン）は縦線
          const d = L.ax === 'v' ? e.dv : e.da; if (!d) continue;
          const x = xOf(e.t), y = mid - d * 10;
          g.beginPath(); g.moveTo(x, y - d * 6); g.lineTo(x - 5, y + d * 2); g.lineTo(x + 5, y + d * 2); g.closePath(); g.fill();
        }
      }
    }
    if (D && G.f0Lane) drawF0(g, G);
    if (D) {
      if (_.stroke) {
        g.fillStyle = css('--pen'); g.globalAlpha = 0.15;
        g.fillRect(xOf(_.stroke.t0), 2, Math.max(1, xOf(_.stroke.lastT) - xOf(_.stroke.t0)), h - RULER - 2); g.globalAlpha = 1;
      }
      const x = xOf(video.currentTime);
      g.strokeStyle = _.stroke ? css('--pen') : css('--head'); g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x, 2); g.lineTo(x, h); g.stroke();
    }
  }

  // F0 の欄：声ありの区間を線でつなぐ（縦軸は対数。範囲はその動画の F0 の分布から）
  function drawF0(g, G) {
    const { w, xOf, f0Lane: L } = G, F = _.F0;
    g.strokeStyle = css('--line'); g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, Math.round(L.top) + 0.5); g.lineTo(w, Math.round(L.top) + 0.5); g.stroke();
    g.fillStyle = css('--muted'); g.fillText('F0', 2, L.y0 + 10);
    if (F.status !== 'ready') { g.fillText(F.status === 'loading' ? '計算中…' : F.status === 'error' ? '読み込めませんでした' : '', PAD_L + 6, L.y0 + 22); return; }
    const lo = Math.log(F.lo), span = Math.log(F.hi) - lo, yOf = f => L.y1 - (Math.log(f) - lo) / span * (L.y1 - L.y0);
    g.font = '10px system-ui, sans-serif';
    g.fillText(Math.round(F.hi) + 'Hz', 2, L.y0 + 22); g.fillText(Math.round(F.lo), 2, L.y1);
    g.font = '11px system-ui, sans-serif';
    g.strokeStyle = css('--f0'); g.lineWidth = 1.5; g.beginPath();
    let pen = false; const off = 0.02;   // 窓の中心の時刻
    for (let k = 0; k < F.f0.length; k++) {
      const f = F.f0[k];
      if (!(f > 0)) { pen = false; continue; }
      const x = xOf(k * F.hop + off), y = Math.max(L.y0, Math.min(L.y1, yOf(f)));
      if (pen) g.lineTo(x, y); else { g.moveTo(x, y); pen = true; }
    }
    g.stroke();
    const now = _.f0At(video.currentTime || 0);
    if (now > 0) { g.fillStyle = css('--f0'); g.beginPath(); g.arc(xOf(video.currentTime), Math.max(L.y0, Math.min(L.y1, yOf(now))), 3.5, 0, 7); g.fill(); }
  }

  // グラフ直接編集：連続方式はなぞった範囲の値を描き換え、区間方式は区間の値を設定する
  let edit = null, seeking = false;
  const graphEditable = () => $('graphEdit').checked && model() !== 'events' && !!video.src && !_.reviewing();
  function editRebuild() {
    const e = edit, ax = e.axis, fs = [...e.samples.keys()].sort((a, b) => a - b);
    const fmin = fs[0], fmax = fs[fs.length - 1], tmin = fmin / FPS, tmax = (fmax + 1) / FPS;
    const src = e.before.points[ax], old = valueIn(src, tmax);
    const init = { ...src[0] };
    const keep = src.filter(p => !p.init && (p.t < tmin - 1e-9 || p.t >= tmax - 1e-9)).map(p => ({ ...p }));
    const ins = [];
    let last = fmin === 0 ? null : valueIn(src, tmin - 1e-6);
    for (let f = fmin; f <= fmax; f++) {
      const v = e.samples.get(f); if (v === undefined || v === last) continue;
      if (f === 0) init.val = v; else ins.push({ t: +(f / FPS).toFixed(4), val: v });
      last = v;
    }
    // なぞった範囲の直後は編集前の値に戻す
    if (tmax < S.meta.duration && last !== old && !keep.some(p => Math.abs(p.t - tmax) < 1e-9)) ins.push({ t: +tmax.toFixed(4), val: old });
    S.data.points[ax] = [init, ...[...keep, ...ins].sort((a, b) => a.t - b.t)];
  }
  function editAt(ev) {
    const r = tl.getBoundingClientRect(), G = geom(), L = G.lanes.find(l => l.ax === edit.axis);
    const t = G.tOf(ev.clientX - r.left);
    let v = L.vOf(clamp(ev.clientY - r.top, L.y0, L.y1));
    if (!(_.M && _.M.unbounded)) v = clamp(v, 1, 9);
    v = isInt() ? Math.round(v) : r2(v);
    if (model() === 'table') {
      const s = binAt(t); if (s < 0 || s >= nSec()) return;
      if (S.data.cells[edit.axis][s] !== v) { if (!edit.changed) pushUndo(edit.before); edit.changed = true; S.data.cells[edit.axis][s] = v; edit.bins.add(s); }
    } else {
      const f = Math.round(t * FPS);
      if (edit.lastF != null) { const d = f - edit.lastF, v0 = edit.lastV; for (let k = 1; k < Math.abs(d); k++) { const ff = edit.lastF + Math.sign(d) * k, vv = v0 + (v - v0) * k / Math.abs(d); edit.samples.set(ff, isInt() ? Math.round(vv) : r2(vv)); } }
      edit.samples.set(f, v); edit.lastF = f; edit.lastV = v; edit.changed = true;
      editRebuild();
    }
    refresh();
  }
  tl.addEventListener('pointerdown', e => {
    if (!S.meta.duration) return;
    const r = tl.getBoundingClientRect(), y = e.clientY - r.top;
    tl.setPointerCapture(e.pointerId);
    const Gd = geom();
    if (y >= r.height - RULER || !graphEditable() || (Gd.f0Lane && y >= Gd.f0Lane.top)) { seeking = true; _.seekTo(geom().tOf(e.clientX - r.left)); return; }
    endStroke('graph');
    const G = geom(), axis = y < (G.lanes[0].y1 + G.lanes[1].y0) / 2 ? 'v' : 'a';
    edit = { axis, before: snapshot(), samples: new Map(), lastF: null, lastV: null, changed: false, bins: new Set() };
    editAt(e);
  });
  tl.addEventListener('pointermove', e => {
    if (seeking) { const r = tl.getBoundingClientRect(); _.seekTo(geom().tOf(e.clientX - r.left)); }
    else if (edit) editAt(e);
    else if (S.meta.duration) {
      const r = tl.getBoundingClientRect();
      tl.style.cursor = (e.clientY - r.top >= r.height - RULER || !graphEditable()) ? 'pointer' : 'crosshair';
    }
  });
  const tlUp = () => {
    seeking = false;
    if (!edit) return;
    const e = edit; edit = null;
    if (e.changed) {
      if (model() === 'series') {
        pushUndo(e.before);
        const fs = [...e.samples.keys()].sort((a, b) => a - b);
        S.data.strokes.push({ id: S.data.strokes.length, source: 'graph', axes: e.axis, t_start: fs[0] / FPS, t_end: fs[fs.length - 1] / FPS, end_reason: 'graph', wall_ms_end: wall(),
          samples: fs.map(f => [+(f / FPS).toFixed(4), e.axis === 'v' ? e.samples.get(f) : '', e.axis === 'a' ? e.samples.get(f) : '']) });
        addLog('graph_draw', { axis: e.axis, detail: `${(fs[0] / FPS).toFixed(3)}-${(fs[fs.length - 1] / FPS).toFixed(3)}` });
      } else addLog('graph_cells', { axis: e.axis, detail: 'bins ' + [...e.bins].sort((a, b) => a - b).join(' ') });
    }
    refresh();
  };
  tl.addEventListener('pointerup', tlUp); tl.addEventListener('pointercancel', tlUp);

  function refresh() {
    const t = video.currentTime || 0;
    if (_.renderF0) _.renderF0();
    $('clock').textContent = fmt(t) + ' / ' + fmt(S.meta.duration) + (S.meta.duration && !inRange(t) ? '（評価区間外）' : '');
    $('playBtn').textContent = video.paused ? '再生' : '停止';
    $('playBtn').dataset.rate = video.playbackRate !== 1 ? '×' + video.playbackRate : '';   // 1 以外の再生速度はボタンの角に出す
    $('armBox').hidden = writeMode() !== 'armed' || _.listenUsable();
    _.listenStatus();
    $('armBtn').textContent = S.armed ? '● 記録中' : '記録 R';
    $('armBtn').classList.toggle('on', S.armed);
    if (_.M && S.data) {
      let st = '';
      if (model() === 'series') st = `書き込み ${S.data.strokes.length} 回`;
      if (model() === 'table') st = `入力済み ${_.ax('v').short} ${S.data.cells.v.filter(x => x != null).length}/${nSec()}・${_.ax('a').short} ${S.data.cells.a.filter(x => x != null).length}/${nSec()}`;
      if (model() === 'events') st = `変化 ${S.data.events.length} 回`;
      $('status').textContent = video.src ? st + (_.stroke ? '（記録中）' : '') : '練習中（動画を開くと、練習の入力は消えて記録が始まります）';
      if (_.M.update) _.M.update(t);
    }
    drawTimeline();
  }

  Object.assign(_, { refresh });
})();
