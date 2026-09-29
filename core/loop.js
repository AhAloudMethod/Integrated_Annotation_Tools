// 毎フレームの処理（ストロークの開始・終了・サンプリング）
(() => {
  const _ = AH._;
  const { video, S, pen, strokeSample, startStroke, endStroke, writeMode, setArmed, padPoll, padPressed, refresh } = _;
  // ---------- 毎フレーム ----------
  let lastFrame = performance.now();
  function tick(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
    if (!video.seeking) S.lastTime = video.currentTime;
    padPoll();   // ゲームパッドを読む（方式の tick より先に）
    if (_.M && S.data) {
      if (_.M.tick) _.M.tick(dt);
      if (writeMode() === 'armed' && padPressed(0)) setArmed(!S.armed);
      const wm = writeMode();
      const want = wm === 'hold' ? (pen.down && !pen.clickEdit) : wm === 'armed' ? S.armed : false;
      const running = !video.paused && !video.seeking;
      if (want && !_.stroke && running) startStroke();
      else if (_.stroke && !want) endStroke(wm === 'hold' ? 'release' : 'disarm');
      else if (_.stroke && running) strokeSample();
      if (!video.paused || pen.down || _.stroke || _.M.animate) refresh();
    }
    requestAnimationFrame(tick);
  }

  Object.assign(_, { tick });
})();
