// 動画の音声の F0（声の高さ）：動画を開いたら音声を 16kHz・モノラルにして YIN で 10ms ごとに求める。
// 評価グラフの3段目（timeline.js）と、ツールの列の上の「今の F0」に表示する。「設定」で表示のオン／オフ（実験の条件になるので操作ログに残す）。
(() => {
  const _ = AH._;
  const { $, video, S, addLog } = _;
  const C = _.f0calc, { SR, HOP, WIN, yin } = C;   // 計算は core/f0-calc.js（tools/voiced-why.js と共通）
  const F0 = { status: 'none', t0: 0, hop: HOP, f0: null, rms: null, file: '', lo: 100, hi: 400 };
  let shown = true;
  try { shown = localStorage.getItem('ahann_f0') !== '0'; } catch (_) {}

  // 音声全体を処理する（重いので少しずつ。alive() が偽になったら（ほかの動画に替わったら）打ち切る）
  async function analyse(samples, alive, progress) {
    const rms = C.rmsFrames(samples), n = rms.length, f0 = new Float32Array(n).fill(NaN);
    const floor = C.floorOf(rms);   // 小さすぎる音は声なしとする（最大の 5%、かつ -50dBFS 相当）
    for (let k = 0; k < n; k++) {
      if (rms[k] >= floor) f0[k] = yin(samples, C.frameOff(k));
      if (k % 150 === 149) { await new Promise(r => setTimeout(r, 0)); if (!alive()) return null; progress(Math.round(k / n * 100)); }
    }
    return { f0, rms };
  }
  // 表示の範囲：声ありの 5〜95 パーセンタイルを少し広げる（対数）
  function range(f0) {
    const v = Array.from(f0).filter(x => x > 0).sort((a, b) => a - b);
    if (!v.length) return [100, 400];
    const q = p => v[Math.min(v.length - 1, Math.floor(p * v.length))];
    let lo = q(0.05), hi = q(0.95);
    if (hi / lo < 1.5) { const m = Math.sqrt(hi * lo); lo = m / 1.22; hi = m * 1.22; }
    return [lo / 1.1, hi * 1.1];
  }
  function setStatus(t) { const el = $('f0Status'); if (el) el.textContent = t; }

  // ファイルの音声を 16kHz・モノラルにして F0 を求める。alive() が偽になったら打ち切って null を返す（基準音声の動画も使う。core/ref.js）
  async function compute(file, alive, progress = () => {}) {
    const buf = await file.arrayBuffer();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ac = new Ctx(); let decoded;
    try { decoded = await ac.decodeAudioData(buf); } finally { try { ac.close(); } catch (_) {} }
    if (!alive()) return null;
    const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * SR), SR);
    const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
    const mono = (await off.startRendering()).getChannelData(0);
    if (!alive()) return null;
    return analyse(mono, alive, progress);
  }
  async function load(file) {
    const token = F0.token = {};
    Object.assign(F0, { status: 'loading', f0: null, rms: null, file: file.name });
    setStatus('F0：音声を読み込み中…'); render();
    try {
      const r = await compute(file, () => token === F0.token, p => setStatus(`F0：計算中 ${p}%`)); if (!r) return;
      const [lo, hi] = range(r.f0);
      Object.assign(F0, { status: 'ready', f0: r.f0, rms: r.rms, lo, hi });
      const voiced = r.f0.filter(x => x > 0).length;
      setStatus(`F0：${voiced ? `声あり ${(voiced * HOP).toFixed(1)}秒、${Math.round(lo * 1.1)}〜${Math.round(hi / 1.1)}Hz` : '声が見つかりませんでした'}`);
      addLog('f0_ready', { detail: `frames=${r.f0.length} voiced=${voiced} range=${Math.round(lo)}-${Math.round(hi)}` });
    } catch (e) {
      if (token !== F0.token) return;
      F0.status = 'error'; setStatus('F0：この動画の音声を読み込めませんでした（' + (e && e.message || e) + '）');
      addLog('f0_error', { detail: String(e && e.message || e) });
    }
    render(); _.refresh();
  }
  // 時刻 t の F0（声なし・未計算なら NaN）
  function f0At(t) {
    if (F0.status !== 'ready') return NaN;
    const k = Math.max(0, Math.round((t - WIN / SR / 2) / HOP));   // 最初の窓の中心（0.02秒）より前は最初の窓
    return k >= 0 && k < F0.f0.length ? F0.f0[k] : NaN;
  }

  // ---------- 今の F0（ツールの列の上） ----------
  let lastShown = '';
  function render() {
    const box = $('f0Now'); if (!box) return;
    const on = shown && !!video.src;
    box.hidden = !on; document.body.classList.toggle('f0', shown);
    if (!on) return;
    const v = f0At(video.currentTime || 0);
    const txt = F0.status === 'ready' ? (v > 0 ? Math.round(v) + ' Hz' : '— （声なし）') : F0.status === 'loading' ? '計算中…' : '—';
    if (txt !== lastShown) { $('f0Val').textContent = txt; lastShown = txt; }
    const f = v > 0 ? Math.max(0, Math.min(1, Math.log(v / F0.lo) / Math.log(F0.hi / F0.lo))) : 0;
    $('f0Bar').style.width = (f * 100).toFixed(1) + '%';
    $('f0Bar').style.opacity = v > 0 ? 1 : 0.15;
  }
  function setShown(on) {
    if (shown === on) return;
    shown = on; try { localStorage.setItem('ahann_f0', on ? '1' : '0'); } catch (_) {}
    $('f0Show').checked = on; addLog('f0_display', { value: on ? 'on' : 'off' });
    render(); _.resize();
  }
  $('f0Show').checked = shown;
  $('f0Show').addEventListener('change', e => { setShown(e.target.checked); e.target.blur(); });
  document.body.classList.toggle('f0', shown);
  video.addEventListener('timeupdate', render);

  Object.assign(_, { F0, loadF0: load, computeF0: compute, f0At, f0Shown: () => shown, renderF0: render, setF0Shown: setShown, yin });
})();
