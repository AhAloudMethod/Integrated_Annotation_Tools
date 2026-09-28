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
    setArmed(false); pen.down = false;   // 練習中の記録オンも解除
    if (video.src) { endStroke('reload'); _.autosave(); URL.revokeObjectURL(video.src); }
    video.src = URL.createObjectURL(f);
    video.hidden = false; $('empty').hidden = true;
    S.meta.video_file = f.name; S.meta.participant = $('pid').value.trim();
    video.addEventListener('loadedmetadata', () => {
      S.meta.duration = video.duration;
      S.meta.range = null;
      if (!_.tryRestore()) newSession(`${f.name} dur=${video.duration.toFixed(3)} mode=${S.meta.mode}`);
      video.playbackRate = +$('rate').value;
      selectMode(S.meta.mode, true); syncRangeUI(); refresh();
    }, { once: true });
    e.target.value = '';
  });
  video.addEventListener('play', () => { pen.clickEdit = false; addLog('play'); refresh(); });
  video.addEventListener('pause', () => { endStroke('pause'); addLog('pause'); refresh(); });
  video.addEventListener('seeking', () => endStroke('seek'));
  video.addEventListener('seeked', () => { addLog('seek', { detail: 'from ' + S.lastTime.toFixed(4) }); S.lastTime = video.currentTime; refresh(); });
  video.addEventListener('ended', () => { endStroke('ended'); addLog('ended'); });
  $('rate').addEventListener('change', e => { video.playbackRate = +e.target.value; addLog('rate', { value: e.target.value }); e.target.blur(); });
  $('pid').addEventListener('change', e => { S.meta.participant = e.target.value.trim(); });
  $('mode').addEventListener('change', e => { switchMode(e.target.value); e.target.blur(); });
  $('playBtn').addEventListener('click', e => { togglePlay(); e.target.blur(); });
  $('backBtn').addEventListener('click', e => { seekTo(video.currentTime - 1); e.target.blur(); });
  $('fwdBtn').addEventListener('click', e => { seekTo(video.currentTime + 1); e.target.blur(); });
  $('armBtn').addEventListener('click', e => { setArmed(!S.armed); e.target.blur(); });
  $('graphEdit').addEventListener('change', e => { addLog('graph_edit', { value: e.target.checked }); e.target.blur(); });

  Object.assign(_, { seekTo, togglePlay });
})();
