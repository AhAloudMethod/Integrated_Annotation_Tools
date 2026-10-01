// ---- 変化ボタン（本研究の試作）：感情が変わったと感じた瞬間にボタンを押すだけ。値も方向も入れない ----
// 押した時刻（変化の時点）を集め、評価の粒度（区間の長さ）を決める手がかりにする。相対イベントモデル（label=change、dv=da=0）
(() => {
  const { S } = AH;
  const { h } = AH.ui;
  let btn = null, list = null;
  function fire() {
    AH.addEvent({ label: 'change', dv: 0, da: 0 });
    btn.classList.add('hit'); setTimeout(() => btn.classList.remove('hit'), 350);
  }
  AH.register({
    id: 'change', group: '変化の時点', label: '変化ボタン（変化を感じたら押す）', model: 'events', side: 'narrow', init: { v: 5, a: 5 },
    help: '<p>感情が変わったと感じた瞬間に「変化」ボタンを押します（<kbd>Enter</kbd> でも可）。値や方向は入力しません。押した時刻は書き出しの <code>_ranks.csv</code>（label＝change）に、評価区間ごとの回数は <code>_bins.csv</code> の n_changes に残ります。<kbd>Backspace</kbd> で今の時刻より前の直近の入力を削除します。</p>',
    mount({ panel }) {
      const box = h('div', { class: 'planeBox chgBox' });
      btn = h('button', { class: 'chgBtn', onclick: e => { fire(); e.currentTarget.blur(); } }, '変化<small>Enter</small>');
      list = h('div', { class: 'arList' });
      box.appendChild(btn); box.appendChild(list); panel.appendChild(box);
    },
    onKey(e) {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') { fire(); return true; }
      if (e.code === 'Backspace') { AH.deleteEventBefore(AH.vt()); return true; }
      return false;
    },
    update() {
      if (!list) return;
      const ev = S.data.events.slice(-5).reverse();
      list.innerHTML = `<div class="muted">変化 ${S.data.events.length} 回</div>` + ev.map(x => `<div>${AH.fmt(x.t)}　変化</div>`).join('');
    },
  });
})();
