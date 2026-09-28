// あアラウド アノテーション 共通部分
// 動画・再生制御・巻き戻し上書き・グラフ直接編集・評価区間・操作ログ・取り消し・自動保存・書き出しを全方式で共通化する。
// 各方式（modes.js）は AH.register() で登録し、入力UIと値の読み取りだけを受け持つ。
const AH = (() => {
  const FPS = 60;              // 書き出しのサンプリング周波数
  const SNAP = 1 / FPS;        // この幅以内の既存変化点は上書き
  const $ = id => document.getElementById(id);
  const video = $('video'), tl = $('tl'), tctx = tl.getContext('2d');
  const modes = {};
  let M = null;                // 選択中の方式

  // ---------- 状態 ----------
  const S = {
    meta: { participant: '', video_file: '', duration: 0, session_start_iso: '', tool: 'ah-annotator-v0.4', mode: '', options: {}, range: null },
    data: null,   // {points:{v,a}, strokes:[], cells:{v,a}, events:[], memo:''}
    log: [], undo: [], t0: performance.now(), lastTime: 0,
    armed: false,
  };
  const emptyData = () => {
    const iv = M ? M.init : { v: 5, a: 5 };
    return { points: { v: [{ t: 0, val: iv.v, init: true }], a: [{ t: 0, val: iv.a, init: true }] },
             strokes: [], cells: { v: [], a: [] }, events: [], memo: '' };
  };
  const model = () => (M ? M.model : 'series');
  const isInt = () => !!(M && (model() === 'table' || M.integer || (M.isInteger && M.isInteger())));

  const wall = () => +(performance.now() - S.t0).toFixed(1);
  const vt = () => +video.currentTime.toFixed(4);
  const r2 = x => Math.round(x * 100) / 100;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  function addLog(type, extra = {}) {
    S.log.push({ wall_ms: wall(), video_t: vt(), type, axis: '', value: '', detail: '', ...extra });
    autosave();
  }
  const snapshot = () => JSON.parse(JSON.stringify(S.data));
  const pushUndo = s => { S.undo.push(s || snapshot()); if (S.undo.length > 200) S.undo.shift(); };
  function undo() {
    if (!S.undo.length) return;
    endStroke('undo');
    S.data = S.undo.pop();
    addLog('undo'); refresh();
  }

  // ---------- 評価区間（動画の時刻とは独立） ----------
  // start: 区間0が始まる動画時刻、count: 区間の数、bin: 1区間の長さ（秒）、label: 列の表記
  const defaultRange = D => ({ start: 0, count: Math.max(1, Math.round(D || 0)), bin: 1, label: 'countdown' });
  const RG = () => S.meta.range || defaultRange(S.meta.duration);
  const nSec = () => RG().count;
  const binStart = s => RG().start + s * RG().bin;
  const rangeEnd = () => binStart(nSec());
  const binAt = t => Math.floor((t - RG().start) / RG().bin + 1e-6);
  const curSec = () => clamp(binAt(video.currentTime || 0), 0, nSec() - 1);
  const inRange = t => t >= RG().start - 1e-6 && t < rangeEnd() - 1e-6;
  const fmtS = x => { const m = Math.floor(x / 60), s = x - m * 60; return m + ':' + (Number.isInteger(RG().bin) ? String(Math.round(s)).padStart(2, '0') : s.toFixed(1).padStart(4, '0')); };
  // 列の表記：countdown＝動画内カウントダウンの残り（区間の数から逆算）、elapsed＝評価開始からの経過
  const secLabel = s => (RG().label === 'elapsed' ? fmtS(s * RG().bin) : fmtS((nSec() - 1 - s) * RG().bin));
  const rangeSig = () => JSON.stringify(RG());
  function setRange(r) {
    S.meta.range = { ...RG(), ...r };
    addLog('range', { detail: JSON.stringify(S.meta.range) });
    syncRangeUI(); refresh();
  }

  // ---------- 時間系列（変化点）モデル ----------
  function idxAt(ps, t) {
    let lo = 0, hi = ps.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ps[mid].t <= t + 1e-9) lo = mid; else hi = mid - 1; }
    return lo;
  }
  const valueIn = (ps, t) => ps[idxAt(ps, t)].val;
  const valueAt = (axis, t) => valueIn(S.data.points[axis], t);

  function placePoint(axis, t, val) {
    const ps = S.data.points[axis];
    const near = ps.findIndex(p => Math.abs(p.t - t) < SNAP);
    if (near >= 0) { if (ps[near].val === val) return false; ps[near].val = val; }
    else { if (valueIn(ps, t) === val) return false; ps.splice(idxAt(ps, t) + 1, 0, { t, val }); }
    return true;
  }
  function deletePointBefore(axis, t) {
    const ps = S.data.points[axis];
    for (let i = ps.length - 1; i >= 0; i--) if (ps[i].t <= t + 1e-9 && !ps[i].init) { pushUndo(); return ps.splice(i, 1)[0]; }
    return null;
  }

  // ---------- ストローク（書き込み区間の上書き） ----------
  // 押している間（hold）または記録オン（armed）の間、再生中に値を書き込み、その区間の旧記録を上書きする。
  // 区間の直後には上書き前の値へ戻す変化点を置く。書き込みの生データは strokes に全て残す。
  let stroke = null;
  const pen = { down: false, clickEdit: false, v: 5, a: 5 };

  function overwriteTo(axis, fromT, t, val) {
    const ps = S.data.points[axis];
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      if (p.t > fromT + 1e-9 && p.t <= t + 1e-9 && !p.init) ps.splice(i, 1);
    }
    if (Math.abs(t) < 1e-9) { ps[0].val = val; return; }
    if (valueIn(ps, t) !== val) ps.splice(idxAt(ps, t) + 1, 0, { t, val });
  }
  function strokeSample() {
    if (!stroke) return;
    const t = vt();
    if (t < stroke.lastT) return;
    const vals = M.sample();
    const from = stroke.raw.length ? stroke.lastT : stroke.t0 - 1e-6;
    for (const ax of stroke.axes) overwriteTo(ax, from, t, r2(vals[ax]));
    const row = [t, stroke.axes.includes('v') ? r2(vals.v) : '', stroke.axes.includes('a') ? r2(vals.a) : ''];
    const last = stroke.raw[stroke.raw.length - 1];
    if (!last || last[0] !== row[0] || last[1] !== row[1] || last[2] !== row[2]) stroke.raw.push(row);
    stroke.lastT = t;
  }
  function startStroke() {
    const axes = M.writeAxes(); if (!axes.length) return;
    stroke = { before: snapshot(), axes, t0: vt(), lastT: vt(), raw: [] };
    strokeSample();
  }
  // 区間 (tEnd, restoreT) の古い点を掃除し、restoreT に上書き前の値へ戻す点を置く
  function restoreAfter(ax, beforePts, tEnd, restoreT) {
    const ps = S.data.points[ax], old = valueIn(beforePts, restoreT);
    for (let i = ps.length - 1; i >= 0; i--) if (ps[i].t > tEnd + 1e-9 && ps[i].t < restoreT - 1e-9 && !ps[i].init) ps.splice(i, 1);
    if (valueIn(ps, restoreT) !== old && !ps.some(p => Math.abs(p.t - restoreT) < 1e-9))
      ps.splice(idxAt(ps, restoreT) + 1, 0, { t: restoreT, val: old });
  }
  function endStroke(reason) {
    if (!stroke) return;
    const s = stroke; stroke = null;
    const tEnd = s.lastT, restoreT = +(tEnd + 1e-3).toFixed(4);
    if (restoreT < S.meta.duration) for (const ax of s.axes) restoreAfter(ax, s.before.points[ax], tEnd, restoreT);
    if (s.raw.length) {
      S.data.strokes.push({ id: S.data.strokes.length, source: 'input', axes: s.axes.join(''), t_start: s.t0, t_end: tEnd, end_reason: reason, wall_ms_end: wall(), samples: s.raw });
      pushUndo(s.before);
      addLog('stroke', { axis: s.axes.join(''), detail: `${s.t0.toFixed(4)}-${tEnd.toFixed(4)} n=${s.raw.length} end=${reason}` });
    }
    refresh();
  }
  const writeMode = () => (M && M.writeMode) ? M.writeMode() : null;

  // hold 方式の方式側から呼ぶ
  function penDown(vals) {
    Object.assign(pen, vals, { down: true, clickEdit: video.paused });
    if (video.paused && writeMode() === 'hold') {
      const before = snapshot(); let ch = false;
      for (const ax of M.writeAxes()) ch = placePoint(ax, vt(), r2(pen[ax])) || ch;
      if (ch) { pushUndo(before); addLog('click', { value: `${r2(pen.v)}/${r2(pen.a)}` }); }
    }
    refresh();
  }
  function penMove(vals) {
    if (!pen.down) return;
    Object.assign(pen, vals);
    if (stroke) strokeSample();
    else if (video.paused && pen.clickEdit && writeMode() === 'hold') for (const ax of M.writeAxes()) placePoint(ax, vt(), r2(pen[ax]));
    refresh();
  }
  function penUp() {
    if (!pen.down) return;
    pen.down = false; pen.clickEdit = false;
    if (writeMode() === 'hold') endStroke('release');
    autosave(); refresh();
  }

  function setArmed(on) {
    if (S.armed === on) return;
    if (on && writeMode() !== 'armed') return;
    S.armed = on;
    if (!on) endStroke('disarm');
    if (M && M.onArm) M.onArm(on);
    addLog(on ? 'arm' : 'disarm'); refresh();
  }

  // ---------- 区間表モデル ----------
  function setCell(axis, s, val, how = 'input') {
    const c = S.data.cells[axis];
    if (c[s] === val) return false;
    pushUndo(); c[s] = val;
    addLog('cell_' + how, { axis, value: val ?? '', detail: 'bin ' + s + ' (' + secLabel(s) + ')' });
    refresh(); return true;
  }
  function setCells(s, vals, how = 'input') {   // 複数軸をまとめて1回の取り消し単位で
    const c = S.data.cells;
    if (Object.entries(vals).every(([ax, v]) => c[ax][s] === v)) return false;
    pushUndo();
    for (const [ax, v] of Object.entries(vals)) c[ax][s] = v;
    addLog('cell_' + how, { axis: Object.keys(vals).join(''), value: Object.values(vals).join('/'), detail: 'bin ' + s + ' (' + secLabel(s) + ')' });
    refresh(); return true;
  }

  // ---------- 相対イベントモデル ----------
  function addEvent(ev) {
    pushUndo();
    const e = { t: vt(), ...ev };
    const ev2 = S.data.events; let i = ev2.length; while (i > 0 && ev2[i - 1].t > e.t) i--;
    ev2.splice(i, 0, e);
    addLog('rank', { value: e.label, detail: `dv=${e.dv} da=${e.da}` }); refresh();
  }
  function deleteEventBefore(t) {
    const ev = S.data.events;
    for (let i = ev.length - 1; i >= 0; i--) if (ev[i].t <= t + 1e-9) { pushUndo(); const e = ev.splice(i, 1)[0]; addLog('delete', { value: e.label, detail: 'at ' + e.t }); refresh(); return; }
  }

  // ---------- ゲームパッド ----------
  const padPrev = {};
  function gamepad() {
    const gps = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    return gps[0] || null;
  }
  function padPressed(i) {   // 押した瞬間だけ true
    const g = gamepad(); if (!g || !g.buttons[i]) return false;
    const now = g.buttons[i].pressed, was = padPrev[i]; padPrev[i] = now;
    return now && !was;
  }

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

  // ---------- タイムライン（シーク＋直接編集） ----------
  const PAD_L = 44, PAD_R = 8, RULER = 18;   // 下端 RULER px はシーク用の目盛り帯
  function geom() {
    const w = tl.clientWidth, h = tl.clientHeight, D = S.meta.duration;
    const xOf = t => PAD_L + (D ? t / D : 0) * (w - PAD_L - PAD_R);
    const tOf = x => clamp((x - PAD_L) / (w - PAD_L - PAD_R), 0, 1) * D;
    const lanes = [{ ax: 'v', name: '快度', col: css('--val'), y0: 8, y1: (h - RULER) / 2 - 8 },
                   { ax: 'a', name: '覚醒度', col: css('--aro'), y0: (h - RULER) / 2 + 8, y1: h - RULER - 8 }];
    for (const L of lanes) {
      L.lo = 1; L.hi = 9;
      if (M && M.unbounded && S.data) { const vs = S.data.points[L.ax].map(p => p.val); L.lo = Math.min(...vs) - 1; L.hi = Math.max(...vs) + 1; }
      L.yOf = v => L.y1 - (v - L.lo) / (L.hi - L.lo) * (L.y1 - L.y0);
      L.vOf = y => L.lo + (L.y1 - y) / (L.y1 - L.y0) * (L.hi - L.lo);
    }
    return { w, h, D, xOf, tOf, lanes };
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
    for (const L of G.lanes) {
      g.fillStyle = css('--muted'); g.fillText(L.name, 2, L.y0 + 10);
      if (!(M && M.unbounded)) {
        g.fillText('5', PAD_L - 12, L.yOf(5) + 4);
        g.strokeStyle = css('--line'); g.setLineDash([3, 3]); g.lineWidth = 1;
        g.beginPath(); g.moveTo(PAD_L, L.yOf(5)); g.lineTo(w - PAD_R, L.yOf(5)); g.stroke(); g.setLineDash([]);
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
          const d = L.ax === 'v' ? e.dv : e.da; if (!d) continue;
          const x = xOf(e.t), y = mid - d * 10;
          g.beginPath(); g.moveTo(x, y - d * 6); g.lineTo(x - 5, y + d * 2); g.lineTo(x + 5, y + d * 2); g.closePath(); g.fill();
        }
      }
    }
    if (D) {
      if (stroke) {
        g.fillStyle = css('--pen'); g.globalAlpha = 0.15;
        g.fillRect(xOf(stroke.t0), 2, Math.max(1, xOf(stroke.lastT) - xOf(stroke.t0)), h - RULER - 2); g.globalAlpha = 1;
      }
      const x = xOf(video.currentTime);
      g.strokeStyle = stroke ? css('--pen') : css('--head'); g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x, 2); g.lineTo(x, h); g.stroke();
    }
  }

  // グラフ直接編集：連続方式はなぞった範囲の値を描き換え、区間方式は区間の値を設定する
  let edit = null, seeking = false;
  const graphEditable = () => $('graphEdit').checked && model() !== 'events' && !!video.src;
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
    if (!(M && M.unbounded)) v = clamp(v, 1, 9);
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
    if (y >= r.height - RULER || !graphEditable()) { seeking = true; seekTo(geom().tOf(e.clientX - r.left)); return; }
    endStroke('graph');
    const G = geom(), axis = y < (G.lanes[0].y1 + G.lanes[1].y0) / 2 ? 'v' : 'a';
    edit = { axis, before: snapshot(), samples: new Map(), lastF: null, lastV: null, changed: false, bins: new Set() };
    editAt(e);
  });
  tl.addEventListener('pointermove', e => {
    if (seeking) { const r = tl.getBoundingClientRect(); seekTo(geom().tOf(e.clientX - r.left)); }
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
    $('clock').textContent = fmt(t) + ' / ' + fmt(S.meta.duration) + (S.meta.duration && !inRange(t) ? '（評価区間外）' : '');
    $('playBtn').textContent = video.paused ? '再生' : '停止';
    $('armBox').hidden = writeMode() !== 'armed';
    $('armBtn').textContent = S.armed ? '● 記録中（R）' : '記録オフ（R）';
    $('armBtn').classList.toggle('on', S.armed);
    if (M && S.data) {
      let st = '';
      if (model() === 'series') st = `書き込み ${S.data.strokes.length} 回`;
      if (model() === 'table') st = `入力済み 快度 ${S.data.cells.v.filter(x => x != null).length}/${nSec()}・覚醒度 ${S.data.cells.a.filter(x => x != null).length}/${nSec()}`;
      if (model() === 'events') st = `変化 ${S.data.events.length} 回`;
      $('status').textContent = video.src ? st + (stroke ? '（記録中）' : '') : '練習中（動画を開くと、練習の入力は消えて記録が始まります）';
      if (M.update) M.update(t);
    }
    drawTimeline();
  }

  // ---------- 方式の登録・切り替え ----------
  function register(m) { modes[m.id] = m; }
  function remount() {
    for (const el of ['panel', 'overlay', 'under']) $(el).innerHTML = '';
    $('stage').style.boxShadow = '';
    document.body.dataset.side = M.side || 'normal';
    $('modeHelp').innerHTML = M.help || '';
    M.mount({ panel: $('panel'), overlay: $('overlay'), under: $('under') });
    resize();
  }
  function selectMode(id, keepOptions = false) {
    M = modes[id]; S.meta.mode = id; $('mode').value = id;
    S.meta.options = { ...(M.options || {}), ...(keepOptions ? S.meta.options : {}) };
    if (!S.data || !video.src) S.data = emptyData();
    remount();
  }
  // 評価の途中で方式を切り替える：今の評価を保存し、切り替え先の保存データがあれば再開、なければ新規
  function switchMode(id) {
    if (!video.src) { selectMode(id); refresh(); return; }
    if (id === S.meta.mode) return;
    endStroke('mode_switch'); setArmed(false); pen.down = false;
    addLog('mode_switch', { detail: `${S.meta.mode} -> ${id}` }); autosave();
    const range = S.meta.range;
    M = modes[id]; S.meta.mode = id; S.meta.options = {};
    if (!tryRestore()) newSession(`mode=${id}`, range);
    selectMode(id, true); refresh();
  }
  function newSession(detail, range) {
    S.data = emptyData(); S.log = []; S.undo = [];
    S.t0 = performance.now(); S.meta.session_start_iso = new Date().toISOString();
    S.meta.range = range || defaultRange(S.meta.duration);
    addLog('session_start', { detail });
  }
  function setOption(k, v) { S.meta.options[k] = v; addLog('option', { detail: `${k}=${v}` }); refresh(); }

  // ---------- 動画 ----------
  function seekTo(t) { if (S.meta.duration) video.currentTime = clamp(t, 0, S.meta.duration); }
  function togglePlay() { if (!video.src) return; video.paused ? video.play() : video.pause(); }

  $('openBtn').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    setArmed(false); pen.down = false;   // 練習中の記録オンも解除
    if (video.src) { endStroke('reload'); autosave(); URL.revokeObjectURL(video.src); }
    video.src = URL.createObjectURL(f);
    video.hidden = false; $('empty').hidden = true;
    S.meta.video_file = f.name; S.meta.participant = $('pid').value.trim();
    video.addEventListener('loadedmetadata', () => {
      S.meta.duration = video.duration;
      S.meta.range = null;
      if (!tryRestore()) newSession(`${f.name} dur=${video.duration.toFixed(3)} mode=${S.meta.mode}`);
      video.playbackRate = +$('rate').value;
      selectMode(S.meta.mode, true); syncRangeUI(); refresh();
    }, { once: true });
    e.target.value = '';
  });
  video.addEventListener('play', () => { pen.clickEdit = false; addLog('play'); refresh(); });
  video.addEventListener('pause', () => { endStroke('pause'); addLog('pause'); refresh(); });
  video.addEventListener('seeking', () => endStroke('seek'));
  video.addEventListener('seeked', () => { addLog('seek', { detail: 'from ' + S.lastTime.toFixed(4) }); S.lastTime = video.currentTime; refresh(); });
  video.addEventListener('ended', () => { endStroke('ended'); addLog('ended'); });
  $('rate').addEventListener('change', e => { video.playbackRate = +e.target.value; addLog('rate', { value: e.target.value }); e.target.blur(); });
  $('pid').addEventListener('change', e => { S.meta.participant = e.target.value.trim(); });
  $('mode').addEventListener('change', e => { switchMode(e.target.value); e.target.blur(); });
  $('playBtn').addEventListener('click', e => { togglePlay(); e.target.blur(); });
  $('backBtn').addEventListener('click', e => { seekTo(video.currentTime - 1); e.target.blur(); });
  $('fwdBtn').addEventListener('click', e => { seekTo(video.currentTime + 1); e.target.blur(); });
  $('armBtn').addEventListener('click', e => { setArmed(!S.armed); e.target.blur(); });
  $('graphEdit').addEventListener('change', e => { addLog('graph_edit', { value: e.target.checked }); e.target.blur(); });

  // 評価区間の設定欄
  function syncRangeUI() {
    const r = RG();
    $('rgStart').value = r.start; $('rgCount').value = r.count; $('rgBin').value = r.bin; $('rgLabel').value = r.label;
    $('rgBtn').textContent = `評価区間 ${fmt(r.start).slice(0, -3)}〜 ${r.count}×${r.bin}秒`;
  }
  $('rgBtn').addEventListener('click', e => { $('rgPanel').hidden = !$('rgPanel').hidden; e.target.blur(); });
  for (const id of ['rgStart', 'rgCount', 'rgBin', 'rgLabel']) $(id).addEventListener('change', () => {
    const start = Math.max(0, +$('rgStart').value || 0), bin = Math.max(0.1, +$('rgBin').value || 1);
    setRange({ start, bin, count: Math.max(1, Math.round(+$('rgCount').value || 1)), label: $('rgLabel').value });
  });
  $('rgNow').addEventListener('click', e => { setRange({ start: +video.currentTime.toFixed(2) }); e.target.blur(); });
  $('rgFit').addEventListener('click', e => { const r = RG(); setRange({ count: Math.max(1, Math.floor((S.meta.duration - r.start) / r.bin + 1e-6)) }); e.target.blur(); });

  // ---------- 毎フレーム ----------
  let lastFrame = performance.now();
  function tick(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
    if (!video.seeking) S.lastTime = video.currentTime;
    if (M && S.data) {
      if (M.tick) M.tick(dt);
      if (writeMode() === 'armed' && padPressed(0)) setArmed(!S.armed);
      const wm = writeMode();
      const want = wm === 'hold' ? (pen.down && !pen.clickEdit) : wm === 'armed' ? S.armed : false;
      const running = !video.paused && !video.seeking;
      if (want && !stroke && running) startStroke();
      else if (stroke && !want) endStroke(wm === 'hold' ? 'release' : 'disarm');
      else if (stroke && running) strokeSample();
      if (!video.paused || pen.down || stroke || M.animate) refresh();
    }
    requestAnimationFrame(tick);
  }

  // ---------- キー操作 ----------
  document.addEventListener('keydown', e => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;   // 入力欄（Excel方式のセル等）は各自で処理
    if (M && M.onKey && M.onKey(e)) { e.preventDefault(); return; }
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      seekTo(video.currentTime + (e.shiftKey ? 0.1 : 1) * (e.code === 'ArrowLeft' ? -1 : 1));
    }
    else if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); undo(); }
    else if (e.code === 'KeyR' && writeMode() === 'armed') { e.preventDefault(); setArmed(!S.armed); }
  });
  document.addEventListener('keyup', e => { if (M && M.onKeyUp) M.onKeyUp(e); });
  window.addEventListener('blur', () => { if (M && M.onBlur) M.onBlur(); });

  // ---------- 書き出し ----------
  const csvCell = x => { const s = String(x ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const toCSV = (header, rows) => [header.join(','), ...rows.map(r => r.map(csvCell).join(','))].join('\n');
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + text], { type }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  $('exportBtn').addEventListener('click', () => {
    if (!video.src) return;
    endStroke('export'); addLog('export');
    const base = `${S.meta.participant || 'noid'}_${S.meta.video_file.replace(/\.[^.]+$/, '')}_${M.id}`;
    const D = S.meta.duration, N = Math.floor(D * FPS), n = nSec();
    const files = [];
    const out = (suffix, header, rows) => { download(base + suffix, toCSV(header, rows), 'text/csv'); files.push(suffix); };
    const binCols = s => [s, secLabel(s), binStart(s).toFixed(3), binStart(s + 1).toFixed(3)];
    const binHead = ['bin', 'label', 't_start', 't_end'];

    if (model() === 'series') {
      const smp = [];
      for (let k = 0; k <= N; k++) { const t = k / FPS; smp.push([k, t.toFixed(4), valueAt('v', t), valueAt('a', t)]); }
      out('_60hz.csv', ['frame', 't', 'valence', 'arousal'], smp);
      // 区間系列。整数値の方式：各区間で最も長く続いた値（同数なら先）。連続値：各区間の平均（有界なら9段階丸めも）
      const rows = [];
      for (let s = 0; s < n; s++) {
        const k0 = Math.round(binStart(s) * FPS), k1 = Math.min(Math.round(binStart(s + 1) * FPS), N + 1);
        const ks = []; for (let k = k0; k < k1; k++) ks.push(k);
        const row = binCols(s);
        for (const ax of ['v', 'a']) {
          const xs = ks.map(k => valueAt(ax, k / FPS));
          if (!xs.length) { row.push(''); continue; }
          if (isInt()) {
            const cnt = new Map(), order = [];
            for (const v of xs) { if (!cnt.has(v)) order.push(v); cnt.set(v, (cnt.get(v) || 0) + 1); }
            let best = order[0]; for (const v of order) if (cnt.get(v) > cnt.get(best)) best = v;
            row.push(best);
          } else row.push((xs.reduce((p, c) => p + c, 0) / xs.length).toFixed(3));
        }
        if (!isInt() && !M.unbounded) row.push(row[4] === '' ? '' : Math.round(+row[4]), row[5] === '' ? '' : Math.round(+row[5]));
        rows.push(row);
      }
      out('_bins.csv', isInt() ? [...binHead, 'valence', 'arousal'] : M.unbounded ? [...binHead, 'valence_mean', 'arousal_mean']
        : [...binHead, 'valence_mean', 'arousal_mean', 'valence_r9', 'arousal_r9'], rows);
      const cps = [];
      for (const ax of ['v', 'a']) for (const p of S.data.points[ax]) cps.push([ax === 'v' ? 'valence' : 'arousal', p.t, p.val, p.init ? 1 : 0]);
      out('_changepoints.csv', ['axis', 't', 'value', 'initial'], cps);
      if (S.data.strokes.length) {
        const rs = []; for (const s of S.data.strokes) for (const [t, v, a] of s.samples) rs.push([s.id, s.source || 'input', s.axes, t, v, a]);
        out('_strokes.csv', ['stroke', 'source', 'axes', 't', 'valence', 'arousal'], rs);
      }
    } else if (model() === 'table') {
      out('_bins.csv', [...binHead, 'valence', 'arousal'], [...Array(n).keys()].map(s => [...binCols(s), S.data.cells.v[s] ?? '', S.data.cells.a[s] ?? '']));
    } else if (model() === 'events') {
      out('_ranks.csv', ['t', 'label', 'd_valence', 'd_arousal'], S.data.events.map(e => [e.t, e.label, e.dv, e.da]));
      const rows = [];
      for (let s = 0; s < n; s++) {
        const es = S.data.events.filter(e => e.t >= binStart(s) && e.t < binStart(s + 1));
        rows.push([...binCols(s), es.length, es.reduce((p, e) => p + e.dv, 0), es.reduce((p, e) => p + e.da, 0)]);
      }
      out('_bins.csv', [...binHead, 'n_changes', 'sum_d_valence', 'sum_d_arousal'], rows);
    }
    out('_events.csv', ['wall_ms', 'video_t', 'type', 'axis', 'value', 'detail'], S.log.map(e => [e.wall_ms, e.video_t, e.type, e.axis, e.value, e.detail]));
    download(base + '_session.json', JSON.stringify({ meta: S.meta, data: S.data, log: S.log }, null, 1), 'application/json');
    $('status').textContent = `書き出しました（${files.length + 1}ファイル）`;
  });

  // ---------- 自動保存（方式＋参加者ID＋動画名で復元） ----------
  const key = () => `ahann4:${S.meta.mode}:${S.meta.participant}:${S.meta.video_file}`;
  function autosave() {
    if (!S.meta.video_file || !S.data) return;
    try { localStorage.setItem(key(), JSON.stringify({ meta: S.meta, data: S.data, log: S.log, undo: S.undo.slice(-10) })); } catch (_) {}
  }
  function tryRestore() {
    try {
      const raw = localStorage.getItem(key()); if (!raw) return false;
      const s = JSON.parse(raw);
      if (!confirm(`「${modes[S.meta.mode].label}」でこの参加者ID・動画の途中データがあります。続きから再開しますか？\n（キャンセルすると新しく始めます）`)) {
        localStorage.removeItem(key()); return false;
      }
      S.data = s.data; S.log = s.log; S.undo = s.undo || [];
      S.meta = { ...s.meta, duration: video.duration };
      S.t0 = performance.now() - (S.log.length ? S.log[S.log.length - 1].wall_ms : 0);
      addLog('restore'); return true;
    } catch (_) { return false; }
  }
  // タブを閉じる・隠すときは書き込み中の区間を確定して保存
  const flush = () => { endStroke('hide'); autosave(); };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

  // ---------- 動画の大きさ・小窓（ピクチャーインピクチャー） ----------
  function setVideoSize(p) {
    document.body.style.setProperty('--vp', p); $('vidSize').value = p; $('vidSizeLab').textContent = p + '%';
    try { localStorage.setItem('ahann_vidsize', p); } catch (_) {}
    resize();
  }
  $('vidSize').addEventListener('input', e => setVideoSize(+e.target.value));
  $('vidSize').addEventListener('change', e => e.target.blur());
  $('pipBtn').addEventListener('click', async e => {
    e.target.blur();
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (video.src) await video.requestPictureInPicture();
    } catch (err) { $('status').textContent = '小窓にできませんでした：' + err.message; }
  });
  $('pipBack').addEventListener('click', () => { if (document.pictureInPictureElement) document.exitPictureInPicture(); });
  video.addEventListener('enterpictureinpicture', () => { document.body.classList.add('pip'); $('pipBtn').textContent = '小窓を戻す'; addLog('pip', { value: 'on' }); resize(); });
  video.addEventListener('leavepictureinpicture', () => { document.body.classList.remove('pip'); $('pipBtn').textContent = '小窓で再生'; addLog('pip', { value: 'off' }); resize(); });
  $('pipBtn').hidden = !document.pictureInPictureEnabled;

  function resize() { fitCanvas(tl); if (M && M.resize) M.resize(); refresh(); }
  window.addEventListener('resize', resize);

  function init() {
    const sel = $('mode'), groups = {};
    for (const m of Object.values(modes)) {
      if (!groups[m.group]) { groups[m.group] = document.createElement('optgroup'); groups[m.group].label = m.group; sel.appendChild(groups[m.group]); }
      const o = document.createElement('option'); o.value = m.id; o.textContent = m.label; groups[m.group].appendChild(o);
    }
    let vp = 55; try { vp = +localStorage.getItem('ahann_vidsize') || 55; } catch (_) {}
    setVideoSize(vp);
    selectMode(sel.value); syncRangeUI();
    requestAnimationFrame(tick);
  }

  return {
    S, pen, video, init, register, refresh, remount, addLog, pushUndo, snapshot, css, fitCanvas, fmt, clamp, r2,
    vt, valueAt, placePoint, deletePointBefore, penDown, penMove, penUp, setArmed, endStroke, isWriting: () => !!stroke,
    nSec, curSec, binStart, secLabel, rangeSig, inRange, setCell, setCells, addEvent, deleteEventBefore, seekTo, togglePlay, setOption,
    gamepad, quadColor, gradColor, intensity, rgba, hasVideo: () => !!video.src, get mode() { return M; },
  };
})();
