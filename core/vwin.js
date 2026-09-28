// 動画を別ウィンドウに出す（ノートPCで評価し、動画はモニターに出す使い方）
// window.open('') の空ページは開いた側と同じオリジンになるので、動画の要素そのものを移し替える。
// 再生・シーク・ログはすべて同じ video 要素で行われるので、評価側の処理は何も変わらない。
// Chrome・Edge・Firefox 系（Zen など）で動く。
(() => {
  const _ = AH._;
  const { $, video, addLog } = _;
  let win = null, poll = null;

  function open() {
    if (win && !win.closed) { win.focus(); return; }
    win = window.open('', 'ah_video', 'popup,width=960,height=560');
    if (!win) { $('status').textContent = 'ウィンドウを開けませんでした（ポップアップがブロックされています）'; return; }
    const d = win.document;
    d.title = '動画 – あアラウド アノテーション';
    d.body.innerHTML = '';
    d.body.style.cssText = 'margin:0;background:#000;height:100vh;overflow:hidden;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif';
    const tip = d.createElement('div');
    tip.textContent = 'このウィンドウをモニターへ移動し、ダブルクリックで全画面にできます。閉じると動画は元の画面に戻ります。';
    tip.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);color:#ddd;background:rgba(0,0,0,.6);padding:6px 12px;border-radius:4px;font-size:13px;transition:opacity 1s';
    d.body.appendChild(tip);
    setTimeout(() => { tip.style.opacity = '0'; }, 5000);
    const t = video.currentTime, playing = !video.paused;
    d.body.appendChild(video);                                  // 要素ごと移す（同じ video のまま）
    video.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block';
    if (Math.abs(video.currentTime - t) > 0.05) video.currentTime = t;
    if (playing && video.paused) video.play().catch(() => {});
    // ダブルクリックで全画面の切り替え
    d.addEventListener('dblclick', () => (d.fullscreenElement ? d.exitFullscreen() : d.documentElement.requestFullscreen().catch(() => {})));
    // 動画ウィンドウを選んでいてもキー操作が効くよう、評価側へ転送する
    for (const type of ['keydown', 'keyup']) d.addEventListener(type, e => {
      if (e.key === 'F11' || (e.key === 'Escape' && d.fullscreenElement)) return;
      const ev = new KeyboardEvent(type, { key: e.key, code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, repeat: e.repeat, bubbles: true, cancelable: true });
      document.dispatchEvent(ev);
      if (ev.defaultPrevented) e.preventDefault();
    });
    win.addEventListener('blur', () => { if (_.M && _.M.onBlur) _.M.onBlur(); });   // 押しっぱなしのキーを解除
    win.addEventListener('pagehide', back);
    clearInterval(poll); poll = setInterval(() => { if (!win || win.closed) back(); }, 500);
    document.body.classList.add('pip', 'vwin'); $('vwinBtn').textContent = '動画を戻す'; $('vwinBtn').classList.add('on');
    addLog('video_window', { value: 'on' }); _.resize();
  }

  function back() {
    clearInterval(poll); poll = null;
    if (video.ownerDocument !== document) {
      const t = video.currentTime, playing = !video.paused;
      $('stage').insertBefore(video, $('overlay'));
      video.style.cssText = '';
      if (Math.abs(video.currentTime - t) > 0.05) video.currentTime = t;
      if (playing && video.paused) video.play().catch(() => {});
    }
    if (win && !win.closed) win.close();
    win = null;
    if (!document.body.classList.contains('vwin')) return;
    document.body.classList.remove('pip', 'vwin'); $('vwinBtn').textContent = '動画を別窓へ'; $('vwinBtn').classList.remove('on');
    addLog('video_window', { value: 'off' }); _.resize();
  }

  $('vwinBtn').addEventListener('click', e => { e.currentTarget.blur(); if (document.body.classList.contains('vwin')) back(); else open(); });
  // 「元に戻す」は別ウィンドウにも効かせる（小窓の戻し方は layout.js 側）
  $('pipBack').addEventListener('click', () => { if (document.body.classList.contains('vwin')) back(); }, true);
  window.addEventListener('pagehide', () => { if (win && !win.closed) win.close(); });

  Object.assign(_, { openVideoWindow: open, closeVideoWindow: back });
})();
