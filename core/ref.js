// 基準音声：ヘッダーの「基準音声」で、体験者の基準の「あ」を聴き直す。
// 声は評価する動画の最初に入っているか、基準音声の動画（別のファイル）に入っている。基準音声の動画は、通常の画面では「設定」の「基準音声の動画」で、
// 実験モードでは setup.json の動画ごとの refVideo か、録画の試行で実験者が選んだ録画（core/experiment.js）で決める。
// 位置は setup.json の動画ごとの ref（秒。実験モード。基準音声の動画があればその動画の秒）か、音声の F0（core/f0.js）で声が 50 ms 以上続いて最初に入る所。
// 声の 0.2 秒前から、その声が途切れるまで（0.3 秒の余白つき。長くても 4 秒）を再生して止める。評価する動画で鳴らしたときは押す前の位置に戻る。
// 基準音声の動画は隠した audio で鳴らし、評価する動画は止めたまま動かさない。再生の間は書き込まず、聴いてから入力でも止めない
(() => {
  const _ = AH._;
  const { $, video, S, addLog } = _;
  const LEAD = 0.2, TAIL = 0.3, MAX = 4, MIN_RUN = 5, GAP = 5;   // 前の余白・後の余白（秒）、声とみなす長さ・声の切れ目とみなさない隙間（10 ms の窓の数）
  const audio = $('refAudio');
  const RV = { file: null, status: 'none', f0: null, hop: 0.01, token: null };   // 基準音声の動画と、その音声の F0
  let play = null;   // 再生中なら { sep（基準音声の動画で鳴らしているか）, from（押す前の位置）, end（止める時刻） }
  // 最初の声の区間 { t0, t1 }（秒）。F0 を計算していなければ null
  function firstVoice(F) {
    if (!F || F.status !== 'ready') return null;
    const v = k => F.f0[k] > 0, n = F.f0.length;
    for (let k = 0; k < n; k++) {
      let r = 0; while (k + r < n && v(k + r)) r++;
      if (r < MIN_RUN) { k += r; continue; }
      let e = k + r, gap = 0;   // 短い切れ目はつなぐ
      for (let j = e; j < n && gap <= GAP; j++) { if (v(j)) { e = j + 1; gap = 0; } else gap++; }
      return { t0: k * F.hop, t1: Math.min(e * F.hop + 0.04, k * F.hop + MAX) };
    }
    return null;
  }
  const source = () => (RV.file ? RV : _.F0);
  // 基準音声の区間：setup.json の ref があれば、そこから最初の声の長さ（無ければ 1 秒）
  function refSpan() {
    const fv = firstVoice(source()), ref = S.meta.ref;
    if (typeof ref === 'number') return { t0: ref, t1: ref + (fv ? Math.min(fv.t1 - fv.t0, MAX) : 1) };
    return fv;
  }
  function render() {
    const f = RV.file;
    $('refVideoName').textContent = f ? f.name + (RV.status === 'loading' ? '（解析中）' : RV.status === 'error' ? '（音声を読み込めません）' : '') : '評価する動画の最初の声';
    $('refVideoClear').hidden = !f;
    $('refBtn').title = f ? `基準音声：「${f.name}」の最初の声を聴く` : '基準音声：動画の最初に入る声を聴き直す（終わると元の位置に戻る）';
  }
  // 基準音声の動画を決める（null なら評価する動画の最初の声に戻す）。how は操作ログに残す由来（setting・setup・record）
  function setRefVideo(f, how) {
    f = f || null;
    if (play) stop('change');
    if (f !== RV.file) {
      if (audio.src) { URL.revokeObjectURL(audio.src); audio.removeAttribute('src'); audio.load(); }
      const token = RV.token = {};
      Object.assign(RV, { file: f, status: f ? 'loading' : 'none', f0: null });
      if (f) {
        audio.src = URL.createObjectURL(f);
        _.computeF0(f, () => token === RV.token).then(r => {
          if (!r) return;
          Object.assign(RV, { status: 'ready', f0: r.f0 });
          render();
        }).catch(e => {
          if (token !== RV.token) return;
          RV.status = 'error'; render();
          addLog('ref_video_error', { detail: String(e && e.message || e) });
        });
      }
    }
    addLog('ref_video', { value: f ? 'set' : 'clear', detail: f ? `${f.name}${how ? ' ' + how : ''}` : (how || '') });
    render();
  }
  function start() {
    if (!video.src) return;
    if (play) { stop('again'); return; }
    const F = source(), r = refSpan();
    if (!r) {
      _.hintMsg(F && F.status === 'loading' ? '音声を解析しています。少し待ってから押してください'
        : RV.file && RV.status === 'error' ? '基準音声の動画の音声を読み込めません' : '基準音声が見つかりません');
      return;
    }
    _.setArmed(false); _.endStroke('ref'); _.pen.down = false;
    const sep = !!RV.file;
    if (sep) {
      if (!video.paused) video.pause();
      play = { sep, from: video.currentTime, end: r.t1 + TAIL };
      audio.currentTime = Math.max(0, r.t0 - LEAD);
      audio.play().catch(() => stop('error'));
    } else {
      play = { sep, from: video.currentTime, end: Math.min(r.t1 + TAIL, S.meta.duration) };
      video.currentTime = Math.max(0, r.t0 - LEAD);
      video.play();
    }
    addLog('ref_audio', { value: 'play', detail: `t=${r.t0.toFixed(3)}-${r.t1.toFixed(3)} from=${play.from.toFixed(3)}${typeof S.meta.ref === 'number' ? ' setup' : ' auto'}${sep ? ' video=' + RV.file.name : ''}` });
    $('refBtn').classList.add('on');
  }
  // 止める。評価する動画で鳴らしていたら、押す前の位置に戻る
  function stop(reason) {
    const p = play; play = null; if (!p) return;
    if (p.sep) { if (!audio.paused) audio.pause(); }
    else { if (!video.paused) video.pause(); video.currentTime = p.from; }
    $('refBtn').classList.remove('on');
    addLog('ref_audio', { value: 'end', detail: reason });
  }
  // 毎フレーム（core/loop.js）：終わりで止める
  function tick() {
    if (!play) return;
    const el = play.sep ? audio : video;
    if (el.currentTime >= play.end || el.ended) stop('end');
  }
  video.addEventListener('pause', () => { if (play && !play.sep && video.currentTime < play.end - 0.05) stop('pause'); });
  video.addEventListener('play', () => { if (play && play.sep) stop('play'); });   // 基準音声の動画を鳴らしている間に評価する動画を再生したら、基準音声を止める
  audio.addEventListener('pause', () => { if (play && play.sep && audio.currentTime < play.end - 0.05) stop('pause'); });
  $('refBtn').addEventListener('click', e => { e.currentTarget.blur(); start(); });
  $('refVideoPick').addEventListener('click', e => { e.currentTarget.blur(); $('refVideoFile').click(); });
  $('refVideoFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) setRefVideo(f, 'setting'); });
  $('refVideoClear').addEventListener('click', e => { e.currentTarget.blur(); setRefVideo(null, 'setting'); });
  render();

  Object.assign(_, { refPlaying: () => !!play, refTick: tick, refSpan, refStart: start, setRefVideo, refVideo: () => RV.file, refVideoF0: RV });
})();
