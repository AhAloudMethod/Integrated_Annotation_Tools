// ストローク（書き込み区間の上書き）・ペン・記録オン／オフ
(() => {
  const _ = AH._;
  const { video, S, wall, vt, r2, addLog, snapshot, pushUndo, idxAt, valueIn, placePoint } = _;
  // ---------- ストローク（書き込み区間の上書き） ----------
  // 押している間（hold）または記録オン（armed）の間、再生中に値を書き込み、その区間の旧記録を上書きする。
  // 書き込みを終えた後は「その値を保つ」（既定。元の記録が次に変わる点まで続く）か「元の値に戻す」（区間の直後に上書き前の値へ戻す点を置く）。
  // 設定は「設定」パネルで選び、ブラウザに保存する。書き込みの生データは strokes に全て残す。
  _.stroke = null;
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
    if (!_.stroke) return;
    const t = _.stroke.raw.length ? vt() : _.stroke.t0;   // 最初のサンプルは書き込みの始め（聴いてから入力では区間の始め）
    if (t < _.stroke.lastT) return;
    const vals = _.M.sample();
    if (vals.pad) for (const r of vals.pad.split('+')) _.stroke.pad[r] = _.padRoleId(r);   // 機器（joy・slider）で入れた値
    const from = _.stroke.raw.length ? _.stroke.lastT : _.stroke.t0 - 1e-6;
    for (const ax of _.stroke.axes) overwriteTo(ax, from, t, r2(vals[ax]));
    const row = [t, _.stroke.axes.includes('v') ? r2(vals.v) : '', _.stroke.axes.includes('a') ? r2(vals.a) : ''];
    const last = _.stroke.raw[_.stroke.raw.length - 1];
    if (!last || last[0] !== row[0] || last[1] !== row[1] || last[2] !== row[2]) _.stroke.raw.push(row);
    _.stroke.lastT = t;
  }
  function startStroke(t0 = vt()) {
    if (_.reviewing()) return;   // 見返しの間は書き込まない
    const axes = _.M.writeAxes(); if (!axes.length) return;
    _.stroke = { before: snapshot(), axes, t0, lastT: t0, raw: [], pad: {} };
    strokeSample();
  }
  // 区間 (tEnd, restoreT) の古い点を掃除し、restoreT に上書き前の値へ戻す点を置く
  function restoreAfter(ax, beforePts, tEnd, restoreT) {
    const ps = S.data.points[ax], old = valueIn(beforePts, restoreT);
    for (let i = ps.length - 1; i >= 0; i--) if (ps[i].t > tEnd + 1e-9 && ps[i].t < restoreT - 1e-9 && !ps[i].init) ps.splice(i, 1);
    if (valueIn(ps, restoreT) !== old && !ps.some(p => Math.abs(p.t - restoreT) < 1e-9))
      ps.splice(idxAt(ps, restoreT) + 1, 0, { t: restoreT, val: old });
  }
  let afterWrite = 'hold';
  try { afterWrite = localStorage.getItem('ahann_after') === 'restore' ? 'restore' : 'hold'; } catch (_) {}
  const sel = document.getElementById('afterWrite');
  sel.value = afterWrite;
  sel.addEventListener('change', e => {
    afterWrite = e.target.value; try { localStorage.setItem('ahann_after', afterWrite); } catch (_) {}
    addLog('after_write', { value: afterWrite }); e.target.blur();
  });
  function endStroke(reason) {
    if (!_.stroke) return;
    const s = _.stroke; _.stroke = null;
    const tEnd = s.lastT, restoreT = +(tEnd + 1e-3).toFixed(4);
    if (afterWrite === 'restore' && restoreT < S.meta.duration) for (const ax of s.axes) restoreAfter(ax, s.before.points[ax], tEnd, restoreT);
    if (s.raw.length) {
      // source：input（マウス・キー）／gamepad（ジョイスティック・スライダーの値を1つでも含む）。gamepad のときは pad に役割ごとの機器名 { joy, slider }
      const pad = Object.keys(s.pad).length ? { pad: s.pad } : {};
      S.data.strokes.push({ id: S.data.strokes.length, source: pad.pad ? 'gamepad' : 'input', ...pad, axes: s.axes.join(''), t_start: s.t0, t_end: tEnd, end_reason: reason, after: afterWrite, wall_ms_end: wall(), samples: s.raw });
      pushUndo(s.before);
      addLog('stroke', { axis: s.axes.join(''), detail: `${s.t0.toFixed(4)}-${tEnd.toFixed(4)} n=${s.raw.length} end=${reason}` });
    }
    _.refresh();
  }
  const writeMode = () => (_.M && _.M.writeMode) ? _.M.writeMode() : null;


  // hold 方式の方式側から呼ぶ
  function penDown(vals) {
    if (_.reviewing()) return;
    // 聴いてから入力で止まっている間・記録している間は、クリックで点を置かずにペンだけ動かす（書き込みは記録の仕組みで行う）
    if (_.listenLive && _.listenLive()) { Object.assign(pen, vals, { down: true, clickEdit: false, listenSet: true }); _.refresh(); return; }
    Object.assign(pen, vals, { down: true, clickEdit: video.paused });
    if (video.paused && writeMode() === 'hold') {
      const before = snapshot(); let ch = false;
      for (const ax of _.M.writeAxes()) ch = placePoint(ax, vt(), r2(pen[ax])) || ch;
      if (ch) { pushUndo(before); addLog('click', { value: `${r2(pen.v)}/${r2(pen.a)}` }); }
    }
    _.refresh();
  }
  function penMove(vals) {
    if (!pen.down) return;
    Object.assign(pen, vals);
    if (_.stroke) strokeSample();
    else if (video.paused && pen.clickEdit && writeMode() === 'hold') for (const ax of _.M.writeAxes()) placePoint(ax, vt(), r2(pen[ax]));
    _.refresh();
  }
  function penUp() {
    if (!pen.down) return;
    pen.down = false; pen.clickEdit = false;
    if (writeMode() === 'hold' && !(_.listenRecording && _.listenRecording())) endStroke('release');   // 聴いてから入力の記録は区間の終わりまで続ける
    _.autosave(); _.refresh();
  }

  // force：聴いてから入力が記録を始めるとき（core/listen.js）。それ以外では、聴いてから入力の間は手で記録オンにしない
  function setArmed(on, force = false) {
    if (S.armed === on) return;
    if (on && (_.reviewing() || (!force && (writeMode() !== 'armed' || (_.listenUsable && _.listenUsable()))))) return;
    S.armed = on;
    if (!on) endStroke('disarm');
    if (_.M && _.M.onArm) _.M.onArm(on);
    addLog(on ? 'arm' : 'disarm'); _.refresh();
  }

  Object.assign(_, { getAfterWrite: () => afterWrite, pen, strokeSample, startStroke, endStroke, writeMode, penDown, penMove, penUp, setArmed });
})();
