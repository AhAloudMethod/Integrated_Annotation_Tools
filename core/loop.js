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
      const listen = _.listenUsable() && !_.refPlaying();   // 聴いてから入力：区間の終わりで止め、ボタン0で同じ区間を再生し直して記録（core/listen.js）。基準音声の再生中は止めない
      _.refTick();   // 基準音声（core/ref.js）：終わりで止めて元の位置に戻る
      if (_.expBlocked && _.expBlocked()) { /* 実験モードの開始前・完了後：ボタン0は効かない */ }
      else if (_.refPlaying()) { /* 基準音声の再生中は書き込みもボタン0も効かない */ }
      else if (_.reviewing()) { if (padPressed(0)) _.togglePlay(); }   // 視聴：ボタン0は再生／停止
      else if (listen) { _.listenTick(); if (padPressed(0)) _.listenRecord(); }
      else if (writeMode() === 'armed' && padPressed(0)) setArmed(!S.armed);
      const wm = writeMode();
      const want = _.refPlaying() ? false : listen ? _.listenRecording() : wm === 'hold' ? (pen.down && !pen.clickEdit) : wm === 'armed' ? S.armed : false;
      const running = !video.paused && !video.seeking;
      if (want && !_.stroke && running) startStroke(listen ? (_.listenTakeStart() ?? video.currentTime) : undefined);
      else if (_.stroke && !want) endStroke(wm === 'hold' ? 'release' : 'disarm');
      else if (_.stroke && running) strokeSample();
      if (!video.paused || pen.down || _.stroke || _.M.animate) refresh();
    }
    requestAnimationFrame(tick);
  }

  Object.assign(_, { tick });
})();
