// 色の設定欄（「設定」パネル）：4象限＋4軸方向の色。ブラウザに保存し、セッションのメタ情報と操作ログに残す
(() => {
  const _ = AH._;
  const { $, S, addLog, QUAD, AXIS, DEFAULT_QUAD, axisColor } = _;
  const hex = c => '#' + c.map(x => x.toString(16).padStart(2, '0')).join('');
  const rgb = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
  // 3×3 の配置（上＝覚醒、右＝快）。null は中央（既定に戻す）
  const LAYOUT = [['hl', '高覚醒・不快'], ['ap', '覚醒'], ['hh', '高覚醒・快'],
                  ['vn', '不快'], null, ['vp', '快'],
                  ['ll', '低覚醒・不快'], ['an', '眠気'], ['lh', '低覚醒・快']];
  const isAxis = k => k in AXIS;

  function snapshot() {
    const o = {}; for (const k in QUAD) o[k] = hex(QUAD[k]); for (const k in AXIS) o[k] = AXIS[k] ? hex(AXIS[k]) : 'auto';
    return o;
  }
  function save(reason) {
    const snap = snapshot();
    try { localStorage.setItem('ahann_colors', JSON.stringify(snap)); } catch (_) {}
    S.meta.colors = snap;
    if (reason) addLog('colors', { detail: JSON.stringify(snap) });
    sync(); _.refresh();
  }
  function load() {
    try {
      const o = JSON.parse(localStorage.getItem('ahann_colors') || 'null'); if (!o) return;
      for (const k in QUAD) if (/^#[0-9a-f]{6}$/i.test(o[k] || '')) QUAD[k] = rgb(o[k]);
      for (const k in AXIS) AXIS[k] = /^#[0-9a-f]{6}$/i.test(o[k] || '') ? rgb(o[k]) : null;
    } catch (_) {}
  }
  function set(k, val) {   // val：'#rrggbb' または 'auto'（軸方向のみ）
    if (isAxis(k)) AXIS[k] = val === 'auto' ? null : rgb(val); else QUAD[k] = rgb(val);
    save(true);
  }
  function reset() { Object.assign(QUAD, DEFAULT_QUAD); for (const k in AXIS) AXIS[k] = null; save(true); }

  const grid = $('colorGrid'), inputs = {};
  for (const item of LAYOUT) {
    const cell = document.createElement('div'); cell.className = 'cell';
    if (!item) {
      cell.classList.add('center');
      const b = document.createElement('button'); b.type = 'button'; b.id = 'colorReset'; b.textContent = '既定に戻す'; b.style.fontSize = '11px';
      b.addEventListener('click', e => { reset(); e.currentTarget.blur(); });
      cell.appendChild(b); grid.appendChild(cell); continue;
    }
    const [k, label] = item;
    const inp = document.createElement('input'); inp.type = 'color'; inp.dataset.key = k; inp.title = label; inp.setAttribute('aria-label', '色：' + label);
    inp.addEventListener('input', () => set(k, inp.value));
    cell.append(inp, Object.assign(document.createElement('span'), { textContent: label }));
    if (isAxis(k)) {
      const a = document.createElement('button'); a.type = 'button'; a.className = 'auto'; a.dataset.key = k; a.textContent = '自動';
      a.addEventListener('click', e => { set(k, 'auto'); e.currentTarget.blur(); });
      cell.appendChild(a);
    }
    inputs[k] = inp; grid.appendChild(cell);
  }
  function sync() {
    for (const k in inputs) inputs[k].value = hex(isAxis(k) ? axisColor(k) : QUAD[k]);
    for (const b of grid.querySelectorAll('.auto')) b.classList.toggle('on', !AXIS[b.dataset.key]);
  }
  load(); S.meta.colors = snapshot(); sync();

  Object.assign(_, { setColor: set, resetColors: reset, colorSnapshot: snapshot });
})();
