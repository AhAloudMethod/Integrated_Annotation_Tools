// 基準音声：ヘッダーの「基準音声」で、動画の最初に入る声（体験者の基準の「あ」）を聴き直す。
// 位置は setup.json の動画ごとの ref（秒。実験モード）か、動画の音声の F0（core/f0.js）で声が 50 ms 以上続いて最初に入る所。
// 声の 0.2 秒前から、その声が途切れるまで（0.3 秒の余白つき。長くても 4 秒）を再生して止め、押す前の位置に戻る。再生の間は書き込まず、聴いてから入力でも止めない
(() => {
  const _ = AH._;
  const { $, video, S, addLog } = _;
  const LEAD = 0.2, TAIL = 0.3, MAX = 4, MIN_RUN = 5, GAP = 5;   // 前の余白・後の余白（秒）、声とみなす長さ・声の切れ目とみなさない隙間（10 ms の窓の数）
  let play = null;   // 再生中なら { from（押す前の位置）, end（止める時刻） }
  // 最初の声の区間 { t0, t1 }（秒）。F0 を計算していなければ null
  function firstVoice() {
    const F = _.F0; if (!F || F.status !== 'ready') return null;
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
  // 基準音声の区間：setup.json の ref があれば、そこから最初の声の長さ（無ければ 1 秒）
  function refSpan() {
    const fv = firstVoice(), ref = S.meta.ref;
    if (typeof ref === 'number') return { t0: ref, t1: ref + (fv ? Math.min(fv.t1 - fv.t0, MAX) : 1) };
    return fv;
  }
  function start() {
    if (!video.src) return;
    if (play) { stop('again'); return; }
    const r = refSpan();
    if (!r) { _.hintMsg(_.F0 && _.F0.status === 'loading' ? '音声を解析しています。少し待ってから押してください' : '基準音声が見つかりません'); return; }
    _.setArmed(false); _.endStroke('ref'); _.pen.down = false;
    play = { from: video.currentTime, end: Math.min(r.t1 + TAIL, S.meta.duration) };
    addLog('ref_audio', { value: 'play', detail: `t=${r.t0.toFixed(3)}-${r.t1.toFixed(3)} from=${play.from.toFixed(3)}${typeof S.meta.ref === 'number' ? ' setup' : ' auto'}` });
    video.currentTime = Math.max(0, r.t0 - LEAD);
    video.play();
    $('refBtn').classList.add('on');
  }
  // 止めて、押す前の位置に戻る
  function stop(reason) {
    const p = play; play = null; if (!p) return;
    if (!video.paused) video.pause();
    video.currentTime = p.from;
    $('refBtn').classList.remove('on');
    addLog('ref_audio', { value: 'end', detail: reason });
  }
  // 毎フレーム（core/loop.js）：終わりで止める
  function tick() { if (play && (video.currentTime >= play.end || video.ended)) stop('end'); }
  video.addEventListener('pause', () => { if (play && video.currentTime < play.end - 0.05) stop('pause'); });
  $('refBtn').addEventListener('click', e => { e.currentTarget.blur(); start(); });

  Object.assign(_, { refPlaying: () => !!play, refTick: tick, refSpan, refStart: start });
})();
