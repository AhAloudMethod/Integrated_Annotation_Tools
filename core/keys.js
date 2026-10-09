// キー操作
(() => {
  const _ = AH._;
  const { video, S, undo, redo, writeMode, setArmed, seekTo, togglePlay } = _;
  // ←→：評価区間の前・次の区間の始めへ（評価区間の外からは最初・最後の区間へ）。Shift+←→ は 0.1 秒、Ctrl+←→ は 1 フレーム
  function arrow(e) {
    const d = e.code === 'ArrowLeft' ? -1 : 1;
    if (e.ctrlKey || e.metaKey) { _.frameStep(d); return; }
    if (e.shiftKey) { seekTo(video.currentTime + 0.1 * d); return; }
    const n = _.nSec(), b = _.binAt(video.currentTime || 0);
    const s = b < 0 ? (d > 0 ? 0 : -1) : b >= n ? (d < 0 ? n - 1 : n) : b + d;
    if (s >= 0 && s < n) seekTo(_.binStart(s) + 0.001);
  }
  // ---------- キー操作 ----------
  document.addEventListener('keydown', e => {
    let tag = e.target.tagName;
    // 選択欄（方式・再生速度など）にフォーカスが残ったまま矢印・文字・Space を押すと、ブラウザが選択を切り替えてしまう
    // （↑↓ が入力キーの RankTrace・スロットルなどで、再生速度や方式が勝手に変わった）。選択欄を外して、ツールの操作として扱う
    if (tag === 'SELECT' && !e.altKey && !e.ctrlKey && !e.metaKey && (e.key.length === 1 || /^(Arrow|Page|Home$|End$)/.test(e.key))) {
      e.preventDefault(); e.target.blur(); tag = '';
    }
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;   // 入力欄（Excel方式のセル等）は各自で処理
    if ((e.code === 'Comma' || e.code === 'Period') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); _.frameStep(e.code === 'Comma' ? -1 : 1); return; }   // 1フレーム移動
    if (e.code === 'KeyV' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); _.setReview(!_.reviewing()); return; }
    if (e.code === 'KeyH' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); _.setVoicedShown(!_.voicedShown(), 'key'); return; }   // 発声の区間の表示（core/voiced.js）
    if (_.reviewing()) {   // 視聴の間は再生・移動だけ（方式のキー入力は渡さない）
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { e.preventDefault(); arrow(e); }
      return;
    }
    if (_.M && _.M.onKey && _.M.onKey(e)) { e.preventDefault(); return; }
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && _.listenUsable() && _.listenRecord()) { e.preventDefault(); return; }
    if (e.code === 'KeyR' && _.listenUsable() && _.listenReplay()) { e.preventDefault(); return; }
    if (e.code === 'KeyC' && !e.ctrlKey && !e.metaKey && !e.altKey && _.cutNow()) { e.preventDefault(); return; }   // 今の時間で区切る
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { e.preventDefault(); arrow(e); }
    else if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (e.code === 'KeyY' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); redo(); }
    else if (e.code === 'KeyR' && writeMode() === 'armed') { e.preventDefault(); setArmed(!S.armed); }
  });
  document.addEventListener('keyup', e => { if (_.M && _.M.onKeyUp) _.M.onKeyUp(e); });
  window.addEventListener('blur', () => { if (_.M && _.M.onBlur) _.M.onBlur(); });
})();
