// 起動処理と公開 API（AH.*）
(() => {
  const _ = AH._;
  const { $, modes, syncRangeUI, selectMode, tick, setVideoSize } = _;
  function init() {
    const sel = $('mode'), groups = {};
    for (const m of Object.values(modes)) {
      if (!groups[m.group]) { groups[m.group] = document.createElement('optgroup'); groups[m.group].label = m.group; sel.appendChild(groups[m.group]); }
      const o = document.createElement('option'); o.value = m.id; o.textContent = m.label; groups[m.group].appendChild(o);
    }
    let vp = 55; try { vp = +localStorage.getItem('ahann_vidsize') || 55; } catch (_) {}
    setVideoSize(vp);
    selectMode(sel.value); syncRangeUI();
    requestAnimationFrame(tick);
  }

  // 公開 API（方式ファイルとテストが使う）
  const { S, pen, video, register, refresh, remount, addLog, pushUndo, snapshot, css, fitCanvas, fmt, clamp, r2,
    vt, valueAt, placePoint, deletePointBefore, penDown, penMove, penUp, setArmed, endStroke,
    nSec, curSec, inputSec, binStart, secLabel, rangeSig, inRange, setCell, setCells, addEvent, deleteEventBefore, seekTo, togglePlay, setOption,
    gamepad, quadColor, gradColor, intensity, rgba } = _;
  Object.assign(AH, {
    S, pen, video, init, register, refresh, remount, addLog, pushUndo, snapshot, css, fitCanvas, fmt, clamp, r2,
    vt, valueAt, placePoint, deletePointBefore, penDown, penMove, penUp, setArmed, endStroke, isWriting: () => !!_.stroke,
    nSec, curSec, inputSec, binStart, secLabel, rangeSig, inRange, setCell, setCells, addEvent, deleteEventBefore, seekTo, togglePlay, setOption,
    gamepad, quadColor, gradColor, intensity, rgba, hasVideo: () => !!video.src, ax: k => _.ax(k), relabel: t => _.relabel(t),
  });
  Object.defineProperty(AH, 'mode', { get() { return _.M; }, enumerable: true });
})();
