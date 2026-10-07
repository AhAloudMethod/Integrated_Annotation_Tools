// 動画の読み込み・再生制御・ヘッダーのボタン
(() => {
  const _ = AH._;
  const { $, video, S, clamp, addLog, syncRangeUI, pen, endStroke, setArmed, refresh, selectMode, switchMode, newSession } = _;
  // ---------- 動画 ----------
  function seekTo(t) { if (S.meta.duration) video.currentTime = clamp(t, 0, S.meta.duration); }
  function togglePlay() { if (!video.src) return; video.paused ? video.play() : video.pause(); }

  $('openBtn').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    openVideoFile(f);
    e.target.value = '';
  });
  // 動画のファイルを開く。onReady は読み込み（復元・評価区間の設定）を終えた後に呼ぶ（実験モードが使う）
  function openVideoFile(f, onReady) {
    setArmed(false); pen.down = false;   // 練習中の記録オンも解除
    if (video.src) { endStroke('reload'); _.autosave(); URL.revokeObjectURL(video.src); }
    video.src = URL.createObjectURL(f);
    S.videoSig = '';
    video.hidden = false; $('empty').hidden = true;
    S.meta.video_file = f.name; S.meta.participant = $('pid').value.trim();
    if (_.loadF0) _.loadF0(f);   // 動画の音声の F0 を計算しておく（表示しないときも。設定でいつでも出せるように）
    video.addEventListener('loadedmetadata', () => {
      S.meta.duration = video.duration;
      S.meta.range = null;
      S.videoSig = `${f.size}:${video.duration.toFixed(2)}`;
      if (!_.tryRestore()) newSession(`${f.name} dur=${video.duration.toFixed(3)} mode=${S.meta.mode}`);
      // この動画に覚えてある評価区間を使う（ファイル名を変えていても）。実験モードでは使わない（区間は setup.json か、再開した試行の区間）
      const saved = _.expOn && _.expOn() ? null : _.loadRange(f.name, S.videoSig);
      if (saved) {
        if (JSON.stringify(saved) !== JSON.stringify(S.meta.range)) { S.meta.range = saved; addLog('range_restore', { detail: JSON.stringify(saved) }); }
        _.saveRange();   // 今の名前でも覚え直す
      }
      video.playbackRate = +$('rate').value;
      selectMode(S.meta.mode, true); syncRangeUI(); refresh();
      if (onReady) onReady();
    }, { once: true });
  }
  video.addEventListener('play', () => { pen.clickEdit = false; addLog('play'); refresh(); });
  video.addEventListener('pause', () => { endStroke('pause'); addLog('pause'); refresh(); });
  video.addEventListener('seeking', () => endStroke('seek'));
  video.addEventListener('seeked', () => { addLog('seek', { detail: 'from ' + S.lastTime.toFixed(4) }); S.lastTime = video.currentTime; refresh(); });
  video.addEventListener('ended', () => { endStroke('ended'); addLog('ended'); });
  $('rate').addEventListener('change', e => { video.playbackRate = +e.target.value; addLog('rate', { value: e.target.value }); e.target.blur(); refresh(); });
  $('pid').addEventListener('change', e => {
    const id = e.target.value.trim();
    if (!_.renameParticipant(S.meta.participant, id)) e.target.value = S.meta.participant;
  });
  $('mode').addEventListener('change', e => { switchMode(e.target.value); e.target.blur(); });
  $('playBtn').addEventListener('click', e => { togglePlay(); e.target.blur(); });
  $('backBtn').addEventListener('click', e => { seekTo(video.currentTime - 1); e.target.blur(); });
  $('fwdBtn').addEventListener('click', e => { seekTo(video.currentTime + 1); e.target.blur(); });
  $('armBtn').addEventListener('click', e => { setArmed(!S.armed); e.target.blur(); });
  $('resetBtn').addEventListener('click', e => {
    e.currentTarget.blur();
    if (!S.data || !confirm('この動画・方式の評価の値をすべて消して、初期値に戻します（Ctrl+Z で戻せます）。よろしいですか？')) return;
    _.resetData();
  });
  $('graphEdit').addEventListener('change', e => { addLog('graph_edit', { value: e.target.checked }); e.target.blur(); });

  Object.assign(_, { seekTo, togglePlay, openVideoFile });
})();
