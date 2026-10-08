// ---- Excel（現行の評価シートを再現） ----
(() => {
  const { xlTable, xlRef } = AH.ui;
  let table, memo;
  AH.register({
    id: 'excel', group: '離散', label: 'Excel', model: 'table', side: 'normal', init: { v: 5, a: 5 },
    graphCuts: true,   // 評価グラフの右クリックで区切りを置く・動かす・消す
    help: '<p>現行の Excel 評価シートと同じ並びです。セルに 1〜9 を入力します。<kbd>Tab</kbd>・<kbd>Enter</kbd>・矢印キーでセル移動。再生中の区間の列が強調されます。評価グラフを右クリックすると、区間の区切りを置く・動かす・消すことができます。</p>',
    mount({ panel, under }) {
      table = xlTable(under); memo = xlRef(panel);
    },
    update() { table(); memo(); },
  });
})();
