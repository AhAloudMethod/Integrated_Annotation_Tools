// 1フレームずつの移動（評価区間の開始・終了をフレーム単位で合わせる）
// ブラウザは動画のフレームレートを教えないので、再生中に表示されたフレームの時刻（requestVideoFrameCallback）から推定する。
// 推定できないブラウザ（Firefox 系など）や推定前は 30 fps。評価区間の欄で手で直せる（動画ごとに覚える：ahann_fps:<大きさ:長さ>）。
// フレーム k は時刻 [k/fps, (k+1)/fps) に表示される。移動先は k/fps の少し後（境目ちょうどだと前のフレームが出ることがある）
(() => {
  const _ = AH._;
  const { $, video, S, addLog } = _;
  const COMMON = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120];
  const EPS = 0.001;
  let fr = { fps: 30, source: 'default' };   // source：default（推定前・推定できない）／auto（推定）／manual（手で入れた）
  const key = () => 'ahann_fps:' + S.videoSig;
  const save = () => { try { if (S.videoSig) localStorage.setItem(key(), JSON.stringify(fr)); } catch (_) {} };
  function load() {
    fr = { fps: 30, source: 'default' };
    try { const v = JSON.parse(localStorage.getItem(key()) || 'null'); if (v && v.fps > 0) fr = v; } catch (_) {}
    deltas.length = 0; last = null; sync();
  }
  const fps = () => fr.fps;
  const frameAt = t => Math.max(0, Math.floor(t * fr.fps + 0.01));
  const frameStart = t => +(frameAt(t) / fr.fps).toFixed(4);   // 今表示しているフレームの始まりの時刻

  // ---------- 推定：再生中に連続して表示されたフレームの時刻の差の中央値 ----------
  const deltas = []; let last = null;
  function onFrame(now, md) {
    if (last && md.presentedFrames - last.n === 1) {
      const d = md.mediaTime - last.t;
      if (d > 0.003 && d < 0.2) { deltas.push(d); if (deltas.length > 90) deltas.shift(); }
    }
    last = { n: md.presentedFrames, t: md.mediaTime };
    if (fr.source !== 'manual' && deltas.length >= 15) {
      // 中央値の ±20% にある差（1フレーム分）の平均で、29.97 と 30 のような近い値も見分ける。よく使う値のうち最も近いもの（0.3% 以内）に揃える
      const m = [...deltas].sort((a, b) => a - b)[deltas.length >> 1], one = deltas.filter(d => Math.abs(d - m) < 0.2 * m);
      let f = one.length / one.reduce((a, b) => a + b, 0);
      const c = COMMON.reduce((best, x) => (Math.abs(x - f) < Math.abs(best - f) ? x : best));
      f = Math.abs(c - f) / c < 0.003 ? c : +f.toFixed(3);
      if (f !== fr.fps || fr.source !== 'auto') { fr = { fps: f, source: 'auto' }; save(); addLog('fps', { value: f, detail: 'auto' }); sync(); }
    }
    video.requestVideoFrameCallback(onFrame);
  }
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(onFrame);
  video.addEventListener('loadedmetadata', () => setTimeout(load, 0));   // video.js が S.videoSig を決めた後に読む

  // ---------- 1フレーム移動（, と . ・評価区間の欄のボタン） ----------
  function step(d) {
    if (!video.src) return;
    if (!video.paused) video.pause();
    const k = Math.max(0, frameAt(video.currentTime) + d);
    _.seekTo(Math.min(k / fr.fps + EPS, (S.meta.duration || Infinity) - EPS));
  }
  $('rgBtn').addEventListener('click', () => setTimeout(sync, 0));   // 欄を開いたら今のフレームを出す
  $('frBack').addEventListener('click', e => { step(-1); e.currentTarget.blur(); });
  $('frFwd').addEventListener('click', e => { step(1); e.currentTarget.blur(); });
  $('rgFps').addEventListener('change', e => {
    const v = +e.target.value;
    if (v > 0 && v <= 240) { fr = { fps: v, source: 'manual' }; save(); addLog('fps', { value: v, detail: 'manual' }); }
    sync(); e.target.blur();
  });
  // 評価区間の欄の表示：今のフレーム番号とフレームレート
  function sync() {
    const lab = { default: '仮', auto: '推定', manual: '手入力' }[fr.source];
    if (document.activeElement !== $('rgFps')) $('rgFps').value = fr.fps;
    $('frInfo').textContent = `フレーム ${frameAt(video.currentTime || 0)}（${lab}）`;
  }

  Object.assign(_, { fps, frameAt, frameStart, frameStep: step, frameSync: sync, fpsMeta: () => ({ ...fr }) });
})();
