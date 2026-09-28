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
  $('pipBack').addEventListener('click', () => { if (document.body.classList.contains('vwin')) return; if (document.pictureInPictureElement) document.exitPictureInPicture(); else setCollapsed(false); });
  video.addEventListener('enterpictureinpicture', () => setCollapsed(true));
  video.addEventListener('leavepictureinpicture', () => setCollapsed(false));

  // ---------- 設定・説明のパネル（ヘッダーから開く。外側をクリックすると閉じる） ----------
  const POPS = [['setBtn', 'setPanel'], ['helpBtn', 'helpPanel'], ['rgBtn', 'rgPanel']];
  for (const [b, p] of POPS.slice(0, 2)) $(b).addEventListener('click', e => { const open = $(p).hidden; closePops(); $(p).hidden = !open; e.currentTarget.blur(); });
  function closePops(except) { for (const [, p] of POPS) if (p !== except) $(p).hidden = true; }
  document.addEventListener('pointerdown', e => {
    for (const [b, p] of POPS) if (!$(p).hidden && !$(p).contains(e.target) && !$(b).contains(e.target)) $(p).hidden = true;
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePops(); });

  // ---------- 評価グラフの開閉（状態はブラウザに保存。既定は閉じる） ----------
  function setTimeline(on) {
    document.body.classList.toggle('noTl', !on); $('tlBtn').classList.toggle('on', on);
    try { localStorage.setItem('ahann_tl', on ? '1' : '0'); } catch (_) {}
    resize();
  }
  $('tlBtn').addEventListener('click', e => { setTimeline(document.body.classList.contains('noTl')); e.currentTarget.blur(); });

  // ---------- ツールの入力面を空いている高さに合わせる ----------
  // 右の列（.side）に収まるよう、入力面（平面・スライダー・軌跡・AffectRank）の大きさを決める。
  // 下の欄の SAM の絵は、画面の高さに合わせて縮める
  function fitTools() {
    const side = document.querySelector('.side'), panel = $('panel');
    const el = panel.querySelector('canvas.plane, canvas.bars, canvas.trace, .arPlane');
    if (el) {
      const square = el.matches('canvas.plane, .arPlane');
      el.style.width = ''; el.style.height = '';
      if (square) el.style.width = '40px'; else el.style.height = '40px';
      const rest = panel.offsetHeight - 40;
      const avail = side.clientHeight - rest - 4;
      const box = el.parentElement, cs = getComputedStyle(box);
      const colW = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      if (square) el.style.width = Math.max(150, Math.min(colW, avail)) + 'px';
      else el.style.height = Math.max(150, Math.min(el.matches('canvas.bars') ? 360 : 320, avail)) + 'px';
    }
    // SAM：2行の絵が右の列に収まる高さにする
    if (panel.querySelector('.sam')) {
      document.body.style.setProperty('--samH', '40px');
      const rest = panel.offsetHeight - 40 * panel.querySelectorAll('.sam .samRow').length;
      const rows = Math.max(1, panel.querySelectorAll('.sam .samRow').length);
      document.body.style.setProperty('--samH', Math.round(Math.max(40, Math.min(130, (side.clientHeight - rest - 8) / rows))) + 'px');
    }
  }
  $('panel').addEventListener('toggle', () => resize(), true);   // カスタムの設計軸（details）の開閉

  function resize() { fitTools(); fitCanvas(tl); if (_.M && _.M.resize) _.M.resize(); refresh(); }
  window.addEventListener('resize', resize);

  let tlOn = false; try { tlOn = localStorage.getItem('ahann_tl') === '1'; } catch (_) {}
  document.body.classList.toggle('noTl', !tlOn); $('tlBtn').classList.toggle('on', tlOn);

  Object.assign(_, { setVideoSize, resize, setTimeline, closePops, setCollapsed });
})();
