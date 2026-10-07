// 動画の大きさ・リサイズ
(() => {
  const _ = AH._;
  const { $, video, tl, fitCanvas, refresh } = _;
  // ---------- 動画の大きさ ----------
  function setVideoSize(p) {
    document.body.style.setProperty('--vp', p); $('vidSize').value = p; $('vidSizeLab').textContent = p + '%';
    try { localStorage.setItem('ahann_vidsize', p); } catch (_) {}
    resize();
  }
  $('vidSize').addEventListener('input', e => setVideoSize(+e.target.value));
  $('vidSize').addEventListener('change', e => e.target.blur());

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
    const f0 = $('f0Now'), f0h = f0 && !f0.hidden ? f0.offsetHeight + 8 : 0;   // 今の F0 の欄の分
    if (el) {
      const square = el.matches('canvas.plane, .arPlane');
      el.style.width = ''; el.style.height = '';
      if (square) el.style.width = '40px'; else el.style.height = '40px';
      const rest = panel.offsetHeight - 40;
      const avail = side.clientHeight - rest - f0h - 4;
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
      // 9個のボタンは同じ幅なので、絵（ほぼ正方形）の高さはボタンの幅（枠の内側）までにする（縦長のボタンにしない）
      const btns = panel.querySelector('.sam .samBtns'), b0 = btns && btns.querySelector('button');
      const bw = b0 ? b0.clientWidth - parseFloat(getComputedStyle(b0).paddingLeft) * 2 : 130;
      document.body.style.setProperty('--samH', Math.round(Math.max(40, Math.min(130, bw, (side.clientHeight - rest - f0h - 8) / rows))) + 'px');
    }
  }
  $('panel').addEventListener('toggle', () => resize(), true);   // カスタムの設計軸（details）の開閉

  // 動画欄の枠を動画の縦横比に合わせ、空いている範囲に収まる最大の大きさにする（黒帯を出さない）
  function fitStage() {
    const st = $('stage'), main = document.querySelector('main');
    st.style.width = ''; st.style.height = '';
    if (document.body.classList.contains('pip') || window.innerWidth <= 900) return;
    const ar = (video.videoWidth && video.videoHeight) ? video.videoWidth / video.videoHeight : 16 / 9;
    const cs = getComputedStyle(main);
    const cw = parseFloat(cs.gridTemplateColumns), ch = parseFloat(cs.gridTemplateRows);
    if (!(cw > 0 && ch > 0)) return;
    const w = Math.min(cw, ch * ar);
    st.style.width = Math.floor(w) + 'px'; st.style.height = Math.floor(w / ar) + 'px';
  }

  function resize() { fitStage(); fitTools(); fitCanvas(tl); if (_.M && _.M.resize) _.M.resize(); refresh(); }
  window.addEventListener('resize', resize);

  let tlOn = false; try { tlOn = localStorage.getItem('ahann_tl') === '1'; } catch (_) {}
  document.body.classList.toggle('noTl', !tlOn); $('tlBtn').classList.toggle('on', tlOn);

  Object.assign(_, { setVideoSize, resize, setTimeline, closePops });
})();
