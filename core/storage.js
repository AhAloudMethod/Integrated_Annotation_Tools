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
      S.data = s.data; S.log = s.log; S.undo = s.undo || []; S.redo = [];
      S.meta = { ...s.meta, duration: video.duration };
      S.t0 = performance.now() - (S.log.length ? S.log[S.log.length - 1].wall_ms : 0);
      addLog('restore'); return true;
    } catch (_) { return false; }
  }
  // タブを閉じる・隠すときは書き込み中の区間を確定して保存
  const flush = () => { endStroke('hide'); autosave(); };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

  // 参加者IDの変更：この動画について全方式の保存データを新しいIDのキーへ移す。
  // 移し先に別のデータがある場合は確認し、キャンセルなら false（IDを元に戻す）
  function renameParticipant(oldId, newId) {
    if (oldId === newId) return true;
    if (!S.meta.video_file) { S.meta.participant = newId; return true; }
    endStroke('participant_change'); autosave();
    const k = (m, id) => `ahann4:${m}:${id}:${S.meta.video_file}`;
    try {
      const ms = Object.keys(modes).filter(m => localStorage.getItem(k(m, oldId)) != null);
      const clash = ms.filter(m => localStorage.getItem(k(m, newId)) != null);
      if (clash.length && !confirm(`参加者ID「${newId}」には、この動画の保存データが既にあります（${clash.map(m => modes[m].label).join('、')}）。
今の評価で上書きしますか？（キャンセルするとIDを元に戻します）`)) return false;
      for (const m of ms) { localStorage.setItem(k(m, newId), localStorage.getItem(k(m, oldId))); localStorage.removeItem(k(m, oldId)); }
    } catch (_) {}
    S.meta.participant = newId;
    addLog('participant_change', { detail: `${oldId} -> ${newId}` });   // 新しいキーへ保存される
    return true;
  }

  Object.assign(_, { autosave, tryRestore, renameParticipant });
})();
