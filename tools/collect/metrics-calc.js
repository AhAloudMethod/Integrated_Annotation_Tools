// 行動指標の計算：試行 1 つの操作ログと値（_session.json）から，試行の要約・入力ごと・記録ごと・1 秒平均の行を作る．
// 定義は docs/superpowers/specs/2026-11-20-behavior-metrics-design.md．Node の標準モジュールと lib.js だけを使う
const { csvParse } = require('./lib');

const CONT_MODES = new Set(['carma', 'darma', 'ranktrace', 'throttle', 'emujoy', 'feeltrace', 'rcea', 'halolight']);
const STILL_WINDOW = 0.5;   // 止めていたかを見る窓（動画の秒）

// 方式の分類：'discrete'（区間ごと）・'continuous'（記録オンの間に書き込む）・null（対象外）
function family(mode, o = {}) {
  if (mode === 'excel') return 'discrete';
  if (mode === 'custom') {
    if (o.rep === 'excel' || o.time === 'disc') return 'discrete';
    if (['plane', 'circle', 'sliders'].includes(o.rep || 'plane')) return 'continuous';
    return null;
  }
  return CONT_MODES.has(mode) ? 'continuous' : null;
}

// 評価区間の区切り [開始, 区切り…, 終了]（core/range.js の edgesNow と rangeEnd と同じ）
function edgesOf(r) {
  if (!r) return null;
  if (Array.isArray(r.edges)) return r.edges.map(Number);
  const out = [];
  for (let s = 0; s < r.count; s++) out.push(r.start + s * r.bin);
  const full = r.start + r.count * r.bin;
  out.push(r.target != null ? Math.min(full, Math.max(r.target, full - r.bin + 1e-3)) : full);
  return out;
}
const parseRange = l => { try { return edgesOf(JSON.parse(l.detail)); } catch (_e) { return null; } };

const median = xs => { const a = xs.filter(x => x != null).sort((p, q) => p - q); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
// [a, b] と区間の列の重なりの長さ
const overlap = (ints, a, b) => ints.reduce((s, [x, y]) => s + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0);
// 区間の列を重ならないようにまとめる
function union(ints) {
  const out = [];
  for (const [a, b] of [...ints].sort((p, q) => p[0] - q[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]);
  }
  return out;
}

// ---------- 試行の共通部分 ----------
// 最後の task_start から task_end まで（annotator の試行の要約と同じ）
function taskSpan(log) {
  let k0 = -1;
  for (let k = log.length - 1; k >= 0; k--) if (log[k].type === 'task_start') { k0 = k; break; }
  if (k0 < 0) return null;
  const rest = log.slice(k0), ke = rest.findIndex(l => l.type === 'task_end');
  return { k0, rows: ke < 0 ? rest : rest.slice(0, ke + 1) };
}

function common(log, span) {
  const rows = span.rows, w0 = rows[0].wall_ms, w1 = rows[rows.length - 1].wall_ms;
  const play = [], review = [];
  let playAt = null, revAt = null;
  for (const l of rows) {
    if (l.type === 'play' && playAt == null) playAt = l.wall_ms;
    else if ((l.type === 'pause' || l.type === 'ended') && playAt != null) { play.push([playAt, l.wall_ms]); playAt = null; }
    else if (l.type === 'review' && l.value === 'on' && revAt == null) revAt = l.wall_ms;
    else if (l.type === 'review' && l.value === 'off' && revAt != null) { review.push([revAt, l.wall_ms]); revAt = null; }
  }
  if (playAt != null) play.push([playAt, w1]);
  if (revAt != null) review.push([revAt, w1]);
  const backs = [];
  for (const l of rows) {
    if (l.type !== 'seek') continue;
    const m = /from (-?[\d.]+)/.exec(l.detail || '');
    if (m && +l.video_t < +m[1] - 1e-3) backs.push({ wall: l.wall_ms, s: +m[1] - +l.video_t });
  }
  // その時点の区切り：span より前の最後の range（無ければ exp_trial の区間）
  let edges0 = null;
  for (let k = 0; k < span.k0; k++) if (log[k].type === 'range') edges0 = parseRange(log[k]) || edges0;
  if (!edges0) {
    const et = [...log.slice(0, span.k0)].reverse().find(l => l.type === 'exp_trial');
    try { const r = et && JSON.parse(et.detail).range; if (r) edges0 = [r.start, r.end]; } catch (_e) { /* 読めなければ書き出し時点の区切り */ }
  }
  const n = type => rows.filter(l => l.type === type).length;
  return { w0, w1, play, review, backs, edges0, n_undo: n('undo'), n_redo: n('redo'), n_click: n('click'), n_delete: n('delete'),
    rangeCuts: n('range_cut') };
}

// ---------- 区間ごとの方式 ----------
const isInput = t => (/^cell_/.test(t) && t !== 'cell_focus' && t !== 'cell_blur') || ['graph_cells', 'graph_draw', 'graph_curve', 'curve_shape', 'curve_novoice'].includes(t);
const norm = x => { const s = String(x ?? ''); return s !== '' && isFinite(+s) ? +s : s; };

function discrete(rows, c, finalEdges) {
  let edges = c.edges0 || finalEdges, lastWall = null, lastListen = null, lastDown = null, focus = null, stash = null, anyPrev = false;
  const drawn = { v: [], a: [] }, out = [];
  const win = s => (edges && s >= 0 && s + 1 < edges.length ? [edges[s], edges[s + 1]] : [null, null]);
  for (const l of rows) {
    const t = l.type;
    if (t === 'range') { edges = parseRange(l) || edges; continue; }
    if (t === 'listen_pause') { lastListen = l.wall_ms; continue; }
    if (t === 'graph_down') { lastDown = l.wall_ms; continue; }
    if (t === 'cell_focus') {
      const m = /^bin (\d+)(?: via=(\w+))?/.exec(l.detail || ''), bin = m ? +m[1] : null, via = m && m[2] ? m[2] : null;
      if (via === 'rebuild' && stash && stash.bin === bin) focus = stash;   // 表の作り直しの組は選び直しにしない
      else focus = { wall: l.wall_ms, axis: l.axis, bin, via, used: false };
      stash = null; continue;
    }
    if (t === 'cell_blur') { stash = focus; focus = null; continue; }
    if (!isInput(t)) continue;

    const row = { wall_ms: l.wall_ms, video_t: l.video_t, type: t, axis: l.axis, value: l.value, t_start: null, t_end: null, is_correction: null, select_ms: null, key_ms: null, via: '', listen_ms: null };
    const detail = l.detail || '';
    if (/^cell_/.test(t)) {
      const m = /^bin (\d+)/.exec(detail), bin = m ? +m[1] : null;
      [row.t_start, row.t_end] = win(bin);
      const pm = / prev=(\S*)$/.exec(detail);
      if (pm) {
        anyPrev = true;
        const vals = String(l.value ?? '').split('/'), prevs = pm[1].split('/');
        row.is_correction = prevs.some((p, i) => p !== '-' && norm(p) !== norm(vals[i] ?? ''));
      }
      if (focus && !focus.used && focus.bin === bin && String(l.axis).includes(focus.axis)) {
        row.via = focus.via || '';
        if (focus.via === 'click') row.select_ms = l.wall_ms - focus.wall;
        else if (focus.via === 'key') row.key_ms = l.wall_ms - focus.wall;
        focus.used = true;
      }
    } else if (t === 'graph_cells') {
      const m = /^bins ([\d ]+?)(?: prev (.*))?$/.exec(detail), bins = m ? m[1].trim().split(/\s+/).map(Number) : [];
      if (bins.length) { row.t_start = win(Math.min(...bins))[0]; row.t_end = win(Math.max(...bins))[1]; }
      if (m && m[2] != null && l.value !== '') {
        anyPrev = true;
        const vals = String(l.value).split(' '), prevs = m[2].split(' ');
        row.is_correction = prevs.some((p, i) => p !== '-' && norm(p) !== norm(vals[i]));
      }
    } else if (t === 'graph_draw' || t === 'graph_curve') {
      if (t === 'graph_draw') { const m = /^([\d.]+)-([\d.]+)/.exec(detail); if (m) [row.t_start, row.t_end] = [+m[1], +m[2]]; }
      else { const m = /^bin (\d+)/.exec(detail); [row.t_start, row.t_end] = win(m ? +m[1] : null); }
      if (row.t_start != null) {
        row.is_correction = false;
        for (const ax of String(l.axis)) {
          if (!drawn[ax]) continue;
          if (overlap(drawn[ax], row.t_start, row.t_end) > 1e-6) row.is_correction = true;
          drawn[ax].push([row.t_start, row.t_end]);
        }
      }
    } else {   // curve_shape・curve_novoice
      const m = /^bin (\d+)/.exec(detail); [row.t_start, row.t_end] = win(m ? +m[1] : null);
      row.is_correction = t === 'curve_shape' || l.value === 'off';
    }
    if (/^graph_/.test(t) && lastDown != null) { row.select_ms = l.wall_ms - lastDown; lastDown = null; }
    if (lastListen != null) { row.listen_ms = l.wall_ms - lastListen; lastListen = null; }
    row.is_first = lastWall == null;
    if (lastWall != null) {
      row.interval_raw_ms = l.wall_ms - lastWall;
      row.play_between_ms = overlap(c.play, lastWall, l.wall_ms);
      row.interval_ms = row.interval_raw_ms - row.play_between_ms;
      row.seek_back_between = c.backs.filter(b => b.wall > lastWall && b.wall <= l.wall_ms).length;
    }
    lastWall = l.wall_ms;
    out.push(row);
  }
  return { inputs: out, oldLog: out.length > 0 && !anyPrev };
}

// ---------- 連続の方式 ----------
// 揺れ（ヒステリシスで数えた向きの反転）と動かした量（確定した動きの絶対値の合計）
function swayOf(xs, h) {
  if (!xs.length) return { n: 0, move: 0 };
  let ext = xs[0], dir = 0, n = 0, move = 0;
  for (const x of xs.slice(1)) {
    if (dir === 0) { if (Math.abs(x - ext) > h) { dir = Math.sign(x - ext); move += Math.abs(x - ext); ext = x; } }
    else if (dir * (x - ext) > 0) { move += Math.abs(x - ext); ext = x; }
    else if (Math.abs(x - ext) > h) { n++; move += Math.abs(x - ext); dir = -dir; ext = x; }
  }
  return { n, move };
}
// 階段状の値の列 [[t, v]…]（t の昇順）の，時刻 t の値
function stepIdx(ps, t) {   // t 以前の最後の行の番号（無ければ -1）
  let lo = 0, hi = ps.length - 1;
  if (!ps.length || ps[0][0] > t + 1e-9) return -1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ps[mid][0] <= t + 1e-9) lo = mid; else hi = mid - 1; }
  return lo;
}
// 止めていた時間の割合：1/60 秒ごとに，その時刻から STILL_WINDOW 秒の間の値の幅が still 以下ならその刻みは止めている（軸がいくつかあれば全部）
function stillRatio(series, t0, t1, still) {
  const dt = 1 / 60;
  let n = 0, k = 0;
  for (let t = t0; t < t1 - 1e-9; t += dt, n++) {
    const ok = series.every(ps => {
      let lo = Infinity, hi = -Infinity, i = stepIdx(ps, t);
      if (i >= 0) lo = hi = ps[i][1];
      for (i++; i < ps.length && ps[i][0] < t + STILL_WINDOW - 1e-9; i++) { lo = Math.min(lo, ps[i][1]); hi = Math.max(hi, ps[i][1]); }
      return hi - lo <= still + 1e-9;
    });
    if (ok) k++;
  }
  return n ? k / n : null;
}

function continuous(strokes, opts) {
  const prior = { v: [], a: [] }, out = [];
  for (const st of strokes) {
    const axes = String(st.axes || '').split('').filter(ax => prior[ax]);
    const t0 = +st.t_start, t1 = +st.t_end, len = Math.max(0, t1 - t0);
    let ov = 0;
    for (const ax of axes) ov = Math.max(ov, overlap(union(prior[ax]), t0, t1));
    const series = axes.map(ax => (st.samples || []).filter(s => s[ax === 'v' ? 1 : 2] !== '' && s[ax === 'v' ? 1 : 2] != null).map(s => [+s[0], +s[ax === 'v' ? 1 : 2]]));
    let n = 0, move = 0;
    for (const ps of series) { const r = swayOf(ps.map(p => p[1]), opts.sway); n += r.n; move += r.move; }
    out.push({ id: st.id, source: st.source || 'input', axes: axes.join(''), t_start: t0, t_end: t1, length_s: len, wall_ms_start: st.wall_ms_start ?? null, wall_ms_end: st.wall_ms_end ?? null,
      is_rerecord: ov > 1e-3, overlap_s: ov, n_sway: n, movement: move, still_ratio: stillRatio(series, t0, t1, opts.still) });
    for (const ax of axes) prior[ax].push([t0, t1]);
  }
  return { recordings: out, cover: { v: union(prior.v), a: union(prior.a) } };
}

// ---------- 最終的な値の時系列（連続の方式） ----------
// 上書きの仕方は core/stroke.js の overwriteTo・restoreAfter，値の引き方は core/series.js の idxAt と同じ
const TT = 1e-4;
function idxAt(ps, t) { let lo = 0, hi = ps.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ps[mid].t <= t + TT) lo = mid; else hi = mid - 1; } return lo; }
const valueIn = (ps, t) => ps[idxAt(ps, t)].val;
function overwriteTo(ps, fromT, t, val) {
  for (let i = ps.length - 1; i >= 0; i--) { const p = ps[i]; if (p.t > fromT + 1e-9 && p.t <= t + 1e-9 && !p.init) ps.splice(i, 1); }
  if (Math.abs(t) < 1e-9) { ps[0].val = val; return; }
  if (valueIn(ps, t) !== val) ps.splice(idxAt(ps, t) + 1, 0, { t, val });
}
function restoreAfter(ps, beforePts, tEnd, restoreT) {
  const old = valueIn(beforePts, restoreT);
  for (let i = ps.length - 1; i >= 0; i--) if (ps[i].t > tEnd + 1e-9 && ps[i].t < restoreT - 1e-9 && !ps[i].init) ps.splice(i, 1);
  if (valueIn(ps, restoreT) !== old && !ps.some(p => Math.abs(p.t - restoreT) < 1e-9)) ps.splice(idxAt(ps, restoreT) + 1, 0, { t: restoreT, val: old });
}
const inside = (ints, t) => ints.some(([a, b]) => t >= a - 1e-9 && t <= b + 1e-9);

// keepHead 秒：録り直し（前の記録がある時刻から始まる記録）の始めのその秒数は上書きせず，前の値を残す
function replay(strokes, init, duration, keepHead) {
  const P = { v: [{ t: 0, val: init, init: true }], a: [{ t: 0, val: init, init: true }] }, prior = { v: [], a: [] };
  for (const st of strokes) {
    const axes = String(st.axes || '').split('').filter(ax => P[ax]), t0 = +st.t_start, tEnd = +st.t_end;
    const before = { v: P.v.map(p => ({ ...p })), a: P.a.map(p => ({ ...p })) };
    for (const ax of axes) {
      const col = ax === 'v' ? 1 : 2, ps = P[ax];
      const b = keepHead > 0 && inside(prior[ax], t0) ? t0 + keepHead : null;   // ここより前は前の値を残す
      let last = null, lastVal = null, pending = null;   // pending：b より前の最後の値（b からはこの値で書き込んでいた）
      for (const s of st.samples || []) {
        if (s[col] === '' || s[col] == null) continue;
        const t = +s[0], val = +s[col];
        if (b != null && t < b - 1e-9) { pending = val; continue; }
        if (b != null && last == null && pending != null && t > b + 1e-9) { overwriteTo(ps, b - 1e-6, b, pending); last = b; lastVal = pending; }
        overwriteTo(ps, last != null ? last : b != null ? t - 1e-6 : t0 - 1e-6, t, val);
        last = t; lastVal = val;
      }
      if (b != null && last == null && pending != null && b <= tEnd + 1e-9) { overwriteTo(ps, b - 1e-6, b, pending); last = b; lastVal = pending; }
      // サンプルの行は値が変わったときだけ増えるので，最後の行から記録の終わりまでも同じ値で書き込んでいた
      if (last != null && tEnd > last + 1e-9) overwriteTo(ps, last, tEnd, lastVal);
    }
    const restoreT = +(tEnd + 1e-3).toFixed(4);
    if ((st.after || 'hold') === 'restore' && restoreT < duration) for (const ax of axes) restoreAfter(P[ax], before[ax], tEnd, restoreT);
    for (const ax of axes) prior[ax].push([t0, tEnd]);
  }
  return P;
}

// ---------- 1 秒平均 ----------
// steps：[[t, 値か null]…]（t の昇順．最後の値は先へ続く）．[a, b) の時間で重み付けした平均と，値のある時間の割合
function meanOver(steps, a, b) {
  let sum = 0, cov = 0;
  for (let i = 0; i < steps.length; i++) {
    const x = Math.max(a, steps[i][0]), y = Math.min(b, i + 1 < steps.length ? steps[i + 1][0] : Infinity), v = steps[i][1];
    if (y > x && v != null) { sum += v * (y - x); cov += y - x; }
  }
  return { mean: cov > 0 ? sum / cov : null, covered: b > a ? cov / (b - a) : 0 };
}
function secondsOf(edges, axes) {   // axes：{ v: { steps, cover? }, a: … }
  const rs = edges[0], re = edges[edges.length - 1], n = Math.max(0, Math.ceil(re - rs - 1e-6)), out = [];
  for (let i = 0; i < n; i++) {
    const a = rs + i, b = Math.min(rs + i + 1, re), row = { second: i, t_start: a, t_end: b };
    for (const [ax, name] of [['v', 'valence'], ['a', 'arousal']]) {
      const m = meanOver(axes[ax].steps, a, b);
      row[name] = m.mean;
      row['covered_' + ax] = axes[ax].cover ? overlap(axes[ax].cover, a, b) / (b - a) : m.covered;
    }
    out.push(row);
  }
  return out;
}
const csvTable = text => { const [head, ...rows] = csvParse(text).filter(r => r.length > 1); return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]]))); };
// 区間ごとの方式：_60hz.csv（区間内で変化を使ったとき）か _bins.csv．空欄と発声なし（0）は値に入れない
function discreteSteps(csvs) {
  const val = x => (x === '' || x == null || +x === 0 || !isFinite(+x) ? null : +x);
  const hz = csvs.find(c => c.suffix === '60hz.csv');
  if (hz) {
    const rows = csvTable(hz.text);
    return { v: { steps: rows.map(r => [+r.frame / 60, val(r.valence)]) }, a: { steps: rows.map(r => [+r.frame / 60, val(r.arousal)]) } };
  }
  const bins = csvs.find(c => c.suffix === 'bins.csv');
  if (!bins) return null;
  const rows = csvTable(bins.text), mk = col => {
    const st = [];
    for (const r of rows) { st.push([+r.t_start, val(r[col] ?? r[col + '_mean'])]); st.push([+r.t_end, null]); }
    return st.sort((p, q) => p[0] - q[0]).filter((p, i, a) => !(a[i + 1] && a[i + 1][0] === p[0] && p[1] == null));
  };
  return { v: { steps: mk('valence') }, a: { steps: mk('arousal') } };
}

// ---------- 試行 1 つ ----------
// t：lib.js の readTrialZip の結果．opts：{ keepHead, sway, still }．{ row, inputs, recordings, seconds, problems }
function analyzeTrial(t, opts) {
  const problems = [], say = s => problems.push(`${t.name}：${s}`);
  const meta = t.meta || {}, fam = family(meta.mode, meta.options || {});
  if (!fam) { say(`対象外の方式（${meta.mode}${meta.options && meta.options.rep ? '・' + meta.options.rep : ''}）なので飛ばしました`); return { problems }; }
  const span = taskSpan(t.log);
  if (!span) { say('task_start が無いので飛ばしました'); return { problems }; }
  const c = common(t.log, span), finalEdges = edgesOf(meta.range);
  if (!finalEdges) { say('評価区間が読めないので飛ばしました'); return { problems }; }
  const rangeS = finalEdges[finalEdges.length - 1] - finalEdges[0];
  const task = c.w1 - c.w0, playMs = c.play.reduce((s, [a, b]) => s + b - a, 0), other = task - playMs;
  const row = { family: fam, range_s: rangeS, task_ms: task, play_ms: playMs, review_ms: c.review.reduce((s, [a, b]) => s + b - a, 0), other_ms: other,
    n_seek_back: c.backs.length, seek_back_s: c.backs.reduce((s, b) => s + b.s, 0), n_undo: c.n_undo, n_redo: c.n_redo };
  let inputs = [], recordings = [], seconds = [];
  if (fam === 'discrete') {
    if ((c.n_undo || c.n_redo) && c.rangeCuts) say('区切りを変えた試行で undo・redo があり，その後の入力の時間帯は正しくないことがあります');
    const r = discrete(span.rows, c, finalEdges);
    inputs = r.inputs;
    if (r.oldLog) say('記録を足す前のログなので，修正か・入力にかかった時間などの列は空欄です');
    const later = inputs.filter(x => !x.is_first);
    Object.assign(row, { n_inputs: inputs.length, n_correction_inputs: r.oldLog ? null : inputs.filter(x => x.is_correction).length,
      median_interval_ms: median(later.map(x => x.interval_ms)), median_interval_raw_ms: median(later.map(x => x.interval_raw_ms)),
      median_select_ms: median(inputs.map(x => x.select_ms)), median_key_ms: median(inputs.map(x => x.key_ms)), median_listen_ms: median(inputs.map(x => x.listen_ms)) });
    row.n_corrections = row.n_correction_inputs == null ? null : row.n_correction_inputs + c.n_undo;
    const steps = discreteSteps(t.csvs || []);
    if (steps) seconds = secondsOf(finalEdges, steps); else say('_bins.csv が無いので 1 秒平均を出せません');
  } else {
    const strokes = ((t.data && t.data.strokes) || []).map((s, i) => ({ ...s, _i: i }));
    if (strokes.every(s => typeof s.wall_ms_start === 'number')) strokes.sort((p, q) => p.wall_ms_start - q.wall_ms_start || p._i - q._i);
    const r = continuous(strokes, opts);
    recordings = r.recordings;
    const recS = recordings.reduce((s, x) => s + x.length_s, 0), nSway = recordings.reduce((s, x) => s + x.n_sway, 0), move = recordings.reduce((s, x) => s + x.movement, 0);
    const stillW = recordings.reduce((s, x) => s + (x.still_ratio ?? 0) * x.length_s, 0);
    const nRe = recordings.filter(x => x.is_rerecord).length;
    Object.assign(row, { n_recordings: recordings.length, recorded_s: recS, n_rerecord: nRe, rerecord_s: recordings.reduce((s, x) => s + x.overlap_s, 0),
      n_sway: nSway, sway_per_s: recS ? nSway / recS : null, movement: move, movement_per_s: recS ? move / recS : null, still_ratio: recS ? stillW / recS : null,
      n_click: c.n_click, n_delete: c.n_delete, n_corrections: nRe + c.n_undo + c.n_click + c.n_delete });
    if (!strokes.length) say('記録（strokes）がありません');
    if (strokes.length && !strokes.every(s => typeof s.wall_ms_start === 'number')) say('記録を足す前のログなので，記録の書き始めの実時間は空欄です');
    const init = meta.mode === 'ranktrace' ? 0 : 5, P = replay(strokes, init, meta.duration || Infinity, opts.keepHead);
    const steps = ax => P[ax].map(p => [p.t, p.val]);
    seconds = secondsOf(finalEdges, { v: { steps: steps('v'), cover: r.cover.v }, a: { steps: steps('a'), cover: r.cover.a } });
    const hz = (t.csvs || []).find(x => x.suffix === '60hz.csv');
    if (!opts.keepHead && hz) {
      let bad = 0;
      for (const h of csvTable(hz.text)) {
        const tt = +h.frame / 60;
        if (h.valence !== '' && Math.abs(valueIn(P.v, tt) - +h.valence) > 1e-6) bad++;
        else if (h.arousal !== '' && Math.abs(valueIn(P.a, tt) - +h.arousal) > 1e-6) bad++;
      }
      if (bad) say(`記録から作った時系列と _60hz.csv が ${bad} フレームで食い違います（止めている間のクリック・点の削除・グラフの編集などで値が変わったため．1 秒平均は記録から作った値です）`);
    }
  }
  row.judge_s_per_video_s = rangeS > 0 ? other / 1000 / rangeS : null;
  row.corrections_per_video_s = rangeS > 0 && row.n_corrections != null ? row.n_corrections / rangeS : null;
  return { row, inputs, recordings, seconds, problems };
}

module.exports = { analyzeTrial, family, edgesOf, swayOf, replay, meanOver };
