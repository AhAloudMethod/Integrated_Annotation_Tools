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
      if (AH.reviewing()) { last = NaN; touched = false; return AH.hasVideo(); }   // 視聴：いつも記録済みの値に追従
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
  // 聴いてから入力で止まっている間（AH.listenLive）は、記録済みの値ではなく今の入力（予覧）を映す
  const shown = t => (pen.down || AH.listenLive() ? { v: pen.v, a: pen.a } : stored(t));
  function nowRow(parent) {
    const r = h('div', { class: 'nowRow' }, `<span class="v">${AH.ax('v').short} <b>5.00</b></span><span class="a">${AH.ax('a').short} <b>5.00</b></span>`);
    parent.appendChild(r);
    const f = x => (x == null || isNaN(x) ? '–' : (+x).toFixed(2));
    return c => { const b = r.querySelectorAll('b'); b[0].textContent = f(c.v); b[1].textContent = f(c.a); };
  }
  function toggle(parent, key, label) {
    const l = h('label', { class: 'optCtl' }, `<input type="checkbox"> ${label}`), cb = l.querySelector('input');   // optCtl：実験モードでは隠す方式の設定
    cb.checked = !!opts()[key];
    cb.addEventListener('change', () => { AH.setOption(key, cb.checked); cb.blur(); });
    parent.appendChild(l); return cb;
  }
  function armHint(msg = '記録オフです。R キー（またはゲームパッドのボタン0）で記録を始めます') {
    const el = document.getElementById('hint'); el.classList.remove('ok'); el.textContent = msg; el.hidden = false;
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
  // 区切りの線（「設定」でオンのとき）：整数の境目 1.5〜8.5 に薄い線。四捨五入で同じ整数になる範囲が1マスになり、5 のマスが中心に来る。
  // X・Y は値→座標、範囲 [x0,x1]×[y0,y1]。clip（円）を渡すとその中だけに引く
  function gridLines(g, X, Y, x0, y0, x1, y1, clip) {
    g.save();
    if (clip) { g.beginPath(); g.arc(clip.cx, clip.cy, clip.R, 0, 7); g.clip(); }
    g.strokeStyle = AH.css('--line'); g.globalAlpha = 0.7; g.lineWidth = 1; g.beginPath();
    for (let k = 1.5; k <= 8.5; k++) { g.moveTo(X(k), y0); g.lineTo(X(k), y1); g.moveTo(x0, Y(k)); g.lineTo(x1, Y(k)); }
    g.stroke(); g.restore();
  }
  // 円の入力面の区切りの線（中心 cx・cy、半径 R が値 1〜9 の幅）
  function gridCircle(g, cx, cy, R) {
    if (!AH.gridShown()) return;
    gridLines(g, v => cx + (v - 5) / 4 * R, a => cy - (a - 5) / 4 * R, cx - R, cy - R, cx + R, cy + R, { cx, cy, R });
  }
  // スライダー・レバーの区切りの線（x を中心に幅 w。Y は値→座標）
  function gridBar(g, x, Y, w = 56) {
    if (!AH.gridShown()) return;
    g.save(); g.strokeStyle = AH.css('--line'); g.globalAlpha = 0.9; g.lineWidth = 1; g.beginPath();
    for (let k = 1.5; k <= 8.5; k++) { g.moveTo(x - w / 2, Y(k)); g.lineTo(x + w / 2, Y(k)); }
    g.stroke(); g.restore();
  }
  function drawSquareFrame(g, c, pad, labels = true) {
    const w = c.clientWidth, q = square(c, pad);
    g.clearRect(0, 0, w, w);
    g.strokeStyle = AH.css('--line'); g.lineWidth = 1; g.strokeRect(q.x0, q.y0, q.s, q.s);
    g.setLineDash([3, 3]); g.beginPath();
    g.moveTo(q.X(5), q.y0); g.lineTo(q.X(5), q.y0 + q.s); g.moveTo(q.x0, q.Y(5)); g.lineTo(q.x0 + q.s, q.Y(5)); g.stroke(); g.setLineDash([]);
    if (AH.gridShown()) gridLines(g, q.X, q.Y, q.x0, q.y0, q.x0 + q.s, q.y0 + q.s);
    if (labels) {
      g.fillStyle = AH.css('--muted'); g.font = '11px system-ui, sans-serif';
      const V = AH.ax('v'), A = AH.ax('a');
      g.textAlign = 'center'; g.fillText(A.hi, q.X(5), q.y0 - 7); g.fillText(A.lo, q.X(5), q.y0 + q.s + 14);
      g.save(); g.translate(q.x0 - 8, q.Y(5)); g.rotate(-Math.PI / 2); g.fillText(V.lo, 0, 0); g.restore();
      g.save(); g.translate(q.x0 + q.s + 8, q.Y(5)); g.rotate(Math.PI / 2); g.fillText(V.hi, 0, 0); g.restore();
      g.textAlign = 'left';
    }
    return q;
  }
  // 過去 sec 秒の軌跡を点列で返す。実際に評価した範囲だけを使う：書き込み中はその書き始めから、
  // それ以外は最初に記録した時刻から（書き始める前の値＝初期値 5・5 などから線を引かない）
  const firstWritten = () => Math.min(...['v', 'a'].map(ax => { const p = S.data.points[ax].find(q => !q.init); return p ? p.t : Infinity; }));
  function trail(t, sec, n, cur) {
    const from = AH._.stroke ? AH._.stroke.t0 : firstWritten(), out = [];
    for (let i = n; i >= 1; i--) { const tt = Math.max(0, t - sec * i / n); if (tt >= from - 1e-6) out.push({ ...stored(tt), age: i / n }); }
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
  // Excel の評価シート（Excel 方式とカスタムの Excel）：行は軸、列は評価区間。セルに 1〜9 を入れる
  // real：連続値（1〜9 の小数。小数第1位まで）。打ち途中（「5.」など）を弾かないよう、確定（Enter・Tab・移動）のときに検査する。数字を 2 つ続けて打つと小数で確定する
  // 0 は「発声なし」（声の無い区間に付ける値）。どちらの値でも入る。0.5 のような 0 台の小数は入らない。
  // 発声なしは両軸そろうので、片方に 0 を入れたらもう片方も 0 にし、0 の区間で片方に 1〜9 を入れたらもう片方の 0 を空欄に戻す（取り消しは 1 回）
  // 表の入れ物：区間が多くて表が横にはみ出すときは、ホイールの縦の回転で横に送る（表は 2〜3 行なので縦には送らない）。
  // 返す follow(cur) は今の区間の列を見える所に出す（再生中と、シーク・聴いてから入力などで区間が変わったとき）
  function xlWrap(under) {
    const grid = h('div', { class: 'xlWrap' }); under.appendChild(grid);
    grid.addEventListener('wheel', e => {
      if (grid.scrollWidth <= grid.clientWidth || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault(); grid.scrollLeft += e.deltaY;
    }, { passive: false });
    let lastCur = -1;
    const follow = cur => {
      for (const cell of grid.querySelectorAll('[data-s]')) if (cell.tagName !== 'INPUT') cell.classList.toggle('cur', +cell.dataset.s === cur);
      const th = grid.querySelector(`th[data-s="${cur}"]`);
      if (th && (!video.paused || cur !== lastCur)) th.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      lastCur = cur;
    };
    return { grid, follow };
  }
  // 直前にクリックしたセルの区間（区間内で変化のパネルのボタンの対象）。セルにフォーカスしても動画は動かないので、
  // 動画の位置がそのときのままなら、そのセルの区間を対象にする。動いていれば今の区間
  let lastCell = null;
  const cellSec = () => (lastCell && Math.abs(video.currentTime - lastCell.t) < 0.002 ? lastCell.s : AH.curSec());
  // curve：区間内で変化を使う（変化にした区間のセルは表示だけ。クリックでその区間へ移る）
  function xlTable(under, axes = ['v', 'a'], real = false, curve = false) {
    const { grid, follow } = xlWrap(under);
    let sig = '';
    const isCv = (ax, s) => curve && S.data.cells[ax][s] === 'curve';
    const sigNow = () => AH.rangeSig() + (curve ? '|' + axes.map(ax => [...Array(AH.nSec()).keys()].map(s => (isCv(ax, s) ? 1 : 0)).join('')).join('|') : '');
    const bad = (inp, ax, s) => { inp.value = S.data.cells[ax][s] ?? ''; inp.classList.add('bad'); setTimeout(() => inp.classList.remove('bad'), 400); };
    const put = (ax, s, v) => {
      const others = axes.filter(o => o !== ax), c = S.data.cells;
      if (v === 0) return AH.setCells(s, Object.fromEntries(axes.map(o => [o, 0])), 'input');
      if (others.some(o => c[o][s] === 0)) return AH.setCells(s, { [ax]: v, ...Object.fromEntries(others.filter(o => c[o][s] === 0).map(o => [o, null])) }, 'input');
      return AH.setCell(ax, s, v, 'input');
    };
    const half = x => x.replace(/[０-９．]/g, c => (c === '．' ? '.' : String.fromCharCode(c.charCodeAt(0) - 0xFEE0)));   // 全角の数字と小数点を半角に
    function bindReal(inp, ax, s) {
      inp.addEventListener('input', () => {
        const x = half(inp.value); if (x !== inp.value) inp.value = x;
        if (!/^\d*\.?\d*$/.test(x)) { bad(inp, ax, s); return; }
        // 数字を 2 つ続けて打つと小数にして確定する（5、3 → 5.3）。値の範囲が 1〜9 なので、2 桁の整数にはならない
        if (/^[1-9]\d$/.test(x)) { const v = +(x[0] + '.' + x[1]); inp.value = v; put(ax, s, v); }
        else if (/^0\d$/.test(x)) bad(inp, ax, s);   // 0 は発声なしだけ（0.5 などは入らない）
      });
      inp.addEventListener('change', () => {
        const x = half(inp.value).trim();
        if (x === '') { AH.setCell(ax, s, null, 'clear'); return; }
        const v = +x;
        if (/^\d*\.?\d+$|^\d+\.$/.test(x) && (v === 0 || (v >= 1 && v <= 9))) { const r = Math.round(v * 10) / 10; put(ax, s, r); inp.value = r; }
        else bad(inp, ax, s);
      });
    }
    function build() {
      // 区切りを変えると表を作り直す。セルに入れている途中なら、同じ軸・番号のセルにフォーカスを戻す（C キーで区切ったときなど）
      const fo = grid.contains(document.activeElement) ? document.activeElement.dataset : null, keep = fo && { ax: fo.ax, s: fo.s };
      sig = sigNow(); const n = AH.nSec(); grid.innerHTML = '';
      const tb = h('table', { class: 'xl' + (real ? ' real' : '') + (curve ? ' curve' : '') });
      let tr = h('tr', {}, '<th>秒数</th>'); for (let s = 0; s < n; s++) tr.appendChild(h('th', { 'data-s': s }, AH.secLabel(s))); tb.appendChild(tr);
      axes.forEach((ax, r) => {
        const L = AH.ax(ax), name = `${L.name}(1:${L.lo}ー9:${L.hi})`;
        tr = h('tr', {}, `<th>${name}</th>`);
        for (let s = 0; s < n; s++) {
          if (isCv(ax, s)) { tr.appendChild(h('td', { 'data-s': s, 'data-ax': ax, class: 'cv', title: '区間内で変化（グラフで入れる）', onclick: () => { lastCell = null; AH.seekTo(AH.binStart(s) + 0.001); } })); continue; }
          const td = h('td', { 'data-s': s }), inp = h('input', { type: 'text', inputmode: real ? 'decimal' : 'numeric', maxlength: real ? '3' : '1', 'data-ax': ax, 'data-s': s, 'aria-label': `${name} ${AH.secLabel(s)}` });
          if (real) bindReal(inp, ax, s);
          else inp.addEventListener('input', () => {
            const x = inp.value.trim();
            if (/^[0-9]$/.test(x)) put(ax, s, +x);   // 0 は発声なし
            else if (x === '') AH.setCell(ax, s, null, 'clear');
            else bad(inp, ax, s);
          });
          inp.addEventListener('keydown', e => {
            // Enter は下（最後の行の下は次の区間の最初の行）、Tab は右。Shift を押すと逆向き
            const back = e.shiftKey ? -1 : 1, last = axes.length - 1;
            const move = e.key === 'Enter' ? (r + back >= 0 && r + back <= last ? [back, 0] : [-back * last, back])
              : e.key === 'Tab' ? [0, back]
              : { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
            if (e.key === 'Escape') { inp.blur(); return; }
            // R：入れているセルの区間を始めから終わりまで再生して止める（聴いてから入力がオフでも。セルに R は入らない）
            if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); AH._.listenPlaySec(s); return; }
            if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); AH._.frameStep(e.key === 'ArrowLeft' ? -1 : 1); return; }   // Ctrl+←→：1 フレーム移動
            if (e.code === 'KeyC' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); AH._.cutNow(); return; }
            if (e.code === 'KeyH' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); AH._.setVoicedShown(!AH._.voicedShown(), 'key'); return; }   // 発声の区間の表示   // 今の時間で区切る（区切れるときだけ）
            if (!move) return;
            e.preventDefault();
            // 次のセル。変化の区間のセル（入力欄が無い）は飛ばして、同じ向きに進む
            let rr = r, ss = s, nx = null;
            for (let k = 0; k < axes.length * n && !nx; k++) {
              if (e.key === 'Enter') { rr += move[0] === 0 ? 0 : back; if (rr < 0 || rr > last) { rr = rr < 0 ? last : 0; ss += back; } }
              else { rr += move[0]; ss += move[1]; }
              if (rr < 0 || rr > last || ss < 0 || ss >= n) break;
              nx = grid.querySelector(`input[data-ax="${axes[rr]}"][data-s="${ss}"]`);
            }
            if (nx) { nx.focus(); nx.select(); }
            // 聴いてから入力：聴いた区間の最後の行で Enter を押して次の列へ移ったら、次の区間を聴く
            if (nx && e.key === 'Enter' && ss > s && AH._.listenUsable() && AH._.listenWaiting() && AH.curSec() === s) AH._.listenPlayBin(s + 1);
          });
          inp.addEventListener('focus', () => { lastCell = { s, t: video.currentTime }; AH.addLog('cell_focus', { axis: ax, detail: 'bin ' + s }); });
          // クリックでも中身を選ぶ。選ばないと、入っているセルは maxlength で打ち直せない（矢印・Enter の移動は select() で選ぶ）
          inp.addEventListener('mouseup', e => { if (inp.selectionStart === inp.selectionEnd) { e.preventDefault(); inp.select(); } });
          td.appendChild(inp); tr.appendChild(td);
        }
        tb.appendChild(tr);
      });
      grid.appendChild(tb);
      const back = keep && grid.querySelector(`input[data-ax="${keep.ax}"][data-s="${keep.s}"]`);
      if (back) { back.value = S.data.cells[keep.ax][+keep.s] ?? ''; back.focus(); back.select(); }
    }
    return () => {
      if (!S.meta.duration) return;
      if (sig !== sigNow()) build();
      const cur = AH.curSec();
      for (const td of grid.querySelectorAll('td.cv')) { const x = curveText(AH.curveInfo(td.dataset.ax, +td.dataset.s)); if (td.innerHTML !== x) td.innerHTML = x; }
      const ro = AH.reviewing();   // 視聴の間はセルに打てない
      for (const inp of grid.querySelectorAll('input')) {
        inp.readOnly = ro;
        const v = S.data.cells[inp.dataset.ax][+inp.dataset.s];
        if (document.activeElement !== inp && inp.value !== String(v ?? '')) inp.value = v ?? '';
      }
      follow(cur);
    };
  }
  // 区間内で変化（カスタムの Excel。core/curve.js）の変化の区間のセル：表示だけ。区間の始めの値→終わりの値（整数に丸める）と形の印を出す。
  // 入れていない区間は空欄、発声なしは 0
  const SHAPE_MARK = { line: '直', early: '前', late: '後', free: '描' };
  const curveText = c => {
    if (!c || !c.entered) return '';
    if (c.shape === 'zero') return '0';
    const a = Math.round(c.from), b = Math.round(c.to);
    return `${a === b ? a : a + '→' + b}<small>${SHAPE_MARK[c.shape] || ''}</small>`;
  };
  // Excel の右の欄：ラベル・プロット表（VA のときだけ）とメモ
  const XL_LABELS = [['ストレス', 1, 9], ['覚醒', 5, 9], ['興奮', 9, 9], ['快', 9, 5], ['不快', 1, 5], ['憂鬱', 1, 1], ['眠気', 5, 1], ['安堵', 9, 1]];   // [ラベル, 快度, 覚醒度]
  function xlRef(panel) {
    const ref = h('div', { class: 'planeBox' }, '<div class="refTitle">ラベル・プロット表</div>');
    const t = h('table', { class: 'ref' }, '<tr><th>感情ラベル</th><th>快度</th><th>覚醒度</th></tr>' + XL_LABELS.map(([l, v, a]) => `<tr><td>${l}</td><td>${v}</td><td>${a}</td></tr>`).join(''));
    ref.appendChild(t);
    if (AH._.axesCurrent() !== 'va') t.hidden = true;
    const memo = h('textarea', { rows: '3', placeholder: '判断に迷ったなど何かあればメモ' });
    memo.addEventListener('change', () => { S.data.memo = memo.value; AH.addLog('memo', { detail: memo.value.length + ' chars' }); });
    ref.appendChild(memo); panel.appendChild(ref);
    return () => { if (document.activeElement !== memo) memo.value = S.data.memo || ''; };
  }
  // 区切りのボタン（Excel で「自分で区切る」のとき。実験モードでも出す）
  function cutBox(panel) {
    const box = h('div', { class: 'planeBox cutBox' }, '<div class="refTitle">区間の区切り（<kbd>C</kbd> で今の時間で区切る）</div>');
    const btn = (label, fn) => box.appendChild(h('button', { type: 'button', onclick: e => { e.currentTarget.blur(); if (!AH._.reviewing()) fn(); } }, label));
    btn('今の時間で区切る', () => AH._.addCut(AH._.frameStart ? AH._.frameStart(video.currentTime) : video.currentTime));
    box.lastChild.dataset.key = 'C';   // ショートカットキー（右下に出す）
    btn('近くの区切りを消す', () => AH._.delCut(video.currentTime || 0));
    panel.appendChild(box);
  }
  const setBoth = (s, v, a, how) => AH.setCells(s, { v, a }, how);
  // 入力後に次の区間へ。聴いてから入力で止まっているときは、次の区間を始めから聴く（シークだけだと Enter で 1 区間飛ばす）
  function autoNext(s) {
    if (!opts().autoNext || s + 1 >= AH.nSec()) return;
    if (AH._.listenUsable() && AH._.listenWaiting()) AH._.listenPlayBin(s + 1);
    else AH.seekTo(AH.binStart(s + 1) + 0.001);
  }

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

  // ---------- ゲームパッド（機器との約束は core/gamepad.js と README） ----------
  // ジョイスティック：位置がそのまま値（v = 5 + x*4、a = 5 + y*4。circle なら円の外は円周に吸着）。
  // 遊びの外ではスティックが優先、遊びの中ならマウス（押している間の pen）、どちらもなければ中立 5・5。
  // ジョイスティックが使える間（on()）は、押している間（hold）の方式も記録オン（armed）の間の記録にする
  function stick(circle = false) {
    const k = {
      on: () => !!AH.padJoy(),
      active: () => !!(AH.padJoy() && AH.padJoy().active),
      // 今の値。スティックで入れた値には pad: 'joy' を付ける（書き込みの source が gamepad になる）
      val() {
        const j = AH.padJoy();
        if (j && j.active) {
          let { x, y } = j;
          if (circle) { const d = Math.hypot(x, y); if (d > 1) { x /= d; y /= d; } }
          else if (AH.padSquare()) {
            // 四角の平面：スティックの可動域（円）を四角に広げる。方向はそのままで、倒し切る（半径1）と四角の縁に届く（斜めでも角まで）
            const m = Math.max(Math.abs(x), Math.abs(y)), r = Math.min(1, Math.hypot(x, y));
            if (m > 0) { x = x / m * r; y = y / m * r; }
          }
          return { v: AH.r2(5 + x * 4), a: AH.r2(5 + y * 4), pad: 'joy' };
        }
        if (pen.down) return { v: pen.v, a: pen.a };
        if (AH.listenLive() && pen.listenSet) return { v: pen.v, a: pen.a };   // 聴いてから入力：止まっている間にマウスで決めた値
        return j ? { v: 5, a: 5, pad: 'joy' } : { v: 5, a: 5 };
      },
      // 画面に出す値：記録オン・スティックを倒している・マウスで押している・練習中は今の値、それ以外は記録済みの値
      shown: t => (S.armed || k.active() || pen.down || AH.listenLive() || !AH.hasVideo() ? k.val() : stored(t)),
    };
    return k;
  }
  // スライダー：位置がそのまま値（1〜9）。動かしたらその軸はスライダーのもの（own）になり、以後スライダーの位置を値にする。
  // キー・マウスで動かしたとき、記録済みの値への追従に戻ったとき（release）に手放す。get(i) は i 本目（0・1）の値か null
  function sliders() {
    const own = [false, false];
    return {
      on: () => !!AH.padSliders(),
      get(i) {
        const s = AH.padSliders();
        if (!s || s.val[i] == null) { own[i] = false; return null; }
        if (s.moved[i]) own[i] = true;
        return own[i] ? s.val[i] : null;
      },
      owned: i => (i == null ? own[0] || own[1] : own[i]),
      release(i) { if (i == null) own.fill(false); else own[i] = false; },
    };
  }

  // 1軸ずつ2回に分けて評価する方式（CARMA・RankTrace）の「評価する軸」の切り替え
  function passSelector(parent) {
    const box = h('div', { class: 'opts pass optCtl' }, '評価する軸：');
    for (const ax of ['v', 'a']) {
      const l = h('label', {}, `<input type="radio" name="pass" value="${ax}"> ${AH.ax(ax).name}`), r = l.querySelector('input');
      r.checked = opts().axis === ax;
      r.addEventListener('change', () => { AH.setArmed(false); AH.setOption('axis', ax); r.blur(); });
      box.appendChild(l);
    }
    parent.appendChild(box);
  }

  // AffectRank の8方向ボタン（AffectRank・カスタム）。axes が1軸なら、その軸だけが変わる2方向にする。
  // [ラベル, dv, da, テンキー]。返り値の onKey(e) はテンキーと Backspace（直近の入力の削除）を処理する
  const RANK_DIRS = [['覚醒', 0, 1, 'Numpad8'], ['覚醒・快', 1, 1, 'Numpad9'], ['快', 1, 0, 'Numpad6'], ['非覚醒・快', 1, -1, 'Numpad3'],
                     ['非覚醒', 0, -1, 'Numpad2'], ['非覚醒・不快', -1, -1, 'Numpad1'], ['不快', -1, 0, 'Numpad4'], ['覚醒・不快', -1, 1, 'Numpad7']];
  function rankPad(parent, axes = ['v', 'a']) {
    const dirs = RANK_DIRS.filter(d => (axes.includes('v') || !d[1]) && (axes.includes('a') || !d[2]));
    const btns = {}, box = h('div', { class: 'planeBox' }), pl = h('div', { class: 'arPlane' });
    const fire = (d, byPad = false) => { AH.addEvent({ label: d[0], dv: d[1], da: d[2], source: byPad ? 'gamepad' : 'input' }); const b = btns[d[0]]; b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 350); };
    // ジョイスティック：FIRE まで倒すと、いちばん近い方向を1回入れる。REARM の内側に戻すまで次は入らない（倒したままで連打にならない）
    const FIRE = 0.7, REARM = 0.3; let ready = true;
    if (axes.includes('v')) pl.appendChild(h('div', { class: 'arAxis h' }));
    if (axes.includes('a')) pl.appendChild(h('div', { class: 'arAxis v' }));
    for (const d of dirs) {
      const b = h('button', { class: 'arBtn', title: d[0], style: `left:${50 + d[1] * 38}%;top:${50 - d[2] * 38}%`, onclick: e => { fire(d); e.currentTarget.blur(); } }, `<span>${d[0]}</span>`);
      pl.appendChild(b); btns[d[0]] = b;
    }
    const list = h('div', { class: 'arList' });
    box.appendChild(pl); box.appendChild(list); parent.appendChild(box);
    return {
      tick() {
        const j = AH.padJoy(), m = j ? Math.hypot(j.x, j.y) : 0;
        if (m < REARM) { ready = true; return; }
        if (!ready || m < FIRE) return;
        ready = false;
        // 方向の向き（dv・da）との内積が最大のもの。斜めは長さ √2 なので正規化して比べる
        let best = null, bs = -Infinity;
        for (const d of dirs) { const s = (d[1] * j.x + d[2] * j.y) / Math.hypot(d[1], d[2]); if (s > bs) { bs = s; best = d; } }
        if (best) fire(best, true);
      },
      onKey(e) {
        const d = dirs.find(x => x[3] === e.code); if (d) { fire(d); return true; }
        if (e.code === 'Backspace') { AH.deleteEventBefore(AH.vt()); return true; }
        return false;
      },
      update() {
        const ev = S.data.events.slice(-5).reverse();
        list.innerHTML = ev.length ? ev.map(x => `<div>${AH.fmt(x.t)}　${x.label}</div>`).join('') : '<div class="muted">まだ入力がありません</div>';
      },
    };
  }

  AH.ui = {
    opts, live, follower, h, stored, shown, nowRow, toggle, armHint, square, squareVal, circleVal, bindHold, planeCanvas, drawSquareFrame, gridCircle, gridBar, trail,
    secStrip, xlTable, cellSec, xlRef, cutBox, setBoth, autoNext, samSrc, SAM_IMG, manikin, samFig, samRows, drawFace, heldRate, dead, stick, sliders, passSelector, rankPad,
  };
})();
