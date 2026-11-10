// 発声の区間：動画の音声の F0（core/f0.js）で声のある区間を、評価グラフの快度・覚醒度の欄に薄い色の帯で示す。
// 評価グラフの右上のボタン「発声」か H キーで切り替える（既定はオン、ブラウザに保存）。実験の条件に関わるので操作ログ（voiced_display）と
// 書き出しの meta.display.voiced に残す。短い切れ目（0.1 秒未満）はつなぎ、短すぎる声（0.05 秒未満）は除く
(() => {
  const _ = AH._;
  const { $, addLog } = _;
  let shown = true;
  try { shown = localStorage.getItem('ahann_voiced') !== '0'; } catch (_e) {}
  let cache = { f0: null, spans: [] };
  // 声のある区間 [[t0, t1], …]（秒）。F0 を計算していなければ空
  function spans() {
    const F = _.F0; if (!F || F.status !== 'ready') return [];
    if (cache.f0 === F.f0) return cache.spans;
    const out = _.f0calc.spans(F.f0, F.hop);   // 計算は core/f0-calc.js（tools/voiced-why.js と共通）
    cache = { f0: F.f0, spans: out };
    return out;
  }
  function setShown(on, how = 'button') {
    if (shown === on) return;
    shown = on; try { localStorage.setItem('ahann_voiced', on ? '1' : '0'); } catch (_e) {}
    $('voicedBtn').classList.toggle('on', on);
    addLog('voiced_display', { value: on ? 'on' : 'off', detail: how });
    _.refresh();
  }
  $('voicedBtn').classList.toggle('on', shown);
  $('voicedBtn').addEventListener('click', e => { e.currentTarget.blur(); setShown(!shown); });

  Object.assign(_, { voicedSpans: spans, voicedShown: () => shown, setVoicedShown: setShown });
})();
