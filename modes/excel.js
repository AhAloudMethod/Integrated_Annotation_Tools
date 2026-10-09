// ---- Excel（現行の評価シートを再現） ----
(() => {
  const { S } = AH;
  const { h, opts, xlTable, xlRef, cutBox } = AH.ui;
  let table, memo;
  AH.register({
    id: 'excel', group: '離散', label: 'Excel', model: 'table', side: 'normal', init: { v: 5, a: 5 },
    options: { cuts: 'fixed' },   // 区間の区切り（fixed＝事前設定の区切り、sec1＝1秒固定。どちらも編集できない、self＝自分で区切る）
    get graphCuts() { return opts().cuts === 'self'; },   // 自分で区切るときだけ、評価グラフの右クリック（と C キー）で区切りを置く・動かす・消す
    selfCuts: () => opts().cuts === 'self',
    cutsMode: () => opts().cuts,   // 実験モードで評価区間を当てるときに使う（core/experiment.js）   // 自分で区切る：実験モードでも参加者が区切れる
    get help() {
      return '<p>現行の Excel 評価シートと同じ並びです。セルに 1〜9 を入力します。発声が無く、評価の出来ない区間に関しては0を入力します。<kbd>Tab</kbd>・<kbd>Enter</kbd>・矢印キーでセル移動。'
        + (opts().cuts === 'self' ? '評価グラフを右クリックすると、区間の区切りを置く・動かす・消すことができます。「今の時間で区切る」（<kbd>C</kbd>）で今の時刻に区切りを置き、「近くの区切りを消す」で今の時刻に最も近い区切りを消します。' : opts().cuts === 'sec1' ? '区間は評価の開始から 1 秒間隔になっています。' : '') + '</p>';
    },
    mount({ panel, under }) {
      table = xlTable(under);
      const cfg = h('label', { class: 'opts optCtl' }, '区切り：<select aria-label="区切り"><option value="fixed">事前設定の区切り</option><option value="sec1">1秒固定</option><option value="self">自分で区切る</option></select>');
      const sel = cfg.querySelector('select'); sel.value = ['self', 'sec1'].includes(opts().cuts) ? opts().cuts : 'fixed';
      sel.addEventListener('change', () => { AH.setOption('cuts', sel.value); if (sel.value === 'sec1') AH.uniformRange(1); AH.remount(); });
      panel.appendChild(cfg);
      if (opts().cuts === 'self') cutBox(panel);
      memo = xlRef(panel);
    },
    update() { if (!S.meta.duration) return; table(); memo(); },
  });
})();
