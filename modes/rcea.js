// ---- RCEA（円形の仮想ジョイスティック・象限色・画面枠の色）。ジョイスティックは動画の外（ツールの列）に置く ----
(() => {
  const { pen } = AH;
  const { opts, h, stored, nowRow, toggle, circleVal, bindHold, stick } = AH.ui;
  let pad, g, now; const PAD = 6;
  const stk = stick(true);   // ジョイスティック（円の外は円周に吸着）
  const spring = () => !!opts().spring;
  AH.register({
    id: 'rcea', group: '時間連続・2次元', label: 'RCEA（円形ジョイスティック）', model: 'series', init: { v: 5, a: 5 }, side: 'normal', get animate() { return stk.on(); },
    options: { spring: false },
    writeMode: () => (spring() || stk.on() ? 'armed' : 'hold'), writeAxes: () => ['v', 'a'],
    sample: () => (stk.on() ? stk.val() : spring() && !pen.down ? { v: 5, a: 5 } : pen),
    help: '<p>右の円を押して動かします。画面の枠の色が今の象限（黄＝高覚醒・快、赤＝高覚醒・不快、青＝低覚醒・不快、緑＝低覚醒・快）を示し、濃さが強度です。「離すと中心へ」をオンにすると、記録オン（R）の間は押していなければ中性が記録されます。</p><p>ジョイスティック（ゲームパッド）をつなぐと、スティックの位置がそのまま値になり（離すと中性）、記録オン（<kbd>R</kbd> またはボタン0）の間だけ記録します。マウスもそのまま使えます（スティックを倒している間はスティックが優先）。</p>',
    mount({ panel }) {
      const box = h('div', { class: 'planeBox rceaBox' });
      pad = h('canvas', { class: 'plane rceaPad', 'aria-label': 'RCEA 仮想ジョイスティック' }); box.appendChild(pad); panel.appendChild(box);
      now = nowRow(box);
      const o = h('div', { class: 'opts' }); toggle(o, 'spring', '離すと中心へ'); box.appendChild(o);
      bindHold(pad, e => circleVal(pad, e, PAD));
    },
    resize() { g = AH.fitCanvas(pad); },
    update(t) {
      if (!g) return;
      const w = pad.clientWidth, R = (w - PAD * 2) / 2, cx = PAD + R, cy = PAD + R;
      const cur = stk.on() ? stk.shown(t) : pen.down || (AH.listenLive() && !spring()) ? { v: pen.v, a: pen.a } : (spring() && !AH.reviewing() ? { v: 5, a: 5 } : stored(t));
      g.clearRect(0, 0, w, w);
      const qs = [['hh', -Math.PI / 2, 0], ['hl', Math.PI, 1.5 * Math.PI], ['ll', Math.PI / 2, Math.PI], ['lh', 0, Math.PI / 2]];
      for (const [k, a0, a1] of qs) {
        const col = AH.quadColor(k[1] === 'h' ? 9 : 1, k[0] === 'h' ? 9 : 1);
        g.fillStyle = AH.rgba(col, 0.35); g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0, a1); g.closePath(); g.fill();
      }
      g.strokeStyle = AH.css('--line'); g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
      const x = cx + (cur.v - 5) / 4 * R, y = cy - (cur.a - 5) / 4 * R;
      g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(x, y, 12, 0, 7); g.fill();
      g.strokeStyle = AH.isWriting() ? AH.css('--pen') : 'rgba(0,0,0,.55)'; g.lineWidth = 2; g.stroke();
      const it = AH.intensity(cur.v, cur.a);
      // 画面枠の色：動画の枠（別窓・小窓のときはジョイスティックの枠）
      const ring = it > 0.02 ? `0 0 0 8px ${AH.rgba(AH.quadColor(cur.v, cur.a), 0.25 + 0.75 * it)}` : '0 0 0 8px transparent';
      const away = document.body.classList.contains('pip');
      document.getElementById('stage').style.boxShadow = away ? '' : ring;
      pad.parentNode.style.boxShadow = away ? ring.replace('8px', '6px') : '';
      now(cur);
    },
  });
})();
