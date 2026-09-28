// カスタム：設計軸を自由に組み合わせる（先行研究にない組み合わせも作れる）
(() => {
  const { S, pen, video } = AH;
  const { opts, live, follower, h, stored, nowRow, armHint, squareVal, circleVal, drawSquareFrame, trail, secStrip, autoNext, samRows, drawFace, heldRate, dead } = AH.ui;
  const o = () => opts();
  const follow = follower();
  const REPS = { plane: '四角平面', circle: '円', grid: '9×9グリッド', sam: 'SAMの絵', buttons: '1〜9ボタン', sliders: 'スライダー2本' };
  const nine = r => ['grid', 'sam', 'buttons'].includes(r);
  const DEF = { time: 'cont', rep: 'plane', input: 'mouse', dims: 'both', scale: 'abs', face: false, trail: true, color: false, border: false, autoNext: false };
  const P = (t, r, i, extra = {}) => ({ ...DEF, time: t, rep: r, input: i, ...extra });
  const PRESETS = {
    emujoy: ['EMuJoy 相当', P('cont', 'plane', 'mouse', { face: true })],
    feeltrace: ['FEELTRACE 相当', P('cont', 'circle', 'mouse', { color: true })],
    rcea: ['RCEA 相当（位置＝値）', P('cont', 'circle', 'mouse', { color: true, border: true, trail: false })],
    darma: ['DARMA 相当', P('cont', 'plane', 'gamepad', { trail: false })],
    throttle: ['スロットル操作 相当', P('cont', 'sliders', 'keyboard', { trail: false })],
    carma: ['CARMA 相当（快度の回）', P('cont', 'sliders', 'mouse', { dims: 'v', trail: false })],
    ranktrace: ['RankTrace 相当（快度の回）', P('cont', 'sliders', 'mouse', { dims: 'v', scale: 'rel', trail: false })],
    key: ['変化点キー 相当', P('cont', 'buttons', 'keyboard', { trail: false })],
    affectgrid: ['Affect Grid 相当', P('disc', 'grid', 'mouse', { trail: false })],
    sam: ['SAM 相当', P('disc', 'sam', 'mouse', { trail: false })],
  };
  const KEYS = Object.keys(DEF).filter(k => k !== 'autoNext');
  function normalize(x) {
    const n = { ...DEF, ...x };
    if ((nine(n.rep) || n.time === 'disc') && n.input === 'gamepad') n.input = 'mouse';
    if (!(n.rep === 'sliders' && n.time === 'cont')) n.scale = 'abs';
    return n;
  }
  const act = () => (o().dims === 'both' ? ['v', 'a'] : [o().dims]);
  const pointType = () => o().time === 'disc' || nine(o().rep);
  const rel = () => o().scale === 'rel';
  const RATE = 4;
  const kW = heldRate(['KeyW'], ['KeyS']), kUD = heldRate(['ArrowUp'], ['ArrowDown']), kAD = heldRate(['KeyD'], ['KeyA']);
  let ctrl = { v: 5, a: 5 }, dragAxis = null, sliderDrag = null, lastAxis = 'v';
  let c = null, g = null, rows = null, strip = null, note = null; const PAD = 26;

  function writeMode() {
    if (pointType()) return null;
    return o().input === 'mouse' && !rel() ? 'hold' : 'armed';
  }
  function pointAction(vals) {
    const vv = {};
    for (const ax of act()) if (vals[ax] != null) vv[ax] = AH.clamp(Math.round(vals[ax]), 1, 9);
    if (!Object.keys(vv).length) return;
    lastAxis = Object.keys(vv)[0];
    if (o().time === 'disc') {
      const s = AH.inputSec(); if (s == null) return;
      AH.setCells(s, vv, 'custom');
      if (act().every(ax => S.data.cells[ax][s] != null)) autoNext(s);
    } else {
      const before = AH.snapshot(); let ch = false;
      for (const [ax, v] of Object.entries(vv)) ch = AH.placePoint(ax, AH.vt(), v) || ch;
      if (ch) { AH.pushUndo(before); AH.addLog('input', { axis: Object.keys(vv).join(''), value: Object.values(vv).join('/') }); }
      AH.refresh();
    }
  }
  function cur(t) {
    if (o().time === 'disc') {
      const s = AH.curSec(), r = { v: S.data.cells.v[s], a: S.data.cells.a[s] };
      if (sliderDrag) r[sliderDrag.ax] = sliderDrag.val;
      return r;
    }
    if (writeMode() === 'armed') return { ...ctrl };
    if (pen.down) return { v: pen.v, a: pen.a };
    return stored(t);
  }
  function apply(patch) {
    AH.setArmed(false); AH.endStroke('option');
    const n = normalize({ ...o(), ...patch });
    for (const k of Object.keys(n)) S.meta.options[k] = n[k];
    AH.addLog('option', { detail: JSON.stringify(patch) });
    AH.remount();
  }
  function presetName() {
    const hit = Object.entries(PRESETS).find(([, [, p]]) => KEYS.every(k => p[k] === o()[k]));
    return hit ? `≒ ${hit[1][0]}` : 'プリセットに該当しない組み合わせ';
  }

  // ---- 設定欄 ----
  function config(panel) {
    const box = h('details', { class: 'planeBox cfg', open: '' }, '<summary>設計軸</summary>');
    const grid = h('div', { class: 'cfgGrid' });
    const sel = (label, key, choices) => {
      const s = h('select', { 'aria-label': label });
      for (const [v, t] of choices) { const op = h('option', { value: v }, t); if (o()[key] === v) op.selected = true; s.appendChild(op); }
      s.addEventListener('change', () => { apply({ [key]: s.value }); });
      grid.appendChild(h('span', {}, label)); grid.appendChild(s);
    };
    const ps = h('select', { 'aria-label': 'プリセット' }, '<option value="">プリセットから読み込む…</option>' + Object.entries(PRESETS).map(([k, [n]]) => `<option value="${k}">${n}</option>`).join(''));
    ps.addEventListener('change', () => { if (ps.value) apply({ ...PRESETS[ps.value][1] }); });
    box.appendChild(ps);
    sel('時間', 'time', [['cont', '連続（時刻に書き込む）'], ['disc', '区間ごと（評価区間に従う）']]);
    sel('表現', 'rep', Object.entries(REPS));
    const inputs = nine(o().rep) || o().time === 'disc' ? [['mouse', 'マウス'], ['keyboard', 'キーボード（数字）']] : [['mouse', 'マウス'], ['keyboard', 'キーボード'], ['gamepad', 'ゲームパッド']];
    sel('入力', 'input', inputs);
    sel('次元', 'dims', [['both', '2軸同時'], ['v', '快度のみ（1軸ずつの回）'], ['a', '覚醒度のみ（1軸ずつの回）']]);
    if (o().rep === 'sliders' && o().time === 'cont') sel('尺度', 'scale', [['abs', '絶対（1〜9）'], ['rel', '相対（上下限なし）']]);
    box.appendChild(grid);
    const fb = h('div', { class: 'opts' }, 'フィードバック：');
    for (const [k, l] of [['face', '顔'], ['trail', '軌跡'], ['color', '位置の色'], ['border', '画面枠の色']]) {
      const lab = h('label', {}, `<input type="checkbox"> ${l}`), cb = lab.querySelector('input');
      cb.checked = !!o()[k]; cb.addEventListener('change', () => apply({ [k]: cb.checked })); fb.appendChild(lab);
    }
    if (o().time === 'disc') { const lab = h('label', {}, '<input type="checkbox"> 入力後に次の区間へ'), cb = lab.querySelector('input'); cb.checked = !!o().autoNext; cb.addEventListener('change', () => { S.meta.options.autoNext = cb.checked; AH.addLog('option', { detail: 'autoNext=' + cb.checked }); cb.blur(); }); fb.appendChild(lab); }
    box.appendChild(fb);
    note = h('div', { class: 'cfgNote' }, presetName()); box.appendChild(note);
    panel.appendChild(box);
  }

  // ---- 入力面 ----
  function valFrom(e) {
    if (o().rep === 'circle') return circleVal(c, e, PAD);
    const v = squareVal(c, e, PAD);
    if (o().rep === 'grid') { const r = c.getBoundingClientRect(), s9 = (c.clientWidth - PAD * 2) / 9;
      return { v: AH.clamp(Math.floor((e.clientX - r.left - PAD) / s9), 0, 8) + 1, a: 9 - AH.clamp(Math.floor((e.clientY - r.top - PAD) / s9), 0, 8) }; }
    return v;
  }
  function sliderVal(e) {
    const r = c.getBoundingClientRect(), y0 = 34, y1 = r.height - 40;
    const ax = act().length === 1 ? act()[0] : (e.clientX - r.left < r.width / 2 ? 'v' : 'a');
    const f = 1 - (e.clientY - r.top - y0) / (y1 - y0);
    return { ax, val: AH.r2(AH.clamp(1 + f * 8, 1, 9)) };
  }
  function bindCanvas() {
    c.addEventListener('pointerdown', e => {
      if (o().rep === 'sliders') {
        const { ax, val } = sliderVal(e);
        if (rel()) { armHint('ホイールで上下させます'); return; }
        if (o().time === 'disc') { c.setPointerCapture(e.pointerId); sliderDrag = { ax, val }; AH.refresh(); return; }
        if (o().input !== 'mouse') { armHint('この組み合わせはキーボード／ゲームパッドで操作します'); return; }
        c.setPointerCapture(e.pointerId); dragAxis = ax; AH.penDown({ ...stored(video.currentTime), [ax]: val }); return;
      }
      if (pointType()) { pointAction(valFrom(e)); return; }
      if (o().input !== 'mouse') { armHint('この組み合わせはキーボード／ゲームパッドで操作します'); return; }
      c.setPointerCapture(e.pointerId); AH.penDown(valFrom(e));
    });
    c.addEventListener('pointermove', e => {
      if (sliderDrag) { sliderDrag.val = sliderVal(e).val; AH.refresh(); return; }
      if (!pen.down) return;
      if (o().rep === 'sliders') AH.penMove({ [dragAxis]: sliderVal(e).val }); else AH.penMove(valFrom(e));
    });
    const up = () => {
      if (sliderDrag) { const d = sliderDrag; sliderDrag = null; pointAction({ [d.ax]: d.val }); return; }
      AH.penUp(); dragAxis = null;
    };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', e => {
      if (o().rep !== 'sliders' || !rel()) return;
      e.preventDefault();
      const r = c.getBoundingClientRect(), ax = act().length === 1 ? act()[0] : (e.clientX - r.left < r.width / 2 ? 'v' : 'a');
      ctrl[ax] = AH.r2(ctrl[ax] - Math.sign(e.deltaY) * Math.min(3, Math.abs(e.deltaY) / 100) * 0.5);
    }, { passive: false });
  }

  function drawSliders(t, cv) {
    const w = c.clientWidth, H = c.clientHeight; g.clearRect(0, 0, w, H);
    const y0 = 34, y1 = H - 40;
    for (const [i, ax, name, hi, lo] of [[0, 'v', '快度', '快', '不快'], [1, 'a', '覚醒度', '覚醒', '眠気']]) {
      const on = act().includes(ax), x = act().length === 1 ? (on ? w / 2 : -999) : w * (i ? 0.72 : 0.28);
      if (x < 0) continue;
      let lo_ = 1, hi_ = 9;
      if (rel()) { const vs = [...S.data.points[ax].map(p => p.val), cv[ax] ?? 5]; lo_ = Math.min(...vs) - 1; hi_ = Math.max(...vs) + 1; }
      const Y = v => y1 - (v - lo_) / (hi_ - lo_) * (y1 - y0), col = AH.css(ax === 'v' ? '--val' : '--aro');
      g.fillStyle = AH.css('--muted'); g.font = '12px system-ui, sans-serif'; g.textAlign = 'center';
      g.fillText(name + (rel() ? '（相対）' : ''), x, 14); g.font = '10px system-ui, sans-serif';
      if (!rel()) { g.fillText(hi, x, 28); g.fillText(lo, x, H - 24); }
      g.strokeStyle = AH.css('--line'); g.lineWidth = 8; g.lineCap = 'round'; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke(); g.lineCap = 'butt';
      if (!rel()) { g.lineWidth = 1; for (let k = 1; k <= 9; k++) { g.beginPath(); g.moveTo(x - 16, Y(k)); g.lineTo(x - 9, Y(k)); g.stroke(); } }
      if (cv[ax] == null) continue;
      g.fillStyle = AH.isWriting() ? AH.css('--pen') : col; g.fillRect(x - 22, Y(cv[ax]) - 5, 44, 10);
      if (!rel()) { g.fillStyle = AH.css('--ink'); g.font = '600 14px system-ui, sans-serif'; g.fillText((+cv[ax]).toFixed(pointType() ? 0 : 2), x + (i ? 50 : -50), Y(cv[ax]) + 5); }
    }
    g.textAlign = 'left';
  }
  function drawPlaneLike(t, cv) {
    const w = c.clientWidth; let X, Y;
    if (o().rep === 'circle') {
      const R = (w - PAD * 2) / 2, cx = PAD + R, cy = PAD + R;
      X = v => cx + (v - 5) / 4 * R; Y = a => cy - (a - 5) / 4 * R;
      g.clearRect(0, 0, w, w); g.strokeStyle = AH.css('--line'); g.lineWidth = 1;
      g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
      g.setLineDash([3, 3]); g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke(); g.setLineDash([]);
      g.fillStyle = AH.css('--muted'); g.font = '11px system-ui, sans-serif'; g.textAlign = 'center';
      g.fillText('覚醒', cx, cy - R - 8); g.fillText('眠気', cx, cy + R + 16); g.textAlign = 'right'; g.fillText('不快', cx - R - 4, cy + 4); g.textAlign = 'left'; g.fillText('快', cx + R + 4, cy + 4);
    } else if (o().rep === 'grid') {
      const s9 = (w - PAD * 2) / 9; g.clearRect(0, 0, w, w);
      for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) {
        if (cv.v != null && cv.a != null && Math.round(cv.v) === i + 1 && Math.round(cv.a) === 9 - j) { g.fillStyle = AH.css('--val'); g.fillRect(PAD + i * s9, PAD + j * s9, s9, s9); }
        g.strokeStyle = AH.css('--line'); g.lineWidth = (i === 4 || j === 4) ? 1.6 : 1; g.strokeRect(PAD + i * s9, PAD + j * s9, s9, s9);
      }
      g.fillStyle = AH.css('--muted'); g.font = '11px system-ui, sans-serif'; g.textAlign = 'center';
      g.fillText('覚醒', w / 2, PAD - 8); g.fillText('眠気', w / 2, w - PAD + 16); g.textAlign = 'left'; g.fillText('不快', PAD, w - PAD + 16); g.textAlign = 'right'; g.fillText('快', w - PAD, w - PAD + 16); g.textAlign = 'left';
      return;
    } else { const q = drawSquareFrame(g, c, PAD); X = q.X; Y = q.Y; }
    if (cv.v == null || cv.a == null) return;
    const ink = AH.isWriting() ? AH.css('--pen') : AH.css('--ink');
    if (o().trail && o().time === 'cont') {
      const tr = trail(t, 1.5, 24, cv); g.strokeStyle = ink; g.lineWidth = 2;
      for (let i = 1; i < tr.length; i++) { g.globalAlpha = 0.5 * (1 - tr[i].age); g.beginPath(); g.moveTo(X(tr[i - 1].v), Y(tr[i - 1].a)); g.lineTo(X(tr[i].v), Y(tr[i].a)); g.stroke(); }
      g.globalAlpha = 1;
    }
    const col = o().color ? AH.rgba(AH.gradColor(cv.v, cv.a), 0.35 + 0.65 * AH.intensity(cv.v, cv.a)) : ink;
    if (o().face) drawFace(g, X(cv.v), Y(cv.a), cv.v, cv.a, o().color ? AH.rgba(AH.gradColor(cv.v, cv.a), 1) : ink);
    else { g.fillStyle = col; g.beginPath(); g.arc(X(cv.v), Y(cv.a), 8, 0, 7); g.fill(); if (AH.isWriting()) { g.strokeStyle = ink; g.lineWidth = 2; g.stroke(); } }
  }

  AH.register({
    id: 'custom', group: 'カスタム', label: 'カスタム（設計軸を組み合わせる）', init: { v: 5, a: 5 }, side: 'wide', animate: true,
    options: { ...DEF },
    get model() { return o().time === 'disc' ? 'table' : 'series'; },
    get unbounded() { return o().time === 'cont' && rel(); },
    isInteger: () => pointType(),
    get help() {
      const t = o().time === 'disc' ? '評価区間（ヘッダーの「評価区間」で設定）の各区間に値を1つずつ入力します。' : '時間連続で評価します。';
      let how;
      if (pointType()) how = o().time === 'disc' ? 'クリック（または数字キー：快度＝1〜9、覚醒度＝Shift+数字）で今の区間の値を設定します。<kbd>Backspace</kbd> で今の区間を消去。' : 'クリック（または数字キー）でその時刻に変化点を置きます。<kbd>Backspace</kbd> で直前の変化点を削除。';
      else if (writeMode() === 'hold') how = '再生中に押している間だけ記録・上書きします。一時停止中のクリックはその時刻に変化点を1つ置きます。';
      else {
        const keys = o().input === 'keyboard' ? (o().rep === 'sliders' ? '<kbd>W</kbd>/<kbd>S</kbd>＝快度、<kbd>↑</kbd>/<kbd>↓</kbd>＝覚醒度。' : '<kbd>A</kbd>/<kbd>D</kbd>＝快度、<kbd>W</kbd>/<kbd>S</kbd>＝覚醒度。')
          : o().input === 'gamepad' ? (o().rep === 'sliders' ? '左スティック上下＝快度、右スティック上下＝覚醒度。' : 'スティックの位置＝値（離すと中性）。') : 'ホイールで上下させます（上下限なし）。';
        how = `記録オン（<kbd>R</kbd>）の間、再生中の値を記録・上書きします。${keys}`;
      }
      return `<p>${t}${how}</p>`;
    },
    writeMode,
    writeAxes() { const a = act(); return o().rep === 'sliders' && writeMode() === 'hold' ? a.filter(x => x === dragAxis) : a; },
    sample: () => (writeMode() === 'hold' ? pen : ctrl),
    mount({ panel, overlay, under }) {
      Object.assign(S.meta.options, normalize(S.meta.options));
      config(panel);
      const box = h('div', { class: 'planeBox' });
      rows = null; c = null; g = null;
      if (o().rep === 'sam' || o().rep === 'buttons') {
        if (o().rep === 'sam') { const sb = h('div', { class: 'planeBox sam' }); rows = samRows(sb, (ax, i) => pointAction({ [ax]: i }), act()); panel.appendChild(sb); }
        else {
          rows = {};
          for (const [ax, name] of [['v', '快度'], ['a', '覚醒度']]) {
            if (!act().includes(ax)) continue;
            const r = h('div', { class: 'axis ' + ax }, `<h2><span>${name}</span></h2><div class="keys"></div><div class="ends"><span>${ax === 'v' ? '不快' : '眠気'}</span><span>${ax === 'v' ? '快' : '覚醒'}</span></div>`);
            const kc = r.querySelector('.keys');
            for (let i = 1; i <= 9; i++) kc.appendChild(h('button', { 'data-v': i, onclick: e => { pointAction({ [ax]: i }); e.currentTarget.blur(); } }, String(i)));
            box.appendChild(r); rows[ax] = kc;
          }
        }
      } else {
        c = h('canvas', { class: o().rep === 'sliders' ? 'bars' : 'plane', 'aria-label': REPS[o().rep] });
        box.appendChild(c); bindCanvas();
      }
      panel.appendChild(box);
      const nr = nowRow(box); this._now = nr;
      if (rel()) box.querySelector('.nowRow').hidden = true;   // 相対尺度では数値を見せない
      strip = o().time === 'disc' ? secStrip(under) : null;
    },
    resize() { if (c) g = AH.fitCanvas(c); },
    tick(dt) {
      if (writeMode() !== 'armed') return;
      if (follow()) ctrl = stored(video.currentTime);
      const inp = o().input, circ = o().rep === 'circle', sl = o().rep === 'sliders';
      const clampV = x => (rel() ? x : AH.clamp(x, 1, 9));
      if (inp === 'keyboard') {
        const dv = sl ? kW.dir() : kAD.dir(), da = sl ? kUD.dir() : kW.dir();
        ctrl.v = AH.r2(clampV(ctrl.v + dv * RATE * dt)); ctrl.a = AH.r2(clampV(ctrl.a + da * RATE * dt));
      } else if (inp === 'gamepad') {
        const gp = AH.gamepad(); if (!gp) return;
        if (sl) { ctrl.v = AH.r2(clampV(ctrl.v - dead(gp.axes[1] || 0) * RATE * dt)); ctrl.a = AH.r2(clampV(ctrl.a - dead(gp.axes[3] || 0) * RATE * dt)); }
        else { ctrl.v = AH.r2(5 + dead(gp.axes[0] || 0) * 4); ctrl.a = AH.r2(5 - dead(gp.axes[1] || 0) * 4); }
      }
      if (circ) { const dx = (ctrl.v - 5) / 4, dy = (ctrl.a - 5) / 4, d = Math.hypot(dx, dy); if (d > 1) { ctrl.v = AH.r2(5 + dx / d * 4); ctrl.a = AH.r2(5 + dy / d * 4); } }
    },
    onKey(e) {
      const m = e.code.match(/^(Digit|Numpad)([1-9])$/);
      if (m && pointType()) { const ax = act().length === 1 ? act()[0] : (m[1] === 'Numpad' || e.shiftKey ? 'a' : 'v'); pointAction({ [ax]: +m[2] }); return true; }
      if (e.code === 'Backspace' && pointType()) {
        if (o().time === 'disc') { const vv = {}; for (const ax of act()) vv[ax] = null; const s = AH.inputSec(); if (s != null) AH.setCells(s, vv, 'clear'); }
        else { const p = AH.deletePointBefore(lastAxis, AH.vt()); if (p) { AH.addLog('delete', { axis: lastAxis, value: p.val, detail: 'at ' + p.t }); AH.refresh(); } }
        return true;
      }
      if (writeMode() === 'armed' && o().input === 'keyboard') {
        const hit = kW.key(e, true) || kUD.key(e, true) || kAD.key(e, true);
        return hit;
      }
      return false;
    },
    onKeyUp(e) { kW.key(e, false); kUD.key(e, false); kAD.key(e, false); },
    onBlur() { kW.clear(); kUD.clear(); kAD.clear(); },
    update(t) {
      const cv = cur(t);
      if (c && g) { if (o().rep === 'sliders') drawSliders(t, cv); else drawPlaneLike(t, cv); }
      if (rows) for (const ax of Object.keys(rows)) for (const b of rows[ax].children) b.classList.toggle('on', cv[ax] != null && +b.dataset.v === Math.round(cv[ax]));
      if (this._now) this._now({ v: cv.v ?? NaN, a: cv.a ?? NaN });
      const st = document.getElementById('stage');
      if (o().border && cv.v != null && cv.a != null && !rel()) {
        const it = AH.intensity(cv.v, cv.a);
        st.style.boxShadow = `0 0 0 8px ${it > 0.02 ? AH.rgba(AH.quadColor(cv.v, cv.a), 0.25 + 0.75 * it) : 'transparent'}`;
      } else st.style.boxShadow = '';
      if (strip) strip();
    },
  });
})();
