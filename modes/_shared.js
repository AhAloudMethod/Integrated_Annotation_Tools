// 各入力方式の共通ヘルパ。原典の仕様と改変点は README.md の対応表を参照。
// AH.ui に公開し、各方式（modes/<id>.js）は const { h, ... } = AH.ui; で受け取る。
(() => {
  const { S, pen, video } = AH;
  const opts = () => S.meta.options;
  // 操作が値に反映される状態か：記録オン、または動画を開く前の練習中
  const live = () => S.armed || !AH.hasVideo();
  // 記録オフの操作面（スライダー・レバー・RankTrace）：記録オフでも自由に動かせる。
  // 触っていない間は、動画の時刻が動くと記録済みの値に追従する（follow() が true＝追従すべき）。
  // 記録オフで一度操作したら（follow.touch()）その位置に留まり、シークするか記録オフに戻したときに追従を再開する
  function follower() {
    let last = NaN, touched = false, wasArmed = false;
    video.addEventListener('seeking', () => { touched = false; last = NaN; });   // 次のフレームで必ず追従させる
    const f = () => {
      if (wasArmed && !S.armed) touched = false;
      wasArmed = S.armed;
      const t = video.currentTime || 0, moved = t !== last; last = t;
      return !S.armed && AH.hasVideo() && moved && !touched;
    };
    f.touch = () => { if (!S.armed) touched = true; };
    return f;
  }

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

  // 1軸ずつ2回に分けて評価する方式（CARMA・RankTrace）の「評価する軸」の切り替え
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

  AH.ui = {
    opts, live, follower, h, stored, shown, nowRow, toggle, armHint, square, squareVal, circleVal, bindHold, planeCanvas, drawSquareFrame, trail,
    secStrip, setBoth, autoNext, samSrc, SAM_IMG, manikin, samFig, samRows, drawFace, heldRate, dead, passSelector,
  };
})();
