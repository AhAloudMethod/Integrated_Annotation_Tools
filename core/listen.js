// 聴いてから入力（連続の方式）：Excel の「聴いて判断してから入れる」手順を連続の方式でも行う。
//   1. 再生すると、評価区間の1区間の終わりで自動で止まる（聴く。記録しない）
//   2. 止まっている間に考える。画面には今の入力を映す（listenLive）が、書き込まない
//   3. Enter／ボタン0 で、同じ区間を始めから音声つきで再生し直し、その間の連続の入力を記録する（記録オンと同じ書き込み）
//   4. 区間の終わりで記録を終え、そのまま次の区間を聴く（1 に戻る）。R は聴いた区間をもう一度聴く（記録なし）
// 区間方式（表のモデル：Excel、Affect Grid、SAM、カスタムの区間ごと）では記録の段階がない。
//   止まっている間に聴いた区間の値を入れ、Enter／ボタン0 で次の区間を聴く（Excel は最後の行で Enter を押して次の列へ移ったときも）
// 設定は「設定」パネルで切り替え、ブラウザに保存する（ahann_listen）。操作ログに listen_mode・listen_pause・listen_record・listen_replay、書き出しの meta.listen に残す
(() => {
  const _ = AH._;
  const { $, video, S, model, addLog, binAt, binStart, nSec, inputSec } = _;
  let on = false;
  try { on = localStorage.getItem('ahann_listen') === '1'; } catch (_) {}

  // この方式で使えるか：時間系列（変化点）モデルで書き込みのある方式（連続の方式）か、表のモデル（区間方式）。変化の方式には効かない
  const table = () => model() === 'table';
  const usable = () => on && !_.reviewing() && !!_.M && ((model() === 'series' && !!_.M.writeMode) || table());   // 視聴の間は止めない
  let phase = 'listen';   // listen＝聴く（記録しない）／record＝聴いた区間を再生し直して記録している
  let recStart = null;    // 記録する区間の始め（最初の書き込みだけここから。takeStart で受け取る）
  const recording = () => usable() && phase === 'record';
  // 方式の画面に今の入力を映す：止まって考えている間と、記録している間
  const waiting = () => usable() && !!video.src && video.paused && !video.seeking;
  const live = () => (waiting() && !table()) || recording();   // 区間方式は区間の値をそのまま映す（予覧を使わない）

  // ---------- 区間の終わりで止める・記録を終える ----------
  let target = null;   // 今再生している区間の終わり。評価区間の外なら null
  const EPS = 0.002;   // 止めた位置：区間の終わりの少し手前（今の区間が聴いた区間になる）
  let ownSeek = false; // 自分で動かしたシーク（記録の取り消しにしない）
  function aimFrom(t) {
    const b = binAt(t + 0.005);
    target = b >= 0 && b < nSec() ? Math.min(_.binEnd(b), S.meta.duration || Infinity) : null;
  }
  function stopRecording(reason) {
    if (phase !== 'record') return;
    phase = 'listen';
    _.endStroke(reason);
    _.setArmed(false);
    _.autosave();
  }
  video.addEventListener('play', () => { if (usable()) aimFrom(video.currentTime); });
  // 記録中に止めた・動かした（Space・シーク）ときは、そこで記録を終えて聴く段階に戻る
  video.addEventListener('pause', () => { if (usable()) { stopRecording('pause'); resetPen(); } });
  video.addEventListener('seeking', () => { if (!ownSeek) stopRecording('seek'); });
  video.addEventListener('seeked', () => { ownSeek = false; if (waiting()) resetPen(); });
  // 毎フレーム（core/loop.js。書き込みのサンプリングより先に呼ぶ）
  function tick() {
    if (!usable() || !video.src || video.paused || video.seeking) return;
    const t = video.currentTime;
    if (target == null) { aimFrom(t); if (target == null) return; }   // play イベントより先に来たとき・評価区間に入ったとき
    if (t < target - 0.001) return;
    const s = binAt(target - EPS);
    if (phase === 'record') {
      // 記録を区間の終わりで終え、そのまま次の区間を聴く（最後の区間なら止まる）
      stopRecording('listen');
      addLog('listen_record_end', { detail: `sec=${s}` });
      if (s + 1 < nSec() && target < (S.meta.duration || 0) - 0.01) { aimFrom(target); return; }
    }
    video.pause();
    ownSeek = true; video.currentTime = Math.max(0, target - EPS);
    target = null;
    addLog('listen_pause', { detail: `sec=${s}` });
  }
  // 止まるたびに、マウス（ペン）の予覧を聴いた区間の記録済みの値から始める
  function resetPen() {
    const t = video.currentTime || 0;
    Object.assign(_.pen, { v: _.valueAt('v', t), a: _.valueAt('a', t), listenSet: false });
  }

  // 区間 s を始めから聴く（区間方式の Enter／ボタン0）。最後の区間の次は無いので何もしない
  function playBin(s) {
    if (!waiting()) return false;
    if (s < 0 || s >= nSec()) return true;
    ownSeek = true; video.currentTime = binStart(s); target = null;
    addLog('listen_next', { detail: `sec=${s}` });
    video.play();
    return true;
  }
  // ---------- Enter／ボタン0：聴いた区間を始めから再生し直して記録する ----------
  function startRecord() {
    if (!waiting()) return false;
    if (table()) return playBin(_.curSec() + 1);   // 区間方式：次の区間を聴く
    const s = inputSec(); if (s == null) return true;
    recStart = binStart(s);
    ownSeek = true; video.currentTime = recStart;
    phase = 'record';
    _.setArmed(true, true);
    addLog('listen_record', { detail: `sec=${s}` });
    video.play();
    _.refresh();
    return true;
  }
  // R：聴いた区間をもう一度聴く（記録しない。終わりでまた止まる）
  function replay() {
    if (!waiting()) return false;
    const s = _.curSec();
    ownSeek = true; video.currentTime = binStart(s); video.play();
    addLog('listen_replay', { detail: `sec=${s}` });
    return true;
  }
  // ヘッダーの案内
  function status() {
    const box = $('listenBox'); if (!box) return;
    box.hidden = !usable() || !video.src;
    if (box.hidden) return;
    box.textContent = recording() ? `● ${_.secLabel(_.curSec())} 入力中` : waiting() ? `${_.secLabel(_.curSec())} を入力：Enter／ボタン0${table() ? ' で次へ' : ''}（R 再聴）` : '聴いてから入力：聴く';
    box.title = table() ? '聴いてから入力：区間の終わりで止まる。止まっている間にその区間の値を入れ、Enter／ボタン0 で次の区間を聴く。R でもう一度聴く'
      : '聴いてから入力：区間の終わりで止まる。Enter／ボタン0 で同じ区間を再生し直し、その間の入力を記録する。R でもう一度聴く';
    box.classList.toggle('on', waiting());
    box.classList.toggle('rec', recording());
  }

  function setOn(v) {
    if (on === v) return;
    stopRecording('option');
    on = v; try { localStorage.setItem('ahann_listen', on ? '1' : '0'); } catch (_) {}
    $('listenMode').checked = on;
    if (on) { _.setArmed(false); _.endStroke('option'); target = null; if (!video.paused) aimFrom(video.currentTime); }
    addLog('listen_mode', { value: on ? 'on' : 'off' }); _.refresh();
  }
  $('listenMode').checked = on;
  $('listenMode').addEventListener('change', e => { setOn(e.target.checked); e.target.blur(); });

  Object.assign(_, { listenOn: () => on, listenUsable: usable, listenWaiting: waiting, listenPlayBin: playBin, listenLive: live, listenRecording: recording, listenTakeStart: () => { const t = recStart; recStart = null; return t; },
    listenTick: tick, listenRecord: startRecord, listenReplay: replay, listenStatus: status, setListen: setOn });
})();
