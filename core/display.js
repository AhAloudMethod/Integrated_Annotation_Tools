// 入力面の表示の設定：目盛りの線（gridShow）と、四角の平面でスティックを角まで届かせるか（padSquare）。
// どちらもブラウザに保存し（ahann_grid・ahann_pad_square）、操作ログに grid_display・pad_square、書き出しの meta.display に残す
(() => {
  const _ = AH._;
  const { $, addLog } = _;
  const ls = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } };
  const cfg = { grid: ls('ahann_grid', '0') === '1', square: ls('ahann_pad_square', '1') !== '0' };
  for (const [id, key, name, log] of [['gridShow', 'grid', 'ahann_grid', 'grid_display'], ['padSquare', 'square', 'ahann_pad_square', 'pad_square']]) {
    $(id).checked = cfg[key];
    $(id).addEventListener('change', e => {
      cfg[key] = e.target.checked; try { localStorage.setItem(name, cfg[key] ? '1' : '0'); } catch (_) {}
      addLog(log, { value: cfg[key] ? 'on' : 'off' }); e.target.blur(); _.refresh();
    });
  }
  Object.assign(_, { gridShown: () => cfg.grid, padSquare: () => cfg.square, displayMeta: () => ({ grid_lines: cfg.grid, pad_square: cfg.square }) });
})();
