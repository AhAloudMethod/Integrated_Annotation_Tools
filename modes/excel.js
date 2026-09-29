// ---- Excel（現行の評価シートを再現） ----
(() => {
  const { S, video } = AH;
  const { h } = AH.ui;
  let grid, memo, sig = '';
  const LABELS = [['ストレス', 9, 1], ['覚醒', 9, 5], ['興奮', 9, 9], ['快', 5, 9], ['不快', 5, 1], ['憂鬱', 1, 1], ['眠気', 1, 5], ['安堵', 1, 9]];
  function build() {
    sig = AH.rangeSig(); const n = AH.nSec(); grid.innerHTML = '';
    const tb = h('table', { class: 'xl' });
    let tr = h('tr', {}, '<th>秒数</th>'); for (let s = 0; s < n; s++) tr.appendChild(h('th', { 'data-s': s }, AH.secLabel(s))); tb.appendChild(tr);
    for (const ax of ['v', 'a']) {
      const L = AH.ax(ax), name = `${L.name}(1:${L.lo}ー9:${L.hi})`;
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
      if (AH._.axesCurrent() !== 'va') t.hidden = true;   // 感情ラベルの表は VA のときだけ
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
