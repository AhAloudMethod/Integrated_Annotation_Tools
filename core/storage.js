// 自動保存と復元（localStorage）
(() => {
  const _ = AH._;
  const { video, modes, S, addLog, endStroke } = _;
  // ---------- 自動保存（方式＋参加者ID＋動画名で復元） ----------
  const key = () => `ahann4:${S.meta.mode}:${S.meta.participant}:${S.meta.video_file}`;
  function autosave() {
    if (!S.meta.video_file || !S.data) return;
    try { localStorage.setItem(key(), JSON.stringify({ meta: S.meta, data: S.data, log: S.log, undo: S.undo.slice(-10) })); } catch (_) {}
  }
  function tryRestore() {
    try {
      const raw = localStorage.getItem(key()); if (!raw) return false;
      const s = JSON.parse(raw);
      if (!confirm(`「${modes[S.meta.mode].label}」でこの参加者ID・動画の途中データがあります。続きから再開しますか？\n（キャンセルすると新しく始めます）`)) {
        localStorage.removeItem(key()); return false;
      }
      S.data = s.data; S.log = s.log; S.undo = s.undo || [];
      S.meta = { ...s.meta, duration: video.duration };
      S.t0 = performance.now() - (S.log.length ? S.log[S.log.length - 1].wall_ms : 0);
      addLog('restore'); return true;
    } catch (_) { return false; }
  }
  // タブを閉じる・隠すときは書き込み中の区間を確定して保存
  const flush = () => { endStroke('hide'); autosave(); };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

  Object.assign(_, { autosave, tryRestore });
})();
