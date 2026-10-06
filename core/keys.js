// キー操作
(() => {
  const _ = AH._;
  const { video, S, undo, writeMode, setArmed, seekTo, togglePlay } = _;
  // ---------- キー操作 ----------
  document.addEventListener('keydown', e => {
    let tag = e.target.tagName;
    // 選択欄（方式・再生速度など）にフォーカスが残ったまま矢印・文字・Space を押すと、ブラウザが選択を切り替えてしまう
    // （↑↓ が入力キーの RankTrace・スロットルなどで、再生速度や方式が勝手に変わった）。選択欄を外して、ツールの操作として扱う
    if (tag === 'SELECT' && !e.altKey && !e.ctrlKey && !e.metaKey && (e.key.length === 1 || /^(Arrow|Page|Home$|End$)/.test(e.key))) {
      e.preventDefault(); e.target.blur(); tag = '';
    }
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;   // 入力欄（Excel方式のセル等）は各自で処理
    if (e.code === 'KeyV' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); _.setReview(!_.reviewing()); return; }
    if (_.reviewing()) {   // 見返しの間は再生・移動だけ（方式のキー入力は渡さない）
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { e.preventDefault(); seekTo(video.currentTime + (e.shiftKey ? 0.1 : 1) * (e.code === 'ArrowLeft' ? -1 : 1)); }
      return;
    }
    if (_.M && _.M.onKey && _.M.onKey(e)) { e.preventDefault(); return; }
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && _.listenLive() && _.listenRecord()) { e.preventDefault(); return; }
    if (e.code === 'KeyR' && _.listenLive() && _.listenReplay()) { e.preventDefault(); return; }
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      seekTo(video.currentTime + (e.shiftKey ? 0.1 : 1) * (e.code === 'ArrowLeft' ? -1 : 1));
    }
    else if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); undo(); }
    else if (e.code === 'KeyR' && writeMode() === 'armed') { e.preventDefault(); setArmed(!S.armed); }
  });
  document.addEventListener('keyup', e => { if (_.M && _.M.onKeyUp) _.M.onKeyUp(e); });
  window.addEventListener('blur', () => { if (_.M && _.M.onBlur) _.M.onBlur(); });
})();
