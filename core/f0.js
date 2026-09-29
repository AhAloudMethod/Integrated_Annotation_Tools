// 動画の音声の F0（声の高さ）：動画を開いたら音声を 16kHz・モノラルにして YIN で 10ms ごとに求める。
// 評価グラフの3段目（timeline.js）と、ツールの列の上の「今の F0」に表示する。「設定」で表示のオン／オフ（実験の条件になるので操作ログに残す）。
(() => {
  const _ = AH._;
  const { $, video, S, addLog } = _;
  const SR = 16000, HOP = 0.01, WIN = 640;        // 16kHz、10ms ごと、窓 40ms
  const FMIN = 70, FMAX = 1000;                   // 探す範囲（Hz）。叫び声の高い「あ」も入るよう広めに
  const YIN_TH = 0.15;                            // YIN のしきい値（小さいほど厳しく「声あり」とする）
  const F0 = { status: 'none', t0: 0, hop: HOP, f0: null, rms: null, file: '', lo: 100, hi: 400 };
  let shown = true;
  try { shown = localStorage.getItem('ahann_f0') !== '0'; } catch (_) {}

  // YIN（de Cheveigné & Kawahara, 2002）で1つの窓の F0 を求める。声がはっきりしなければ NaN
  function yin(x, off, sr = SR, win = WIN, fmin = FMIN, fmax = FMAX, th = YIN_TH) {
    const tMin = Math.max(2, Math.floor(sr / fmax)), tMax = Math.min(Math.floor(sr / fmin), win - 1);
    const d = new Float32Array(tMax + 2);
    for (let tau = 1; tau <= tMax + 1; tau++) {
      let s = 0;
      for (let i = 0; i < win - tMax - 1; i++) { const v = x[off + i] - x[off + i + tau]; s += v * v; }
      d[tau] = s;
    }
    // 累積平均で正規化した差分関数
    let run = 0; const dn = new Float32Array(tMax + 2); dn[0] = 1;
    for (let tau = 1; tau <= tMax + 1; tau++) { run += d[tau]; dn[tau] = run > 0 ? d[tau] * tau / run : 1; }
    let tau = -1;
    for (let t = tMin; t <= tMax; t++) if (dn[t] < th) { while (t + 1 <= tMax && dn[t + 1] < dn[t]) t++; tau = t; break; }
    if (tau < 0) return NaN;
    // 放物線補間で細かく
    const a = dn[tau - 1], b = dn[tau], c = dn[tau + 1], den = a - 2 * b + c;
    const shift = den !== 0 ? 0.5 * (a - c) / den : 0;
    return sr / (tau + (Math.abs(shift) < 1 ? shift : 0));
  }
  // 音声全体を処理する（重いので少しずつ。途中でほかの動画に替わったら打ち切る）
  async function analyse(samples, token) {
    const n = Math.max(0, Math.floor((samples.length - WIN) / (SR * HOP)) + 1);
    const f0 = new Float32Array(n).fill(NaN), rms = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const off = Math.round(k * SR * HOP);
      let e = 0; for (let i = 0; i < WIN; i++) e += samples[off + i] * samples[off + i];
      rms[k] = Math.sqrt(e / WIN);
    }
    // 小さすぎる音は声なしとする（最大の 5%、かつ -50dBFS 相当）
    let mx = 0; for (const v of rms) if (v > mx) mx = v;
    const floor = Math.max(0.003, mx * 0.05);
    for (let k = 0; k < n; k++) {
      if (rms[k] >= floor) f0[k] = yin(samples, Math.round(k * SR * HOP));
      if (k % 150 === 149) { await new Promise(r => setTimeout(r, 0)); if (token !== F0.token) return null; setStatus(`F0：計算中 ${Math.round(k / n * 100)}%`); }
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

  async function load(file) {
    const token = F0.token = {};
    Object.assign(F0, { status: 'loading', f0: null, rms: null, file: file.name });
    setStatus('F0：音声を読み込み中…'); render();
    try {
      const buf = await file.arrayBuffer();
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ac = new Ctx(); let decoded;
      try { decoded = await ac.decodeAudioData(buf); } finally { try { ac.close(); } catch (_) {} }
      if (token !== F0.token) return;
      // 16kHz・モノラルに変換
      const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * SR), SR);
      const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
      const mono = (await off.startRendering()).getChannelData(0);
      if (token !== F0.token) return;
      const r = await analyse(mono, token); if (!r) return;
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

  Object.assign(_, { F0, loadF0: load, f0At, f0Shown: () => shown, renderF0: render, setF0Shown: setShown, yin });
})();
