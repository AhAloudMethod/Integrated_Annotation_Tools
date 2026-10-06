// 評価区間（動画の時刻とは独立）とその設定欄
(() => {
  const _ = AH._;
  const { $, video, S, clamp, addLog, fmt } = _;
  // ---------- 評価区間（動画の時刻とは独立） ----------
  // start: 区間0が始まる動画時刻、count: 区間の数、bin: 1区間の長さ（秒）、label: 列の表記、
  // target: 決めた終了。開始・区間の長さを変えたら、いつもここから区間の数を決め直す（揃えた終了から決め直すと終了が手前へ縮んでいった）。
  // 終了が区間の区切りに合わないときは、最後の区間を終了までの短い区間にする（端数を捨てない）。半フレーム未満の端数は区切りの誤差とみなす
  const tailTol = () => 0.5 / ((_.fps && _.fps()) || 30);
  const countFor = (start, end, bin) => Math.max(1, Math.ceil((end - start - tailTol()) / bin));
  const defaultRange = D => ({ start: 0, count: countFor(0, Math.max(D || 0, 1), 1), bin: 1, label: 'countdown', target: D || 0 });
  const RG = () => S.meta.range || defaultRange(S.meta.duration);
  const nSec = () => RG().count;
  const binStart = s => RG().start + s * RG().bin;
  // 評価区間の終わり：決めた終了（最後の区間の中にあるとき）か、区間の区切り
  const rangeEnd = () => { const r = RG(), full = binStart(r.count); return r.target != null ? Math.min(full, Math.max(r.target, full - r.bin + 1e-3)) : full; };
  const binEnd = s => (s >= nSec() - 1 ? rangeEnd() : binStart(s + 1));   // 区間 s の終わり（最後の区間は短いことがある）
  const binAt = t => Math.floor((t - RG().start) / RG().bin + 1e-6);
  const curSec = () => clamp(binAt(video.currentTime || 0), 0, nSec() - 1);
  const inRange = t => t >= RG().start - 1e-6 && t < rangeEnd() - 1e-6;
  // 入力先の区間。評価区間の外なら null を返して案内を出す（表示用の curSec は端に丸めたまま）
  // 動画の末尾で止まっている場合は、そこで終わる最後の区間に入れる
  function inputSec() {
    const t = video.currentTime || 0, n = nSec();
    let s = binAt(t);
    if (s === n && t >= (S.meta.duration || 0) - 0.05) s = n - 1;
    if (s >= 0 && s < n && (s < n - 1 || t < rangeEnd() + 0.05)) return s;   // 最後の区間は決めた終了まで
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
    $('rgEnd').value = +rangeEnd().toFixed(4);
    const last = rangeEnd() - binStart(r.count - 1);
    $('rgBtn').textContent = `区間 ${fmt(r.start).slice(0, -3)}〜 ${r.count}×${r.bin}秒` + (last < r.bin - 1e-3 ? `（最後 ${+last.toFixed(2)}秒）` : '');
  }
  $('rgBtn').addEventListener('click', e => { const open = $('rgPanel').hidden; if (_.closePops) _.closePops(); $('rgPanel').hidden = !open; e.target.blur(); });
  function onRangeInput(changed) {
    const r = RG(), target = r.target ?? (r.start + r.count * r.bin);
    const start = Math.max(0, +$('rgStart').value || 0), bin = Math.max(0.1, +$('rgBin').value || 1), label = $('rgLabel').value;
    if (changed === 'rgCount') { const count = Math.max(1, Math.round(+$('rgCount').value || 1)); setRange({ start, bin, label, count, target: +(start + count * bin).toFixed(3) }); }
    else if (changed === 'rgEnd') { const end = Math.max(start + bin, +$('rgEnd').value || 0); setRange({ start, bin, label, count: countFor(start, end, bin), target: end }); }
    else if (changed === 'rgLabel') setRange({ label });
    else setRange({ start, bin, label, count: countFor(start, Math.max(start + bin, target), bin) });   // 開始・区間の長さの変更は、決めた終了を保つ
  }
  for (const id of ['rgStart', 'rgEnd', 'rgCount', 'rgBin', 'rgLabel']) $(id).addEventListener('change', () => onRangeInput(id));
  function setEnd(end) { const r = RG(); setRange({ count: countFor(r.start, Math.max(r.start + r.bin, end), r.bin), target: end }); }
  // 今の時刻：今表示しているフレームの始まりに揃える（1フレーム移動で合わせた位置をそのまま区切りにする）
  const nowT = () => (_.frameStart ? _.frameStart(video.currentTime) : +video.currentTime.toFixed(3));
  $('rgNow').addEventListener('click', e => { const r = RG(), target = r.target ?? (r.start + r.count * r.bin), start = nowT(); setRange({ start, count: countFor(start, Math.max(start + r.bin, target), r.bin) }); e.target.blur(); });
  $('rgEndNow').addEventListener('click', e => { setEnd(nowT()); e.target.blur(); });
  $('rgFit').addEventListener('click', e => { setEnd(S.meta.duration); e.target.blur(); });

  Object.assign(_, { loadRange, saveRange, setRange, setEnd, defaultRange, RG, nSec, binStart, binEnd, rangeEnd, binAt, curSec, inputSec, inRange, secLabel, rangeSig, syncRangeUI });
})();
