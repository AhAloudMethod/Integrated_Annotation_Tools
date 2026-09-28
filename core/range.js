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
  const fmtS = x => { const m = Math.floor(x / 60), s = x - m * 60; return m + ':' + (Number.isInteger(RG().bin) ? String(Math.round(s)).padStart(2, '0') : s.toFixed(1).padStart(4, '0')); };
  // 列の表記：countdown＝動画内カウントダウンの残り（区間の数から逆算）、elapsed＝評価開始からの経過
  const secLabel = s => (RG().label === 'elapsed' ? fmtS(s * RG().bin) : fmtS((nSec() - 1 - s) * RG().bin));
  const rangeSig = () => JSON.stringify(RG());
  function setRange(r) {
    S.meta.range = { ...RG(), ...r };
    addLog('range', { detail: JSON.stringify(S.meta.range) });
    syncRangeUI(); _.refresh();
  }

  // 評価区間の設定欄
  function syncRangeUI() {
    const r = RG();
    $('rgStart').value = r.start; $('rgCount').value = r.count; $('rgBin').value = r.bin; $('rgLabel').value = r.label;
    $('rgBtn').textContent = `評価区間 ${fmt(r.start).slice(0, -3)}〜 ${r.count}×${r.bin}秒`;
  }
  $('rgBtn').addEventListener('click', e => { $('rgPanel').hidden = !$('rgPanel').hidden; e.target.blur(); });
  for (const id of ['rgStart', 'rgCount', 'rgBin', 'rgLabel']) $(id).addEventListener('change', () => {
    const start = Math.max(0, +$('rgStart').value || 0), bin = Math.max(0.1, +$('rgBin').value || 1);
    setRange({ start, bin, count: Math.max(1, Math.round(+$('rgCount').value || 1)), label: $('rgLabel').value });
  });
  $('rgNow').addEventListener('click', e => { setRange({ start: +video.currentTime.toFixed(2) }); e.target.blur(); });
  $('rgFit').addEventListener('click', e => { const r = RG(); setRange({ count: Math.max(1, Math.floor((S.meta.duration - r.start) / r.bin + 1e-6)) }); e.target.blur(); });

  Object.assign(_, { defaultRange, RG, nSec, binStart, rangeEnd, binAt, curSec, inRange, secLabel, rangeSig, syncRangeUI });
})();
