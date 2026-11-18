// 入力面の表示の設定：区切りの線（gridShow）と、四角の平面でスティックを角まで届かせるか（padSquare）。
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
  // 配色（OS に合わせる・ライト・ダーク）。html の data-theme に当て、ブラウザに保存する（ahann_theme）。
  // 評価の記録には関わらないので、操作ログ・書き出しには残さない。読み込み時の適用は index.html の head で済ませる
  const root = document.documentElement;
  $('theme').value = root.dataset.theme || 'auto';
  $('theme').addEventListener('change', e => {
    const t = e.target.value;
    if (t === 'auto') delete root.dataset.theme; else root.dataset.theme = t;
    try { if (t === 'auto') localStorage.removeItem('ahann_theme'); else localStorage.setItem('ahann_theme', t); } catch (_) {}
    e.target.blur(); _.refresh();   // キャンバスは CSS の色を描くときに読むので描き直す
  });
  // OS の設定が変わったときも描き直す（「OS に合わせる」のとき）
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => _.refresh());
  Object.assign(_, { gridShown: () => cfg.grid, padSquare: () => cfg.square, displayMeta: () => ({ grid_lines: cfg.grid, pad_square: cfg.square }) });
})();
