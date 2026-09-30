// 評価区間（動画の時刻とは独立）とその設定欄
(() => {
  const _ = AH._;
  const { $, video, S, clamp, addLog, fmt } = _;
  // ---------- 評価区間（動画の時刻とは独立） ----------
  // start: 区間0が始まる動画時刻、count: 区間の数、bin: 1区間の長さ（秒）、label: 列の表記
  const defaultRange = D => ({ start: 0, count: Math.max(1, Math.round(D || 0)), bin: 1, label: 'countdown' });
  const RG = () => S.meta.range || defaultRange(S.meta.duration);
  const nSec = () => RG().count;
  const binStart = s => RG().start + s * RG().bin;
  const rangeEnd = () => binStart(nSec());
  const binAt = t => Math.floor((t - RG().start) / RG().bin + 1e-6);
  const curSec = () => clamp(binAt(video.currentTime || 0), 0, nSec() - 1);
  const inRange = t => t >= RG().start - 1e-6 && t < rangeEnd() - 1e-6;
  // 入力先の区間。評価区間の外なら null を返して案内を出す（表示用の curSec は端に丸めたまま）
  // 動画の末尾で止まっている場合は、そこで終わる最後の区間に入れる
  function inputSec() {
    const t = video.currentTime || 0, n = nSec();
    let s = binAt(t);
    if (s === n && t >= (S.meta.duration || 0) - 0.05) s = n - 1;
    if (s >= 0 && s < n) return s;
    const el = $('hint');
    el.classList.remove('ok'); el.textContent = '評価区間の外です。評価区間の中に移動してから入力してください'; el.hidden = false;
    clearTimeout(inputSec.tm); inputSec.tm = setTimeout(() => { el.hidden = true; }, 2500);
    addLog('input_out_of_range', { detail: 't=' + t.toFixed(3) });
    return null;
  }
  const fmtS = x => { const m = Math.floor(x / 60), s = x - m * 60; return m + ':' + (Number.isInteger(RG().bin) ? String(Math.round(s)).padStart(2, '0') : s.toFixed(1).padStart(4, '0')); };
  // 列の表記：countdown＝動画内カウントダウンの残り（区間の数から逆算）、elapsed＝評価開始からの経過
  const secLabel = s => (RG().label === 'elapsed' ? fmtS(s * RG().bin) : fmtS((nSec() - 1 - s) * RG().bin));
  const rangeSig = () => JSON.stringify(RG());
  // 評価区間は動画ごとに覚える（参加者ID・入力方式が違っても共通）。
  // ファイル名に加えてファイルの大きさ＋長さでも覚え、名前を変えた・移した動画でも復元する（名前が優先）
  const rangeKey = file => 'ahann_range:' + file;
  const sigKey = sig => 'ahann_range_sig:' + sig;
  function loadRange(file, sig) {
    const get = k => { try { const r = JSON.parse(localStorage.getItem(k) || 'null'); return r && r.count > 0 && r.bin > 0 ? r : null; } catch (_) { return null; } };
    return get(rangeKey(file)) || (sig ? get(sigKey(sig)) : null);
  }
  function saveRange() {
    if (!S.meta.video_file) return;
    try {
      localStorage.setItem(rangeKey(S.meta.video_file), JSON.stringify(RG()));
      if (S.videoSig) localStorage.setItem(sigKey(S.videoSig), JSON.stringify(RG()));
    } catch (_) {}
  }
  function setRange(r) {
    S.meta.range = { ...RG(), ...r };
    saveRange();
    addLog('range', { detail: JSON.stringify(S.meta.range) });
    syncRangeUI(); _.refresh();
  }

  // 評価区間の設定欄
  function syncRangeUI() {
    const r = RG();
    $('rgStart').value = r.start; $('rgCount').value = r.count; $('rgBin').value = r.bin; $('rgLabel').value = r.label;
    $('rgEnd').value = +(r.start + r.count * r.bin).toFixed(3);
    $('rgBtn').textContent = `区間 ${fmt(r.start).slice(0, -3)}〜 ${r.count}×${r.bin}秒`;
  }
  $('rgBtn').addEventListener('click', e => { const open = $('rgPanel').hidden; if (_.closePops) _.closePops(); $('rgPanel').hidden = !open; e.target.blur(); });
  // 開始・終了・1区間の長さから区間の数を決める（終了は区間の区切りに揃える）
  const countFor = (start, end, bin) => Math.max(1, Math.floor((end - start) / bin + 1e-6));
  function onRangeInput(changed) {
    const r = RG(), end0 = r.start + r.count * r.bin;
    const start = Math.max(0, +$('rgStart').value || 0), bin = Math.max(0.1, +$('rgBin').value || 1), label = $('rgLabel').value;
    if (changed === 'rgCount') setRange({ start, bin, label, count: Math.max(1, Math.round(+$('rgCount').value || 1)) });
    else if (changed === 'rgEnd') setRange({ start, bin, label, count: countFor(start, Math.max(start + bin, +$('rgEnd').value || 0), bin) });
    else if (changed === 'rgLabel') setRange({ label });
    else setRange({ start, bin, label, count: countFor(start, Math.max(start + bin, end0), bin) });   // 開始・区間の長さの変更は終了を保つ
  }
  for (const id of ['rgStart', 'rgEnd', 'rgCount', 'rgBin', 'rgLabel']) $(id).addEventListener('change', () => onRangeInput(id));
  function setEnd(end) { const r = RG(); setRange({ count: countFor(r.start, Math.max(r.start + r.bin, end), r.bin) }); }
  $('rgNow').addEventListener('click', e => { const r = RG(), end0 = r.start + r.count * r.bin, start = +video.currentTime.toFixed(2); setRange({ start, count: countFor(start, Math.max(start + r.bin, end0), r.bin) }); e.target.blur(); });
  $('rgEndNow').addEventListener('click', e => { setEnd(+video.currentTime.toFixed(2)); e.target.blur(); });
  $('rgFit').addEventListener('click', e => { setEnd(S.meta.duration); e.target.blur(); });

  Object.assign(_, { loadRange, saveRange, setRange, setEnd, defaultRange, RG, nSec, binStart, rangeEnd, binAt, curSec, inputSec, inRange, secLabel, rangeSig, syncRangeUI });
})();
