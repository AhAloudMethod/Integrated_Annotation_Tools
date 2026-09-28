// 各入力方式。原典の仕様と改変点は README.md の対応表を参照。
(() => {
  const { S, pen, video } = AH;
  const opts = () => S.meta.options;
  // 操作が値に反映される状態か：記録オン、または動画を開く前の練習中
  const live = () => S.armed || !AH.hasVideo();

  // ---------- 小道具 ----------
  function h(tag, attrs = {}, html = '') {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
    }
    if (html) e.innerHTML = html;
    return e;
  }
  const stored = t => ({ v: AH.valueAt('v', t), a: AH.valueAt('a', t) });
  const shown = t => (pen.down ? { v: pen.v, a: pen.a } : stored(t));
  function nowRow(parent) {
    const r = h('div', { class: 'nowRow' }, '<span class="v">快度 <b>5.00</b></span><span class="a">覚醒度 <b>5.00</b></span>');
    parent.appendChild(r);
    const f = x => (x == null || isNaN(x) ? '–' : (+x).toFixed(2));
    return c => { const b = r.querySelectorAll('b'); b[0].textContent = f(c.v); b[1].textContent = f(c.a); };
  }
  function toggle(parent, key, label) {
    const l = h('label', {}, `<input type="checkbox"> ${label}`), cb = l.querySelector('input');
    cb.checked = !!opts()[key];
    cb.addEventListener('change', () => { AH.setOption(key, cb.checked); cb.blur(); });
    parent.appendChild(l); return cb;
  }
  function armHint(msg = '記録オフです。R キー（またはゲームパッドのAボタン）で記録を始めます') {
    const el = document.getElementById('hint'); el.textContent = msg; el.hidden = false;
    clearTimeout(armHint.tm); armHint.tm = setTimeout(() => { el.hidden = true; }, 2500);
  }
  // 平面キャンバス：座標 ↔ 値（x=快度、y=覚醒度）
  function square(c, pad) { const w = c.clientWidth; return { x0: pad, y0: pad, s: w - pad * 2, X: v => pad + (v - 1) / 8 * (w - pad * 2), Y: a => pad + (1 - (a - 1) / 8) * (w - pad * 2) }; }
  function squareVal(c, e, pad) {
    const r = c.getBoundingClientRect(), g = square(c, pad);
    const fx = AH.clamp((e.clientX - r.left - g.x0) / g.s, 0, 1), fy = AH.clamp((e.clientY - r.top - g.y0) / g.s, 0, 1);
    return { v: AH.r2(1 + fx * 8), a: AH.r2(1 + (1 - fy) * 8) };
  }
  function circleVal(c, e, pad) {   // 円の外は円周に吸着
    const r = c.getBoundingClientRect(), R = (c.clientWidth - pad * 2) / 2;
    let dx = (e.clientX - r.left - pad - R) / R, dy = -(e.clientY - r.top - pad - R) / R;
    const d = Math.hypot(dx, dy); if (d > 1) { dx /= d; dy /= d; }
    return { v: AH.r2(5 + dx * 4), a: AH.r2(5 + dy * 4) };
  }
  function bindHold(c, toVal) {
    c.addEventListener('pointerdown', e => { c.setPointerCapture(e.pointerId); AH.penDown(toVal(e)); });
    c.addEventListener('pointermove', e => AH.penMove(toVal(e)));
    c.addEventListener('pointerup', () => AH.penUp());
    c.addEventListener('pointercancel', () => AH.penUp());
  }
  function planeCanvas(parent, aria) {
    const box = h('div', { class: 'planeBox' }), c = h('canvas', { class: 'plane', 'aria-label': aria });
    box.appendChild(c); parent.appendChild(box); return { box, c };
  }
  function drawSquareFrame(g, c, pad, labels = true) {
    const w = c.clientWidth, q = square(c, pad);
    g.clearRect(0, 0, w, w);
    g.strokeStyle = AH.css('--line'); g.lineWidth = 1; g.strokeRect(q.x0, q.y0, q.s, q.s);
    g.setLineDash([3, 3]); g.beginPath();
    g.moveTo(q.X(5), q.y0); g.lineTo(q.X(5), q.y0 + q.s); g.moveTo(q.x0, q.Y(5)); g.lineTo(q.x0 + q.s, q.Y(5)); g.stroke(); g.setLineDash([]);
    if (labels) {
      g.fillStyle = AH.css('--muted'); g.font = '11px system-ui, sans-serif';
      g.textAlign = 'center'; g.fillText('覚醒', q.X(5), q.y0 - 7); g.fillText('眠気', q.X(5), q.y0 + q.s + 14);
      g.textAlign = 'left'; g.fillText('不快', q.x0, q.y0 + q.s + 14);
      g.textAlign = 'right'; g.fillText('快', q.x0 + q.s, q.y0 + q.s + 14); g.textAlign = 'left';
    }
    return q;
  }
  // 過去 sec 秒の軌跡を点列で返す
  function trail(t, sec, n, cur) {
    const out = [];
    for (let i = n; i >= 1; i--) { const tt = Math.max(0, t - sec * i / n); out.push({ ...stored(tt), age: i / n }); }
    out.push({ ...cur, age: 0 }); return out;
  }

  // 1秒ごとの入力状況の帯（AffectGrid・SAM）
  function secStrip(under) {
    const wrap = h('div', { class: 'strip' }); under.appendChild(wrap);
    let sig = '';
    function build() {
      sig = AH.rangeSig(); wrap.innerHTML = '';
      for (let s = 0; s < AH.nSec(); s++) {
        const c = h('button', { class: 'sc', title: '区間 ' + s + '（' + AH.secLabel(s) + '）', onclick: e => { AH.seekTo(AH.binStart(s) + 0.001); e.currentTarget.blur(); } },
          `<span class="lab">${AH.secLabel(s)}</span><span class="v">–</span><span class="a">–</span>`);
        wrap.appendChild(c);
      }
    }
    return () => {
      if (!S.meta.duration) return;
      if (sig !== AH.rangeSig()) build();
      const cur = AH.curSec();
      [...wrap.children].forEach((c, s) => {
        c.classList.toggle('cur', s === cur);
        c.querySelector('.v').textContent = S.data.cells.v[s] ?? '–';
        c.querySelector('.a').textContent = S.data.cells.a[s] ?? '–';
        c.classList.toggle('done', S.data.cells.v[s] != null && S.data.cells.a[s] != null);
      });
      const cc = wrap.children[cur];
      if (cc && !video.paused) cc.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
  }
  const setBoth = (s, v, a, how) => AH.setCells(s, { v, a }, how);
  function autoNext(s) { if (opts().autoNext && s + 1 < AH.nSec()) AH.seekTo(AH.binStart(s + 1) + 0.001); }

  // SAM の絵：annotator/sam/ に原典の画像（valence_figure_1〜5.png、arousal_figure_1〜5.png）があればそれを使い、なければ簡略版を描く
  // 番号は 1＝不快・穏やか → 5＝快・興奮（ツールの1〜9と同じ向き）
  const samSrc = (ax, lv) => `sam/${ax === 'v' ? 'valence' : 'arousal'}_figure_${lv}.png`;
  const SAM_IMG = { v: false, a: false };
  for (const ax of ['v', 'a']) {
    let ok = 0;
    for (let lv = 1; lv <= 5; lv++) {
      const im = new Image();
      im.onload = () => { if (++ok === 5) { SAM_IMG[ax] = true; const m = AH.mode; if (m && (m.id === 'sam' || (m.id === 'custom' && opts().rep === 'sam'))) AH.remount(); } };
      im.src = samSrc(ax, lv);
    }
  }
  // 5体のマネキン（奇数位置）と間の4つの小円（偶数位置）
  function manikin(kind, lv) {   // lv 1..5
    const k = (lv - 3) / 2;      // -1..1
    let face = '', extra = '';
    if (kind === 'v') {          // 口角が上下（左＝不快の渋面 → 右＝快の笑顔）
      face = `<circle cx="16" cy="11" r="1.6"/><circle cx="24" cy="11" r="1.6"/><path d="M14 ${17 - k * 1.5} Q20 ${17 + k * 6} 26 ${17 - k * 1.5}" fill="none" stroke-width="1.8"/>`;
    } else {                     // 目が開き、胸の爆発が大きくなる（左＝眠気 → 右＝覚醒）
      const eh = 0.3 + (lv - 1) * 0.55;
      face = `<ellipse cx="16" cy="11" rx="1.9" ry="${eh}"/><ellipse cx="24" cy="11" rx="1.9" ry="${eh}"/><path d="M17 17.5 H23" fill="none" stroke-width="1.6"/>`;
      const r = 1.5 + (lv - 1) * 2, pts = [];
      for (let i = 0; i < 16; i++) { const rr = i % 2 ? r * 0.45 : r, an = i * Math.PI / 8; pts.push(`${(20 + Math.cos(an) * rr).toFixed(2)},${(37 + Math.sin(an) * rr).toFixed(2)}`); }
      extra = `<polygon points="${pts.join(' ')}" class="burst"/>`;
    }
    return `<svg viewBox="0 0 40 48" aria-hidden="true"><circle cx="20" cy="12" r="10" class="body"/><path d="M7 47 Q7 26 20 24 Q33 26 33 47 Z" class="body"/>${extra}${face}</svg>`;
  }
  const samFig = (ax, lv) => (SAM_IMG[ax] ? `<img src="${samSrc(ax, lv)}" alt="">` : manikin(ax, lv));
  // SAM の2行（9段階）。onPick(ax, i)
  function samRows(parent, onPick, axes = ['v', 'a']) {
    const rows = {};
    for (const [ax, name, lo, hi] of [['v', '快度', '不快', '快'], ['a', '覚醒度', '眠気', '覚醒']]) {
      if (!axes.includes(ax)) continue;
      const row = h('div', { class: 'samRow ' + ax }, `<div class="samHead">${name}</div>`), btns = h('div', { class: 'samBtns' });
      for (let i = 1; i <= 9; i++) {
        btns.appendChild(h('button', { 'data-v': i, 'aria-label': `${name} ${i}`, onclick: e => { onPick(ax, i); e.currentTarget.blur(); } },
          i % 2 ? samFig(ax, (i + 1) / 2) : '<span class="dot"></span>'));
      }
      row.appendChild(btns); row.appendChild(h('div', { class: 'ends' }, `<span>${lo}</span><span>${hi}</span>`));
      parent.appendChild(row); rows[ax] = btns;
    }
    return rows;
  }

  // EMuJoy 風の顔（目＝覚醒度、口＝快度）
  function drawFace(g, x, y, v, a, col) {
    const R = 15;
    g.fillStyle = AH.css('--panel'); g.strokeStyle = col; g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, R, 0, 7); g.fill(); g.stroke();
    const eh = 0.5 + (a - 1) / 8 * 4.5; g.fillStyle = col;
    for (const dx of [-5.5, 5.5]) { g.beginPath(); g.ellipse(x + dx, y - 4, 2.4, eh, 0, 0, 7); g.fill(); }
    const cv = (v - 5) / 4 * 6;
    g.beginPath(); g.moveTo(x - 7, y + 6); g.quadraticCurveTo(x, y + 6 + cv * 1.6, x + 7, y + 6); g.stroke();
  }

  // 連続値を押し続けて動かす操作（スロットル・CARMA・RankTrace）：記録オフの間は記録値に追従する
  function heldRate(keysUp, keysDown) {
    const held = new Set();
    return {
      key(e, down) { if (keysUp.includes(e.code) || keysDown.includes(e.code)) { down ? held.add(e.code) : held.delete(e.code); return true; } return false; },
      dir() { let d = 0; for (const k of held) d += keysUp.includes(k) ? 1 : -1; return AH.clamp(d, -1, 1); },
      any() { return held.size > 0; }, clear() { held.clear(); },
    };
  }
  const dead = x => (Math.abs(x) < 0.08 ? 0 : x);

  // =====================================================================
  // 時間連続・2次元
  // =====================================================================

  // ---- 変化点キー（本研究の試作） ----
  (() => {
    let lastAxis = 'v', els = {};
    function setValue(axis, val) {
      lastAxis = axis;
      const before = AH.snapshot();
      if (!AH.placePoint(axis, AH.vt(), val)) { AH.addLog('input_same', { axis, value: val }); return; }
      AH.pushUndo(before); AH.addLog('input', { axis, value: val }); AH.refresh();
    }
    AH.register({
      id: 'key', group: '時間連続・2次元', label: '変化点キー（試作）', model: 'series', init: { v: 5, a: 5 }, side: 'narrow', integer: true,
      help: '<p>値が変わったと思った瞬間に数字を押すと、その時刻から次の変化点までその値が続きます。<kbd>1</kbd>〜<kbd>9</kbd> 快度、<kbd>Shift</kbd>+数字またはテンキーで覚醒度。<kbd>Backspace</kbd> 直前の変化点を削除（枠が濃いほうの軸）。</p>',
      mount({ panel }) {
        for (const [ax, name, keys, lo, hi] of [['v', '快度', 'キー 1〜9', '不快', '快'], ['a', '覚醒度', 'Shift+1〜9', '眠気', '覚醒']]) {
          const box = h('div', { class: 'axis ' + ax }, `<h2><span>${name}</span><span class="time">${keys}</span></h2><div class="now">5</div><div class="keys"></div><div class="ends"><span>${lo}</span><span>中立</span><span>${hi}</span></div>`);
          const kc = box.querySelector('.keys');
          for (let i = 1; i <= 9; i++) kc.appendChild(h('button', { 'data-v': i, onclick: e => { setValue(ax, i); e.currentTarget.blur(); } }, String(i)));
          panel.appendChild(box); els[ax] = box;
        }
      },
      update(t) {
        for (const ax of ['v', 'a']) {
          const val = AH.valueAt(ax, t), b = els[ax]; if (!b) continue;
          b.querySelector('.now').textContent = val;
          for (const k of b.querySelectorAll('.keys button')) k.classList.toggle('on', +k.dataset.v === val);
          b.classList.toggle('target', lastAxis === ax);
        }
      },
      onKey(e) {
        const m = e.code.match(/^(Digit|Numpad)([1-9])$/);
        if (m) { setValue(m[1] === 'Numpad' || e.shiftKey ? 'a' : 'v', +m[2]); return true; }
        if (e.code === 'Backspace') { const p = AH.deletePointBefore(lastAxis, AH.vt()); if (p) { AH.addLog('delete', { axis: lastAxis, value: p.val, detail: 'at ' + p.t }); AH.refresh(); } return true; }
        return false;
      },
    });
  })();

  // ---- EMuJoy（四角い平面・顔・尾） ----
  (() => {
    let c, g, now; const PAD = 22;
    AH.register({
      id: 'emujoy', group: '時間連続・2次元', label: 'EMuJoy（マウス・四角平面）', model: 'series', init: { v: 5, a: 5 }, side: 'wide',
      options: { face: true, tail: true },
      writeMode: () => 'hold', writeAxes: () => ['v', 'a'], sample: () => pen,
      help: '<p>再生中に平面上でボタンを押している間だけ記録され、その区間は前の記録を上書きします。押さずに再生すれば見直すだけです。一時停止中のクリックはその時刻に変化点を1つ置きます。</p>',
      mount({ panel }) {
        ({ c } = planeCanvas(panel, '快度・覚醒度の平面')); now = nowRow(c.parentNode);
        const o = h('div', { class: 'opts' }); toggle(o, 'face', '顔'); toggle(o, 'tail', '軌跡'); c.parentNode.appendChild(o);
        bindHold(c, e => squareVal(c, e, PAD));
      },
      resize() { g = AH.fitCanvas(c); },
      update(t) {
        if (!g) return;
        const q = drawSquareFrame(g, c, PAD), cur = shown(t), col = AH.isWriting() ? AH.css('--pen') : AH.css('--ink');
        if (opts().tail) {
          const tr = trail(t, 1.5, 24, cur); g.strokeStyle = col; g.lineWidth = 2;
          for (let i = 1; i < tr.length; i++) { g.globalAlpha = 0.6 * (1 - tr[i].age); g.beginPath(); g.moveTo(q.X(tr[i - 1].v), q.Y(tr[i - 1].a)); g.lineTo(q.X(tr[i].v), q.Y(tr[i].a)); g.stroke(); }
          g.globalAlpha = 1;
        }
        if (opts().face) drawFace(g, q.X(cur.v), q.Y(cur.a), cur.v, cur.a, col);
        else { g.fillStyle = col; g.beginPath(); g.arc(q.X(cur.v), q.Y(cur.a), 6, 0, 7); g.fill(); }
        now(cur);
      },
    });
  })();

  // ---- FEELTRACE（円形・位置の色・感情語・縮む円の軌跡） ----
  (() => {
    let c, g, now; const PAD = 30;
    // 感情語の目印（角度: 0=快, 90=高覚醒）。原典の英語の語と配置は論文系/FEELTRACE の図で要確認
    const WORDS = [[20, '喜び'], [55, '興奮'], [100, '驚き'], [125, '恐れ'], [145, '怒り'], [165, '苛立ち'],
                   [200, '悲しみ'], [225, '憂鬱'], [250, '退屈'], [295, '穏やか'], [320, 'くつろぎ'], [340, '満足']];
    AH.register({
      id: 'feeltrace', group: '時間連続・2次元', label: 'FEELTRACE（マウス・円形）', model: 'series', init: { v: 5, a: 5 }, side: 'wide',
      writeMode: () => 'hold', writeAxes: () => ['v', 'a'], sample: () => pen,
      help: '<p>中央が中性、円周が最大強度です。再生中に円の中でボタンを押している間だけ記録・上書きします。円の外に出たカーソルは円周に吸着します。</p>',
      mount({ panel }) {
        ({ c } = planeCanvas(panel, 'FEELTRACE の円')); now = nowRow(c.parentNode);
        bindHold(c, e => circleVal(c, e, PAD));
      },
      resize() { g = AH.fitCanvas(c); },
      update(t) {
        if (!g) return;
        const w = c.clientWidth, R = (w - PAD * 2) / 2, cx = PAD + R, cy = PAD + R;
        const X = v => cx + (v - 5) / 4 * R, Y = a => cy - (a - 5) / 4 * R;
        g.clearRect(0, 0, w, w);
        g.strokeStyle = AH.css('--line'); g.lineWidth = 1;
        g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
        g.setLineDash([3, 3]); g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke(); g.setLineDash([]);
        g.fillStyle = AH.css('--muted'); g.font = '11px system-ui, sans-serif'; g.textAlign = 'center';
        g.fillText('とても活発', cx, cy - R - 8); g.fillText('とても受動的', cx, cy + R + 16);
        g.save(); g.translate(cx + R + 12, cy); g.rotate(Math.PI / 2); g.fillText('とても肯定的', 0, 0); g.restore();
        g.save(); g.translate(cx - R - 12, cy); g.rotate(-Math.PI / 2); g.fillText('とても否定的', 0, 0); g.restore();
        for (const [deg, wd] of WORDS) { const r = deg * Math.PI / 180; g.fillText(wd, cx + Math.cos(r) * R * 0.72, cy - Math.sin(r) * R * 0.72 + 4); }
        g.textAlign = 'left';
        const cur = shown(t);
        for (const p of trail(t, 2, 8, cur)) {   // 過去の位置を縮む円で
          const col = AH.gradColor(p.v, p.a), al = 0.25 + 0.75 * AH.intensity(p.v, p.a);
          g.fillStyle = AH.rgba(col, p.age ? 0.5 * al * (1 - p.age) : al);
          g.beginPath(); g.arc(X(p.v), Y(p.a), p.age ? 9 * (1 - p.age) + 2 : 10, 0, 7); g.fill();
        }
        if (AH.isWriting()) { g.strokeStyle = AH.css('--pen'); g.lineWidth = 2; g.beginPath(); g.arc(X(cur.v), Y(cur.a), 12, 0, 7); g.stroke(); }
        now(cur);
      },
    });
  })();

  // ---- RCEA（動画右下の円形仮想ジョイスティック・象限色・画面枠の色） ----
  (() => {
    let pad, g, now; const PAD = 6;
    const spring = () => !!opts().spring;
    AH.register({
      id: 'rcea', group: '時間連続・2次元', label: 'RCEA（動画上の円形ジョイスティック）', model: 'series', init: { v: 5, a: 5 }, side: 'normal',
      options: { spring: false },
      writeMode: () => (spring() ? 'armed' : 'hold'), writeAxes: () => ['v', 'a'],
      sample: () => (spring() && !pen.down ? { v: 5, a: 5 } : pen),
      help: '<p>動画右下の円を押して動かします。画面の枠の色が今の象限（黄＝高覚醒・快、赤＝高覚醒・不快、青＝低覚醒・不快、緑＝低覚醒・快）を示し、濃さが強度です。「離すと中心へ」をオンにすると、記録オン（R）の間は押していなければ中性が記録されます。</p>',
      mount({ panel, overlay }) {
        const box = h('div', { class: 'rceaPad' }); pad = h('canvas', { 'aria-label': 'RCEA 仮想ジョイスティック' }); box.appendChild(pad); overlay.appendChild(box);
        const info = h('div', { class: 'planeBox' }); panel.appendChild(info); now = nowRow(info);
        const o = h('div', { class: 'opts' }); toggle(o, 'spring', '離すと中心へ'); info.appendChild(o);
        bindHold(pad, e => circleVal(pad, e, PAD));
      },
      resize() { g = AH.fitCanvas(pad); },
      update(t) {
        if (!g) return;
        const w = pad.clientWidth, R = (w - PAD * 2) / 2, cx = PAD + R, cy = PAD + R;
        const cur = pen.down ? { v: pen.v, a: pen.a } : (spring() ? { v: 5, a: 5 } : stored(t));
        g.clearRect(0, 0, w, w);
        const qs = [['hh', -Math.PI / 2, 0], ['hl', Math.PI, 1.5 * Math.PI], ['ll', Math.PI / 2, Math.PI], ['lh', 0, Math.PI / 2]];
        for (const [k, a0, a1] of qs) {
          const col = AH.quadColor(k[1] === 'h' ? 9 : 1, k[0] === 'h' ? 9 : 1);
          g.fillStyle = AH.rgba(col, 0.35); g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0, a1); g.closePath(); g.fill();
        }
        g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
        const x = cx + (cur.v - 5) / 4 * R, y = cy - (cur.a - 5) / 4 * R;
        g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(x, y, 12, 0, 7); g.fill();
        g.strokeStyle = AH.isWriting() ? AH.css('--pen') : 'rgba(0,0,0,.5)'; g.lineWidth = 2; g.stroke();
        const it = AH.intensity(cur.v, cur.a);
        document.getElementById('stage').style.boxShadow = it > 0.02 ? `0 0 0 8px ${AH.rgba(AH.quadColor(cur.v, cur.a), 0.25 + 0.75 * it)}` : '0 0 0 8px transparent';
        now(cur);
      },
    });
  })();

  // ---- DARMA（物理ジョイスティック） ----
  (() => {
    let c, g, now, stat; const PAD = 22;
    const ctrl = { v: 5, a: 5 }; let mouseDown = false, hasPad = false;
    AH.register({
      id: 'darma', group: '時間連続・2次元', label: 'DARMA（ゲームパッド／ジョイスティック）', model: 'series', init: { v: 5, a: 5 }, side: 'wide', animate: true,
      writeMode: () => 'armed', writeAxes: () => ['v', 'a'], sample: () => ctrl,
      help: '<p>スティックの位置がそのまま値です（離すと中性に戻ります）。記録オン（<kbd>R</kbd> またはAボタン）の間、再生中の値を記録・上書きします。ゲームパッドがない場合は平面をマウスで押して代用できます（離すと中性）。</p>',
      mount({ panel }) {
        ({ c } = planeCanvas(panel, 'DARMA の平面')); now = nowRow(c.parentNode);
        stat = h('div', { class: 'opts' }); c.parentNode.appendChild(stat);
        c.addEventListener('pointerdown', e => { mouseDown = true; c.setPointerCapture(e.pointerId); Object.assign(ctrl, squareVal(c, e, PAD)); });
        c.addEventListener('pointermove', e => { if (mouseDown) Object.assign(ctrl, squareVal(c, e, PAD)); });
        const up = () => { mouseDown = false; if (!hasPad) Object.assign(ctrl, { v: 5, a: 5 }); };
        c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
      },
      resize() { g = AH.fitCanvas(c); },
      tick() {
        const gp = AH.gamepad(); hasPad = !!gp;
        if (gp && !mouseDown) { ctrl.v = AH.r2(5 + dead(gp.axes[0] || 0) * 4); ctrl.a = AH.r2(5 - dead(gp.axes[1] || 0) * 4); }
      },
      update(t) {
        if (!g) return;
        const q = drawSquareFrame(g, c, PAD), st = stored(t);
        g.fillStyle = AH.css('--muted'); g.beginPath(); g.arc(q.X(st.v), q.Y(st.a), 5, 0, 7); g.fill();   // 記録値
        g.strokeStyle = AH.isWriting() ? AH.css('--pen') : AH.css('--ink'); g.lineWidth = 2;               // 入力中の位置
        g.beginPath(); g.arc(q.X(ctrl.v), q.Y(ctrl.a), 9, 0, 7); g.stroke();
        stat.textContent = hasPad ? 'ゲームパッド接続中（● 記録値　○ スティック）' : 'ゲームパッド未接続：何かボタンを押すと認識されます（マウスで代用可）';
        now(AH.isWriting() || !AH.hasVideo() ? ctrl : st);
      },
    });
  })();

  // ---- Full Throttle の操作（快度・覚醒度を両手で1軸ずつ） ----
  (() => {
    let c, g; const ctrl = { v: 5, a: 5 }; const RATE = 4;
    const kv = heldRate(['KeyW'], ['KeyS']), ka = heldRate(['ArrowUp'], ['ArrowDown']);
    AH.register({
      id: 'throttle', group: '時間連続・2次元', label: 'スロットル操作（両手・1軸ずつ）', model: 'series', init: { v: 5, a: 5 }, side: 'normal', animate: true,
      writeMode: () => 'armed', writeAxes: () => ['v', 'a'], sample: () => ctrl,
      onArm(on) { if (on) Object.assign(ctrl, stored(video.currentTime)); },
      help: '<p>左手 <kbd>W</kbd>/<kbd>S</kbd> で快度、右手 <kbd>↑</kbd>/<kbd>↓</kbd> で覚醒度のレバーを上下します（押している間動き、離すとその位置に留まります）。ゲームパッドは左スティック上下＝快度、右スティック上下＝覚醒度。記録オン（<kbd>R</kbd>）の間、再生中の値を記録・上書きします。</p>',
      mount({ panel }) { const box = h('div', { class: 'planeBox' }); c = h('canvas', { class: 'bars', 'aria-label': 'スロットル' }); box.appendChild(c); panel.appendChild(box); },
      resize() { g = AH.fitCanvas(c); },
      tick(dt) {
        if (!live()) { Object.assign(ctrl, stored(video.currentTime)); return; }
        const gp = AH.gamepad();
        const dv = kv.dir() || -dead(gp?.axes[1] || 0), da = ka.dir() || -dead(gp?.axes[3] || 0);
        ctrl.v = AH.r2(AH.clamp(ctrl.v + dv * RATE * dt, 1, 9)); ctrl.a = AH.r2(AH.clamp(ctrl.a + da * RATE * dt, 1, 9));
      },
      onKey(e) { const hit = kv.key(e, true) || ka.key(e, true); if (hit && !live()) armHint(); return hit; },
      onKeyUp(e) { kv.key(e, false); ka.key(e, false); },
      onBlur() { kv.clear(); ka.clear(); },
      update() {
        if (!g) return;
        const w = c.clientWidth, H = c.clientHeight; g.clearRect(0, 0, w, H);
        const bars = [['快度', 'W / S', ctrl.v, AH.css('--val'), '快', '不快'], ['覚醒度', '↑ / ↓', ctrl.a, AH.css('--aro'), '覚醒', '眠気']];
        bars.forEach(([name, keys, val, col, hi, lo], i) => {
          const x = w * (i ? 0.72 : 0.28), y0 = 34, y1 = H - 40, Y = v => y1 - (v - 1) / 8 * (y1 - y0);
          g.fillStyle = AH.css('--muted'); g.font = '12px system-ui, sans-serif'; g.textAlign = 'center';
          g.fillText(name, x, 14); g.fillText(keys, x, H - 8); g.font = '10px system-ui, sans-serif'; g.fillText(hi, x, 28); g.fillText(lo, x, H - 24);
          g.strokeStyle = AH.css('--line'); g.lineWidth = 8; g.lineCap = 'round'; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke();
          g.strokeStyle = col; g.beginPath(); g.moveTo(x, Y(5)); g.lineTo(x, Y(val)); g.stroke(); g.lineCap = 'butt';
          g.fillStyle = AH.isWriting() ? AH.css('--pen') : col; g.fillRect(x - 22, Y(val) - 5, 44, 10);
          g.fillStyle = AH.css('--ink'); g.font = '600 14px system-ui, sans-serif'; g.fillText(val.toFixed(2), x + (i ? 50 : -50), Y(val) + 5);
        });
        g.textAlign = 'left';
      },
    });
  })();

  // ---- HaloLight / Gradient HaloLight（色の円） ----
  (() => {
    let c, g, halo, now; const PAD = 14;
    AH.register({
      id: 'halolight', group: '時間連続・2次元', label: 'HaloLight（色の円）', model: 'series', init: { v: 5, a: 5 }, side: 'normal',
      options: { gradient: true },
      writeMode: () => 'hold', writeAxes: () => ['v', 'a'], sample: () => pen,
      help: '<p>右の入力面を押して動かすと、動画下部の円の色（黄＝高覚醒・快、赤＝高覚醒・不快、青＝低覚醒・不快、緑＝低覚醒・快）と濃さ（強度）が変わります。再生中に押している間だけ記録・上書きします。「グラデーション」オンで Gradient HaloLight（隣接2象限の色を混ぜる）。</p>',
      mount({ panel, overlay }) {
        halo = h('div', { class: 'halo' }); overlay.appendChild(halo);
        ({ c } = planeCanvas(panel, 'HaloLight 入力面')); now = nowRow(c.parentNode);
        const o = h('div', { class: 'opts' }); toggle(o, 'gradient', 'グラデーション'); c.parentNode.appendChild(o);
        bindHold(c, e => squareVal(c, e, PAD));
      },
      resize() { g = AH.fitCanvas(c); },
      update(t) {
        if (!g) return;
        const q = drawSquareFrame(g, c, PAD, false), cur = shown(t);
        g.fillStyle = AH.isWriting() ? AH.css('--pen') : AH.css('--muted'); g.beginPath(); g.arc(q.X(cur.v), q.Y(cur.a), 4, 0, 7); g.fill();
        const col = opts().gradient ? AH.gradColor(cur.v, cur.a) : AH.quadColor(cur.v, cur.a), it = AH.intensity(cur.v, cur.a);
        halo.style.borderColor = AH.rgba(col, it); halo.style.boxShadow = `0 0 18px 4px ${AH.rgba(col, it * 0.8)}`;
        now(cur);
      },
    });
  })();

  // =====================================================================
  // 時間連続・1次元（1軸ずつ2回）
  // =====================================================================
  function passSelector(parent) {
    const box = h('div', { class: 'opts pass' }, '評価する軸：');
    for (const [ax, name] of [['v', '快度'], ['a', '覚醒度']]) {
      const l = h('label', {}, `<input type="radio" name="pass" value="${ax}"> ${name}`), r = l.querySelector('input');
      r.checked = opts().axis === ax;
      r.addEventListener('change', () => { AH.setArmed(false); AH.setOption('axis', ax); r.blur(); });
      box.appendChild(l);
    }
    parent.appendChild(box);
  }

  // ---- CARMA（1次元スライダー） ----
  (() => {
    let c, g; let ctrl = 5, drag = false; const RATE = 4;
    const k = heldRate(['ArrowUp'], ['ArrowDown']);
    const ax = () => opts().axis || 'v';
    const setFromY = e => { const r = c.getBoundingClientRect(), y0 = 30, y1 = r.height - 30; ctrl = AH.r2(AH.clamp(1 + (1 - (e.clientY - r.top - y0) / (y1 - y0)) * 8, 1, 9)); };
    AH.register({
      id: 'carma', group: '時間連続・1次元', label: 'CARMA（1次元スライダー・2回）', model: 'series', init: { v: 5, a: 5 }, side: 'normal', animate: true,
      options: { axis: 'v' },
      writeMode: () => 'armed', writeAxes: () => [ax()], sample: () => ({ [ax()]: ctrl }),
      onArm(on) { if (on) ctrl = AH.valueAt(ax(), video.currentTime); },
      help: '<p>快度と覚醒度を1軸ずつ、2回に分けて評価します（右の「評価する軸」で切り替え）。スライダーをマウスでドラッグするか <kbd>↑</kbd>/<kbd>↓</kbd> で動かします。記録オン（<kbd>R</kbd>）の間、再生中の値を記録・上書きします。</p>',
      mount({ panel }) {
        const box = h('div', { class: 'planeBox' }); passSelector(box);
        c = h('canvas', { class: 'bars', 'aria-label': 'CARMA スライダー' }); box.appendChild(c); panel.appendChild(box);
        c.addEventListener('pointerdown', e => { if (!live()) { armHint(); return; } drag = true; c.setPointerCapture(e.pointerId); setFromY(e); });
        c.addEventListener('pointermove', e => { if (drag) setFromY(e); });
        c.addEventListener('pointerup', () => { drag = false; });
      },
      resize() { g = AH.fitCanvas(c); },
      tick(dt) {
        if (!live()) { ctrl = AH.valueAt(ax(), video.currentTime); return; }
        if (k.any()) ctrl = AH.r2(AH.clamp(ctrl + k.dir() * RATE * dt, 1, 9));
      },
      onKey(e) { const hit = k.key(e, true); if (hit && !live()) armHint(); return hit; },
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

  // ---- RankTrace（1次元・上下限なし・ホイール・過去の軌跡全体を表示） ----
  (() => {
    let c, g; let ctrl = 0;
    const k = heldRate(['ArrowUp'], ['ArrowDown']);
    const ax = () => opts().axis || 'v';
    AH.register({
      id: 'ranktrace', group: '時間連続・1次元', label: 'RankTrace（ホイール・上下限なし・2回）', model: 'series', init: { v: 0, a: 0 }, unbounded: true, side: 'wide', animate: true,
      options: { axis: 'v' },
      writeMode: () => 'armed', writeAxes: () => [ax()], sample: () => ({ [ax()]: ctrl }),
      onArm(on) { if (on) ctrl = AH.valueAt(ax(), video.currentTime); },
      help: '<p>快度と覚醒度を1軸ずつ、2回に分けて評価します。マウスホイール（または <kbd>↑</kbd>/<kbd>↓</kbd>）で「さっきより上がった／下がった」を入力します。上限・下限はなく、数値は表示しません。これまでの軌跡全体を見ながら相対的に判断してください。記録オン（<kbd>R</kbd>）の間、再生中の値を記録・上書きします。</p>',
      mount({ panel }) {
        const box = h('div', { class: 'planeBox' }); passSelector(box);
        c = h('canvas', { class: 'trace', 'aria-label': 'RankTrace の軌跡。ホイールで入力' }); box.appendChild(c); panel.appendChild(box);
        c.addEventListener('wheel', e => {
          e.preventDefault();
          if (!live()) { armHint(); return; }
          ctrl = AH.r2(ctrl - Math.sign(e.deltaY) * Math.min(3, Math.abs(e.deltaY) / 100) * 0.5);
        }, { passive: false });
      },
      resize() { g = AH.fitCanvas(c); },
      tick(dt) {
        if (!live()) { ctrl = AH.valueAt(ax(), video.currentTime); return; }
        if (k.any()) ctrl = AH.r2(ctrl + k.dir() * 2 * dt);
      },
      onKey(e) { const hit = k.key(e, true); if (hit && !live()) armHint(); return hit; },
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
        g.fillStyle = AH.css('--muted'); g.font = '11px system-ui, sans-serif'; g.fillText(ax() === 'v' ? '快度（相対）' : '覚醒度（相対）', P + 4, P + 14);
      },
    });
  })();

  // =====================================================================
  // 離散（1秒ごとに1回）
  // =====================================================================

  // ---- Excel（現行の評価シートを再現） ----
  (() => {
    let grid, memo, sig = '';
    const LABELS = [['ストレス', 9, 1], ['覚醒', 9, 5], ['興奮', 9, 9], ['快', 5, 9], ['不快', 5, 1], ['憂鬱', 1, 1], ['眠気', 1, 5], ['安堵', 1, 9]];
    function build() {
      sig = AH.rangeSig(); const n = AH.nSec(); grid.innerHTML = '';
      const tb = h('table', { class: 'xl' });
      let tr = h('tr', {}, '<th>秒数</th>'); for (let s = 0; s < n; s++) tr.appendChild(h('th', { 'data-s': s }, AH.secLabel(s))); tb.appendChild(tr);
      for (const [ax, name] of [['v', '快度(1:不快ー9:快)'], ['a', '覚醒度(1:眠気ー9:覚醒)']]) {
        tr = h('tr', {}, `<th>${name}</th>`);
        for (let s = 0; s < n; s++) {
          const td = h('td', { 'data-s': s }), inp = h('input', { type: 'text', inputmode: 'numeric', maxlength: '1', 'data-ax': ax, 'data-s': s, 'aria-label': `${name} ${AH.secLabel(s)}` });
          inp.addEventListener('input', () => {
            const x = inp.value.trim();
            if (/^[1-9]$/.test(x)) AH.setCell(ax, s, +x, 'input');
            else if (x === '') AH.setCell(ax, s, null, 'clear');
            else { inp.value = S.data.cells[ax][s] ?? ''; inp.classList.add('bad'); setTimeout(() => inp.classList.remove('bad'), 400); }
          });
          inp.addEventListener('keydown', e => {
            const move = { ArrowLeft: [0, -1], ArrowRight: [0, 1], Enter: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
            if (e.key === 'Escape') { inp.blur(); return; }
            if (!move) return;
            e.preventDefault();
            const r2 = (ax === 'v' ? 0 : 1) + move[0], s2 = s + move[1];
            const nx = grid.querySelector(`input[data-ax="${r2 ? 'a' : 'v'}"][data-s="${s2}"]`);
            if (r2 >= 0 && r2 <= 1 && nx) { nx.focus(); nx.select(); }
          });
          inp.addEventListener('focus', () => AH.addLog('cell_focus', { axis: ax, detail: 'bin ' + s }));
          td.appendChild(inp); tr.appendChild(td);
        }
        tb.appendChild(tr);
      }
      grid.appendChild(tb);
    }
    AH.register({
      id: 'excel', group: '離散（区間ごと）', label: 'Excel（現行シートの再現）', model: 'table', side: 'normal', init: { v: 5, a: 5 },
      help: '<p>現行の Excel 評価シートと同じ並び（快度・覚醒度、列は評価区間（ヘッダーで設定））です。セルに 1〜9 を入力します。<kbd>Tab</kbd>・<kbd>Enter</kbd>・矢印キーでセル移動、<kbd>Esc</kbd> でセルから抜けると <kbd>Space</kbd> で再生／停止できます。再生中の区間の列が強調されます。</p>',
      mount({ panel, under }) {
        grid = h('div', { class: 'xlWrap' }); under.appendChild(grid); sig = '';
        const ref = h('div', { class: 'planeBox' }, '<div class="refTitle">ラベル・プロット表</div>');
        const t = h('table', { class: 'ref' }, '<tr><th>感情ラベル</th><th>覚醒度</th><th>快度</th></tr>' + LABELS.map(([l, a, v]) => `<tr><td>${l}</td><td>${a}</td><td>${v}</td></tr>`).join(''));
        ref.appendChild(t);
        memo = h('textarea', { rows: '3', placeholder: '判断に迷ったなど何かあればメモ' });
        memo.addEventListener('change', () => { S.data.memo = memo.value; AH.addLog('memo', { detail: memo.value.length + ' chars' }); });
        ref.appendChild(memo); panel.appendChild(ref);
      },
      update() {
        if (!S.meta.duration) return;
        if (sig !== AH.rangeSig()) build();
        if (memo && document.activeElement !== memo) memo.value = S.data.memo || '';
        const cur = AH.curSec();
        for (const inp of grid.querySelectorAll('input')) {
          const v = S.data.cells[inp.dataset.ax][+inp.dataset.s];
          if (document.activeElement !== inp && inp.value !== String(v ?? '')) inp.value = v ?? '';
        }
        for (const cell of grid.querySelectorAll('[data-s]')) if (cell.tagName !== 'INPUT') cell.classList.toggle('cur', +cell.dataset.s === cur);
        const th = grid.querySelector(`th[data-s="${cur}"]`);
        if (th && !video.paused) th.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      },
    });
  })();

  // ---- Affect Grid（9×9） ----
  (() => {
    let c, g, strip; const PAD = 34;
    AH.register({
      id: 'affectgrid', group: '離散（区間ごと）', label: 'Affect Grid（9×9・クリック）', model: 'table', side: 'wide', init: { v: 5, a: 5 },
      options: { autoNext: false },
      help: '<p>今の区間（下の帯で強調）について、グリッドのマスを1つクリックします（横＝快度、縦＝覚醒度）。帯のマスを押すとその秒へ移動します。「入力後に次の秒へ」をオンにすると自動で次の区間へ進みます。</p>',
      mount({ panel, under }) {
        ({ c } = planeCanvas(panel, 'Affect Grid'));
        const o = h('div', { class: 'opts' }); toggle(o, 'autoNext', '入力後に次の区間へ'); c.parentNode.appendChild(o);
        strip = secStrip(under);
        c.addEventListener('pointerdown', e => {
          const r = c.getBoundingClientRect(), s9 = (c.clientWidth - PAD * 2) / 9;
          const i = Math.floor((e.clientX - r.left - PAD) / s9), j = Math.floor((e.clientY - r.top - PAD) / s9);
          if (i < 0 || i > 8 || j < 0 || j > 8) return;
          const s = AH.curSec(); setBoth(s, i + 1, 9 - j, 'grid'); autoNext(s);
        });
      },
      resize() { g = AH.fitCanvas(c); },
      update() {
        if (!g) return;
        const w = c.clientWidth, s9 = (w - PAD * 2) / 9, s = AH.curSec();
        g.clearRect(0, 0, w, w);
        const cv = S.data.cells.v[s], ca = S.data.cells.a[s], pv = S.data.cells.v[s - 1], pa = S.data.cells.a[s - 1];
        for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) {
          const x = PAD + i * s9, y = PAD + j * s9;
          if (pv === i + 1 && pa === 9 - j) { g.fillStyle = AH.css('--grid'); g.fillRect(x, y, s9, s9); }
          if (cv === i + 1 && ca === 9 - j) { g.fillStyle = AH.css('--val'); g.fillRect(x, y, s9, s9); }
          g.strokeStyle = AH.css('--line'); g.lineWidth = (i === 4 || j === 4) ? 1.6 : 1; g.strokeRect(x, y, s9, s9);
        }
        g.fillStyle = AH.css('--muted'); g.font = '11px system-ui, sans-serif'; g.textAlign = 'center';
        const L = PAD, R = w - PAD, T = PAD, B = w - PAD, M = w / 2;
        g.fillText('覚醒', M, T - 8); g.fillText('眠気', M, B + 16);
        g.fillText('ストレス', L + 10, T - 8); g.fillText('興奮', R - 10, T - 8); g.fillText('憂鬱', L + 10, B + 16); g.fillText('安堵', R - 10, B + 16);
        g.save(); g.translate(L - 12, M); g.rotate(-Math.PI / 2); g.fillText('不快', 0, 0); g.restore();
        g.save(); g.translate(R + 12, M); g.rotate(Math.PI / 2); g.fillText('快', 0, 0); g.restore();
        g.textAlign = 'left';
        strip();
      },
    });
  })();

  // ---- SAM（9段階の絵） ----
  (() => {
    let rows = {}, strip;
    AH.register({
      id: 'sam', group: '離散（区間ごと）', label: 'SAM（9段階の絵）', model: 'table', side: 'narrow', init: { v: 5, a: 5 },
      options: { autoNext: false },
      help: '<p>今の区間（下の帯で強調）について、快度と覚醒度の絵をそれぞれ1つ選びます。絵と絵の間の小円は中間の値です。「入力後に次の区間へ」をオンにすると、両方選んだ時点で次の区間へ進みます。</p>',
      mount({ panel, under }) {
        // 絵が読めるよう、SAM の行は動画の下の広い欄に置く
        const box = h('div', { class: 'planeBox sam' });
        rows = samRows(box, (ax, i) => {
          const s = AH.curSec(); AH.setCell(ax, s, i, 'sam');
          if (S.data.cells.v[s] != null && S.data.cells.a[s] != null) autoNext(s);
        });
        under.appendChild(box); strip = secStrip(under);
        const side = h('div', { class: 'planeBox' }), o = h('div', { class: 'opts' });
        toggle(o, 'autoNext', '入力後に次の区間へ'); side.appendChild(o); panel.appendChild(side);
      },
      update() {
        const s = AH.curSec();
        for (const ax of ['v', 'a']) if (rows[ax]) for (const b of rows[ax].children) b.classList.toggle('on', +b.dataset.v === S.data.cells[ax][s]);
        strip();
      },
    });
  })();

  // =====================================================================
  // 相対（変化の方向）
  // =====================================================================

  // ---- AffectRank（変化を感じたときだけ8方向から選ぶ） ----
  (() => {
    let btns = {}, list;
    // [ラベル, dv, da, テンキー]
    const DIRS = [['活発', 0, 1, 'Numpad8'], ['活発・快', 1, 1, 'Numpad9'], ['快', 1, 0, 'Numpad6'], ['非活発・快', 1, -1, 'Numpad3'],
                  ['非活発', 0, -1, 'Numpad2'], ['非活発・不快', -1, -1, 'Numpad1'], ['不快', -1, 0, 'Numpad4'], ['活発・不快', -1, 1, 'Numpad7']];
    function fire(d) {
      AH.addEvent({ label: d[0], dv: d[1], da: d[2] });
      const b = btns[d[0]]; b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 350);
    }
    AH.register({
      id: 'affectrank', group: '相対（変化の方向）', label: 'AffectRank（変化時に8方向）', model: 'events', side: 'wide', init: { v: 5, a: 5 },
      help: '<p>快度・覚醒度が「変わった」と感じたときだけ、変化の方向を8つから選んでクリックします（テンキーでも可：8＝活発、9＝活発・快、6＝快 …）。変化がなければ何もしません。<kbd>Backspace</kbd> で今の時刻より前の直近の入力を削除します。</p>',
      mount({ panel }) {
        const box = h('div', { class: 'planeBox' }), pl = h('div', { class: 'arPlane' });
        pl.appendChild(h('div', { class: 'arAxis h' })); pl.appendChild(h('div', { class: 'arAxis v' }));
        for (const d of DIRS) {
          const b = h('button', { class: 'arBtn', title: d[0], style: `left:${50 + d[1] * 38}%;top:${50 - d[2] * 38}%`, onclick: e => { fire(d); e.currentTarget.blur(); } }, `<span>${d[0]}</span>`);
          pl.appendChild(b); btns[d[0]] = b;
        }
        box.appendChild(pl); list = h('div', { class: 'arList' }); box.appendChild(list); panel.appendChild(box);
      },
      onKey(e) {
        const d = DIRS.find(x => x[3] === e.code); if (d) { fire(d); return true; }
        if (e.code === 'Backspace') { AH.deleteEventBefore(AH.vt()); return true; }
        return false;
      },
      update() {
        if (!list) return;
        const ev = S.data.events.slice(-5).reverse();
        list.innerHTML = ev.length ? ev.map(e => `<div>${AH.fmt(e.t)}　${e.label}</div>`).join('') : '<div class="muted">まだ入力がありません</div>';
      },
    });
  })();

  // =====================================================================
  // カスタム：設計軸を自由に組み合わせる（先行研究にない組み合わせも作れる）
  // =====================================================================
  (() => {
    const o = () => opts();
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
        const s = AH.curSec(); AH.setCells(s, vv, 'custom');
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
      if (writeMode() === 'armed' && live()) return { ...ctrl };
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
          if (rel()) { armHint(S.armed ? 'ホイールで上下させます' : undefined); return; }
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
        if (!live()) { armHint(); return; }
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
      onArm(on) { if (on) ctrl = stored(video.currentTime); },
      mount({ panel, overlay, under }) {
        Object.assign(S.meta.options, normalize(S.meta.options));
        config(panel);
        const box = h('div', { class: 'planeBox' });
        rows = null; c = null; g = null;
        if (o().rep === 'sam' || o().rep === 'buttons') {
          if (o().rep === 'sam') { const sb = h('div', { class: 'planeBox sam' }); rows = samRows(sb, (ax, i) => pointAction({ [ax]: i }), act()); under.appendChild(sb); }
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
        if (!live()) { ctrl = stored(video.currentTime); return; }
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
          if (o().time === 'disc') { const vv = {}; for (const ax of act()) vv[ax] = null; AH.setCells(AH.curSec(), vv, 'clear'); }
          else { const p = AH.deletePointBefore(lastAxis, AH.vt()); if (p) { AH.addLog('delete', { axis: lastAxis, value: p.val, detail: 'at ' + p.t }); AH.refresh(); } }
          return true;
        }
        if (writeMode() === 'armed' && o().input === 'keyboard') {
          const hit = kW.key(e, true) || kUD.key(e, true) || kAD.key(e, true);
          if (hit && !live()) armHint();
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
})();
