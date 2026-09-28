// 動画の大きさ・小窓（ピクチャーインピクチャー）・リサイズ
(() => {
  const _ = AH._;
  const { $, video, tl, addLog, fitCanvas, refresh } = _;
  // ---------- 動画の大きさ・小窓（ピクチャーインピクチャー） ----------
  function setVideoSize(p) {
    document.body.style.setProperty('--vp', p); $('vidSize').value = p; $('vidSizeLab').textContent = p + '%';
    try { localStorage.setItem('ahann_vidsize', p); } catch (_) {}
    resize();
  }
  $('vidSize').addEventListener('input', e => setVideoSize(+e.target.value));
  $('vidSize').addEventListener('change', e => e.target.blur());
  // Chrome・Edge はピクチャーインピクチャーの API で小窓にする。
  // Firefox 系（Zen など）は API がないので、ブラウザ自身の小窓の開き方を案内し、こちらは動画欄をたたむだけにする
  const hasPipApi = !!(document.pictureInPictureEnabled && video.requestPictureInPicture);
  const pipLabel = on => (hasPipApi ? (on ? '小窓を戻す' : '小窓で再生') : (on ? '動画欄を戻す' : '動画欄をたたむ'));
  function setCollapsed(on) {
    document.body.classList.toggle('pip', on); $('pipBtn').textContent = pipLabel(on); $('pipHelp').hidden = true;
    addLog('pip', { value: on ? 'on' : 'off', detail: hasPipApi ? 'api' : 'manual' }); resize();
  }
  $('pipBtn').textContent = pipLabel(false);
  $('pipBtn').addEventListener('click', async e => {
    e.target.blur();
    if (!hasPipApi) {
      if (document.body.classList.contains('pip')) setCollapsed(false);
      else $('pipHelp').hidden = !$('pipHelp').hidden;
      return;
    }
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (video.src) await video.requestPictureInPicture();
    } catch (err) { $('status').textContent = '小窓にできませんでした：' + err.message; }
  });
  $('pipCollapse').addEventListener('click', e => { e.target.blur(); setCollapsed(true); });
  $('pipBack').addEventListener('click', () => { if (document.pictureInPictureElement) document.exitPictureInPicture(); else setCollapsed(false); });
  video.addEventListener('enterpictureinpicture', () => setCollapsed(true));
  video.addEventListener('leavepictureinpicture', () => setCollapsed(false));

  function resize() { fitCanvas(tl); if (_.M && _.M.resize) _.M.resize(); refresh(); }
  window.addEventListener('resize', resize);

  Object.assign(_, { setVideoSize, resize });
})();
