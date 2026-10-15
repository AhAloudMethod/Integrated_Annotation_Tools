// 1フレームずつの移動（評価区間の開始・終了をフレーム単位で合わせる）
// ブラウザは動画のフレームレートを教えないので、開いたときにファイル（MP4・MOV）の情報から読む。
// 読めないファイル（WebM など）は、再生中に表示されたフレームの時刻（requestVideoFrameCallback）から推定する。
// 推定できないブラウザ（Firefox 系など）や推定前は 30 fps。評価区間の欄で手で直せる（動画ごとに覚える：ahann_fps:<大きさ:長さ>）。
// フレーム k は時刻 [k/fps, (k+1)/fps) に表示される。移動先は k/fps の少し後（境目ちょうどだと前のフレームが出ることがある）
(() => {
  const _ = AH._;
  const { $, video, S, addLog } = _;
  const COMMON = [24000 / 1001, 24, 25, 30000 / 1001, 30, 48, 50, 60000 / 1001, 60, 120];   // 23.976・29.97・59.94 は格子に乗るかを正確に見るため分数で持つ
  const EPS = 0.001;
  let fr = { fps: 30, source: 'default' };   // source：default（推定前・推定できない）／file（ファイルの情報）／auto（推定）／manual（手で入れた）
  const key = () => 'ahann_fps:' + S.videoSig;
  const save = () => { try { if (S.videoSig) localStorage.setItem(key(), JSON.stringify(fr)); } catch (_) {} };
  function load() {
    fr = { fps: 30, source: 'default' };
    try { const v = JSON.parse(localStorage.getItem(key()) || 'null'); if (v && v.fps > 0) fr = v; } catch (_) {}
    recs.length = 0; sync();
    const src = video.src;
    if (fr.source !== 'manual' && _.videoFile) readContainerFps(_.videoFile).then(f => {
      if (!f || video.src !== src || fr.source === 'manual' || (fr.source === 'file' && fr.fps === f)) return;
      fr = { fps: f, source: 'file' }; save(); addLog('fps', { value: f, detail: 'file' }); sync();
    });
  }
  const fps = () => fr.fps;
  const frameAt = t => Math.max(0, Math.floor(t * fr.fps + 0.01));
  const frameStart = t => +(frameAt(t) / fr.fps).toFixed(4);   // 今表示しているフレームの始まりの時刻

  // ---------- ファイルの情報（MP4・MOV の moov の箱）から読む ----------
  // 映像トラックの mdhd の timescale を、stts（フレームの表示間隔の表）でいちばん多い間隔で割る。
  // 間隔がそろっていない（可変フレームレート）・moov が無い（断片化した MP4、WebM など）ときは null
  async function readContainerFps(file) {
    try {
      const str = (d, o) => String.fromCharCode(d.getUint8(o), d.getUint8(o + 1), d.getUint8(o + 2), d.getUint8(o + 3));
      // 箱の並び [s, e) を { t: 種類, s: 中身の始まり, e: 終わり } にする
      const kids = (d, s, e) => {
        const r = [];
        while (s + 8 <= e) {
          let size = d.getUint32(s), h = 8;
          if (size === 1) { size = Number(d.getBigUint64(s + 8)); h = 16; } else if (size === 0) size = e - s;
          if (size < h || s + size > e) break;
          r.push({ t: str(d, s + 4), s: s + h, e: s + size }); s += size;
        }
        return r;
      };
      // ファイルの先頭から箱の見出しだけを読んで moov を探す（moov は先頭にも末尾にもありうる）
      let pos = 0, moov = null;
      while (pos + 8 <= file.size) {
        const h = new DataView(await file.slice(pos, pos + 16).arrayBuffer());
        let size = h.getUint32(0);
        if (size === 1) size = Number(h.getBigUint64(8)); else if (size === 0) size = file.size - pos;
        if (size < 8) return null;
        if (str(h, 4) === 'moov') { moov = new DataView(await file.slice(pos, pos + size).arrayBuffer()); break; }
        pos += size;
      }
      if (!moov) return null;
      const find = (b, path) => path.reduce((x, t) => x && kids(moov, x.s, x.e).find(k => k.t === t), b);
      for (const trak of kids(moov, 8, moov.byteLength).filter(b => b.t === 'trak')) {
        const hdlr = find(trak, ['mdia', 'hdlr']), mdhd = find(trak, ['mdia', 'mdhd']), stts = find(trak, ['mdia', 'minf', 'stbl', 'stts']);
        if (!hdlr || !mdhd || !stts || str(moov, hdlr.s + 8) !== 'vide') continue;
        const scale = moov.getUint32(mdhd.s + (moov.getUint8(mdhd.s) === 1 ? 20 : 12));
        let total = 0, top = { n: 0, d: 0 };
        for (let i = 0, n = moov.getUint32(stts.s + 4); i < n; i++) {
          const c = moov.getUint32(stts.s + 8 + i * 8), d = moov.getUint32(stts.s + 12 + i * 8);
          total += c; if (c > top.n) top = { n: c, d };
        }
        if (!top.d || top.n < 0.9 * total) return null;
        const f = scale / top.d;
        return f >= 1 && f <= 240 ? +f.toFixed(3) : null;
      }
      return null;
    } catch (_) { return null; }
  }

  // ---------- 推定：表示されたフレームの記録 { n: presentedFrames, t: mediaTime, play: 再生中か } から ----------
  // 描画が間引かれると記録はまばらになり（数十フレームおき）、フレームが捨てられると presentedFrames が 1 増える間に 2 フレーム以上進む。
  // どちらでも成り立つ 2 つの性質を使う：
  //  ・再生中に続けて記録した 2 つの間で presentedFrames が dn 増えたなら、少なくとも dn フレーム進んでいる（fps ≥ dn/dt）
  //  ・記録した時刻は、どれも先頭の記録から 1/fps の整数倍だけ離れている（格子に乗る）
  // 下限 dn/dt の最大と 2% 以内で、時刻がすべて格子に乗るよく使う値を選ぶ（29.97 と 30 は格子からのずれが小さい方）。
  // よく使う値に合わなければ、連続して表示されたフレームの差の平均から求める。決められなければ null
  function estimateFps(recs) {
    if (recs.length < 5) return null;
    let low = 0; const one = [];
    for (let i = 1; i < recs.length; i++) {
      const a = recs[i - 1], b = recs[i], dn = b.n - a.n, dt = b.t - a.t;
      if (!a.play || !b.play || dn < 1 || dt <= 0.003) continue;
      low = Math.max(low, dn / dt);
      if (dn === 1 && dt < 0.2) one.push(dt);
    }
    if (!low) return null;
    const off = c => Math.max(...recs.map(r => { const x = (r.t - recs[0].t) * c; return Math.abs(x - Math.round(x)); }));
    const fit = COMMON.filter(c => Math.abs(c - low) / c < 0.02).map(c => [c, off(c)]).filter(([, e]) => e < 0.1).sort((a, b) => a[1] - b[1]);
    if (fit.length) return +fit[0][0].toFixed(3);
    if (one.length < 15) return null;
    // 中央値の ±20% にある差（1フレーム分）の平均
    const m = [...one].sort((a, b) => a - b)[one.length >> 1], near = one.filter(d => Math.abs(d - m) < 0.2 * m);
    return +(near.length / near.reduce((a, b) => a + b, 0)).toFixed(3);
  }

  const recs = []; let jumped = false;   // jumped：シークした直後の記録は再生中でも play にしない（時刻が飛ぶので dn/dt が意味を持たない）
  video.addEventListener('seeking', () => { jumped = true; });
  function onFrame(now, md) {
    recs.push({ n: md.presentedFrames, t: md.mediaTime, play: !video.paused && !jumped });
    jumped = false;
    if (recs.length > 300) recs.shift();
    const f = fr.source === 'default' || fr.source === 'auto' ? estimateFps(recs) : null;   // ファイルから読めた値と手入力は推定で変えない
    if (f && (f !== fr.fps || fr.source !== 'auto')) { fr = { fps: f, source: 'auto' }; save(); addLog('fps', { value: f, detail: 'auto' }); sync(); }
    video.requestVideoFrameCallback(onFrame);
  }
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(onFrame);
  video.addEventListener('loadedmetadata', () => setTimeout(load, 0));   // video.js が S.videoSig を決めた後に読む

  // ---------- 1フレーム移動（, と . ・評価区間の欄のボタン） ----------
  function step(d) {
    if (!video.src) return;
    if (!video.paused) video.pause();
    const k = Math.max(0, frameAt(video.currentTime) + d);
    _.seekTo(Math.min(k / fr.fps + EPS, (S.meta.duration || Infinity) - EPS));
  }
  $('rgBtn').addEventListener('click', () => setTimeout(sync, 0));   // 欄を開いたら今のフレームを出す
  $('frBack').addEventListener('click', e => { step(-1); e.currentTarget.blur(); });
  $('frFwd').addEventListener('click', e => { step(1); e.currentTarget.blur(); });
  $('rgFps').addEventListener('change', e => {
    const v = +e.target.value;
    if (v > 0 && v <= 240) { fr = { fps: v, source: 'manual' }; save(); addLog('fps', { value: v, detail: 'manual' }); }
    sync(); e.target.blur();
  });
  // 評価区間の欄の表示：今のフレーム番号とフレームレート
  function sync() {
    const lab = { default: '仮', file: 'ファイル', auto: '推定', manual: '手入力' }[fr.source];
    if (document.activeElement !== $('rgFps')) $('rgFps').value = fr.fps;
    $('frInfo').textContent = `フレーム ${frameAt(video.currentTime || 0)}（${lab}）`;
  }

  Object.assign(_, { fps, frameAt, frameStart, frameStep: step, frameSync: sync, estimateFps, readContainerFps, fpsMeta: () => ({ ...fr }) });
})();
