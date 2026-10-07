// 評価区間（動画の時刻とは独立）とその設定欄
(() => {
  const _ = AH._;
  const { $, video, S, clamp, addLog } = _;
  // ---------- 評価区間（動画の時刻とは独立） ----------
  // start: 区間0が始まる動画時刻、count: 区間の数、bin: 1区間の長さ（秒）、label: 列の表記、
  // target: 決めた終了。開始・区間の長さを変えたら、いつもここから区間の数を決め直す（揃えた終了から決め直すと終了が手前へ縮んでいった）。
  // 終了が区間の区切りに合わないときは、最後の区間を終了までの短い区間にする（端数を捨てない）。半フレーム未満の端数は区切りの誤差とみなす
  const tailTol = () => 0.5 / ((_.fps && _.fps()) || 30);
  const countFor = (start, end, bin) => Math.max(1, Math.ceil((end - start - tailTol()) / bin));
  const defaultRange = D => ({ start: 0, count: countFor(0, Math.max(D || 0, 1), 1), bin: 1, label: 'countdown', target: D || 0 });
  const RG = () => S.meta.range || defaultRange(S.meta.duration);
  // edges：区切りを自分で置いたとき（不揃いの区間）の [開始, 区切り…, 終了]。ないときは等間隔（start・bin・count）
  const E = () => RG().edges || null;
  const nSec = () => (E() ? E().length - 1 : RG().count);
  const binStart = s => (E() ? E()[clamp(s, 0, E().length - 1)] : RG().start + s * RG().bin);
  // 評価区間の終わり：決めた終了（最後の区間の中にあるとき）か、区間の区切り
  const rangeEnd = () => {
    if (E()) return E()[E().length - 1];
    const r = RG(), full = binStart(r.count); return r.target != null ? Math.min(full, Math.max(r.target, full - r.bin + 1e-3)) : full;
  };
  const binEnd = s => (s >= nSec() - 1 ? rangeEnd() : binStart(s + 1));   // 区間 s の終わり（最後の区間は短いことがある）
  const binAt = t => {
    const e = E(); if (!e) return Math.floor((t - RG().start) / RG().bin + 1e-6);
    if (t < e[0] - 1e-6) return -1;
    let i = 0; while (i + 1 < e.length && e[i + 1] <= t + 1e-6) i++;
    return i;   // 終了以降は区間の数（等間隔と同じ）
  };
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
    el.classList.remove('ok'); el.textContent = '評価区間外です'; el.hidden = false;
    clearTimeout(inputSec.tm); inputSec.tm = setTimeout(() => { el.hidden = true; }, 2500);
    addLog('input_out_of_range', { detail: 't=' + t.toFixed(3) });
    return null;
  }
  const fmtS = x => { const m = Math.floor(x / 60), s = x - m * 60; return m + ':' + (Number.isInteger(RG().bin) && !E() ? String(Math.round(s)).padStart(2, '0') : s.toFixed(1).padStart(4, '0')); };
  // 列の表記：countdown＝動画内カウントダウンの残り（区間の数から逆算）、elapsed＝評価開始からの経過
  const secLabel = s => (E() ? (RG().label === 'elapsed' ? fmtS(binStart(s) - binStart(0)) : fmtS(rangeEnd() - binEnd(s)))
    : RG().label === 'elapsed' ? fmtS(s * RG().bin) : fmtS((nSec() - 1 - s) * RG().bin));
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
    if (r.edges === null) delete S.meta.range.edges;
    saveRange();
    addLog('range', { detail: JSON.stringify(S.meta.range) });
    syncRangeUI(); _.refresh();
  }

  // 評価区間の設定欄
  function syncRangeUI() {
    const r = RG();
    $('rgStart').value = +binStart(0).toFixed(4); $('rgCount').value = nSec(); $('rgBin').value = r.bin; $('rgLabel').value = r.label;
    $('rgEnd').value = +rangeEnd().toFixed(4);
    // 不揃いの区間の間は、区間の数・長さは区切りで決まる（等間隔に戻すまで変えられない）
    $('rgCount').disabled = $('rgBin').disabled = !!E();
    if (document.activeElement !== $('cutList')) $('cutList').value = E() ? E().slice(1, -1).join(', ') : '';
    $('cutReset').disabled = !E();
    $('rgBtn').textContent = `${+binStart(0).toFixed(2)}秒〜${+rangeEnd().toFixed(2)}秒`;
  }
  $('rgBtn').addEventListener('click', e => { const open = $('rgPanel').hidden; if (_.closePops) _.closePops(); $('rgPanel').hidden = !open; e.target.blur(); });
  function onRangeInput(changed) {
    if (E() && (changed === 'rgStart' || changed === 'rgEnd')) { setBounds(changed === 'rgStart' ? +$('rgStart').value : null, changed === 'rgEnd' ? +$('rgEnd').value : null); return; }
    if (E() && changed === 'rgLabel') { setRange({ label: $('rgLabel').value }); return; }
    const r = RG(), target = r.target ?? (r.start + r.count * r.bin);
    const start = Math.max(0, +$('rgStart').value || 0), bin = Math.max(0.1, +$('rgBin').value || 1), label = $('rgLabel').value;
    if (changed === 'rgCount') { const count = Math.max(1, Math.round(+$('rgCount').value || 1)); setRange({ start, bin, label, count, target: +(start + count * bin).toFixed(3) }); }
    else if (changed === 'rgEnd') { const end = Math.max(start + bin, +$('rgEnd').value || 0); setRange({ start, bin, label, count: countFor(start, end, bin), target: end }); }
    else if (changed === 'rgLabel') setRange({ label });
    else setRange({ start, bin, label, count: countFor(start, Math.max(start + bin, target), bin) });   // 開始・区間の長さの変更は、決めた終了を保つ
  }
  // 評価区間の変更は取り消し（Ctrl+Z）の履歴に乗せる：変える前の値と区間を取っておき、区間が変わったときだけ積む
  // 操作の中で別の操作を呼んだとき（区切りの一覧を空にして等間隔に戻すなど）は、外側の1件だけを積む
  let depth = 0;
  const undoable = fn => (...a) => {
    const sig = rangeSig(), before = S.data && !depth ? _.undoPoint() : null;
    depth++; let out; try { out = fn(...a); } finally { depth--; }
    if (before && rangeSig() !== sig) _.pushUndo(before);
    return out;
  };
  for (const id of ['rgStart', 'rgEnd', 'rgCount', 'rgBin', 'rgLabel']) $(id).addEventListener('change', undoable(() => onRangeInput(id)));
  const setEnd = undoable(end => { if (E()) { setBounds(null, end); return; } const r = RG(); setRange({ count: countFor(r.start, Math.max(r.start + r.bin, end), r.bin), target: end }); });
  // 今の時刻：今表示しているフレームの始まりに揃える（1フレーム移動で合わせた位置をそのまま区切りにする）
  const nowT = () => (_.frameStart ? _.frameStart(video.currentTime) : +video.currentTime.toFixed(3));
  $('rgNow').addEventListener('click', undoable(e => { if (E()) { setBounds(nowT(), null); e.target.blur(); return; } const r = RG(), target = r.target ?? (r.start + r.count * r.bin), start = nowT(); setRange({ start, count: countFor(start, Math.max(start + r.bin, target), r.bin) }); e.target.blur(); }));
  $('rgEndNow').addEventListener('click', e => { setEnd(nowT()); e.target.blur(); });
  $('rgFit').addEventListener('click', e => { setEnd(S.meta.duration); e.target.blur(); });

  // ---------- 区切りを自分で置く（不揃いの区間） ----------
  // 区間を割ると、区間方式で入れた値は両方に引き継ぐ。区切りを消すと、前の区間の値を残す（前が空なら後ろの値）
  // 区切りの操作も取り消し（Ctrl+Z）で戻せる（履歴の1件に区間も添えるので、区間の値と区切りが一緒に戻る）
  const r4 = x => +(+x).toFixed(4);
  function edgesNow() {
    if (E()) return E().slice();
    const out = []; for (let s = 0; s < nSec(); s++) out.push(r4(binStart(s)));
    out.push(r4(rangeEnd())); return out;
  }
  function setEdges(e) {
    e = [...new Set(e.map(r4))].sort((a, b) => a - b);
    if (e.length < 2) return false;
    setRange({ edges: e, start: e[0], target: e[e.length - 1], count: e.length - 1 });
    return true;
  }
  function cellsSplit(s) { for (const ax of ['v', 'a']) { const c = S.data && S.data.cells[ax]; if (c && c.length > s) c.splice(s + 1, 0, c[s]); } }
  function cellsMerge(s) { for (const ax of ['v', 'a']) { const c = S.data && S.data.cells[ax]; if (c && c.length > s) { if (c[s - 1] == null && c[s] != null) c[s - 1] = c[s]; c.splice(s, 1); } } }
  function hintMsg(msg) {
    const el = $('hint'); el.classList.remove('ok'); el.textContent = msg; el.hidden = false;
    clearTimeout(hintMsg.tm); hintMsg.tm = setTimeout(() => { el.hidden = true; }, 2500);
  }
  const addCut = undoable(t => {
    const e = edgesNow(), tol = tailTol();
    t = r4(t);
    if (t <= e[0] + tol || t >= e[e.length - 1] - tol) { hintMsg('評価区間の中で区切ってください'); return false; }
    if (e.some(x => Math.abs(x - t) < tol)) { hintMsg('すでに区切りがあります'); return false; }
    const s = e.findIndex(x => x > t) - 1;
    e.splice(s + 1, 0, t); cellsSplit(s);
    setEdges(e); addLog('range_cut', { value: 'add', detail: `t=${t} split=${s}` });
    return true;
  });
  const delCut = undoable(t => {
    const e = edgesNow();
    if (e.length <= 2) { hintMsg('消せる区切りがありません'); return false; }
    let i = 1; for (let k = 2; k < e.length - 1; k++) if (Math.abs(e[k] - t) < Math.abs(e[i] - t)) i = k;
    const x = e[i]; e.splice(i, 1); cellsMerge(i);
    setEdges(e); addLog('range_cut', { value: 'delete', detail: `t=${x} merge=${i}` });
    return true;
  });
  // 区切り i（内側の区切り。1〜区間の数−1）を t へ動かす。隣の区切りの1フレーム手前までで止める。
  // live のときはドラッグ中の表示だけ変える（保存・ログは離したときに1回）
  function moveCut(i, t, live) {
    const e = edgesNow(); if (i < 1 || i > e.length - 2) return null;
    const f = 1 / ((_.fps && _.fps()) || 30);
    e[i] = r4(clamp(t, e[i - 1] + f, e[i + 1] - f));
    if (live) { S.meta.range = { ...RG(), edges: e, count: e.length - 1 }; syncRangeUI(); _.refresh(); }
    else setEdges(e);
    return e[i];
  }
  // 不揃いの区間で開始・終了を動かす：外に出た区切りを消す（開始側で消えた区間の値も消す）
  function setBounds(start, end) {
    let e = edgesNow();
    if (start != null) {
      start = r4(Math.max(0, start)); let drop = 0;
      while (e.length > 2 && e[1] <= start + tailTol()) { e.shift(); drop++; }
      e[0] = start;
      if (drop) for (const ax of ['v', 'a']) if (S.data) S.data.cells[ax].splice(0, drop);
    }
    if (end != null) {
      end = r4(end);
      while (e.length > 2 && e[e.length - 2] >= end - tailTol()) e.pop();
      e[e.length - 1] = end;
    }
    if (e[e.length - 1] <= e[0]) { hintMsg('終了は開始より後にしてください'); syncRangeUI(); return; }
    setEdges(e);
  }
  $('cutAdd').addEventListener('click', e => { addCut(nowT()); e.currentTarget.blur(); });
  $('cutDel').addEventListener('click', e => { delCut(video.currentTime || 0); e.currentTarget.blur(); });
  $('cutReset').addEventListener('click', undoable(e => {
    e.currentTarget.blur();
    if (!E()) return;
    const r = RG(), start = binStart(0), end = rangeEnd();
    setRange({ edges: null, start, target: end, count: countFor(start, end, r.bin) });
    addLog('range_cut', { value: 'uniform' });
  }));
  $('cutList').addEventListener('change', undoable(e => {
    const e0 = edgesNow(), xs = e.target.value.split(/[,、，\s]+/).filter(Boolean).map(Number);
    if (xs.some(x => !isFinite(x))) { hintMsg('秒数をカンマで区切りで入力してください'); syncRangeUI(); return; }
    const inner = xs.filter(x => x > e0[0] + tailTol() && x < e0[e0.length - 1] - tailTol());
    if (!inner.length) { $('cutReset').click(); e.target.blur(); return; }
    setEdges([e0[0], ...inner, e0[e0.length - 1]]); addLog('range_cut', { value: 'list', detail: inner.join(' ') }); e.target.blur();
  }));

  Object.assign(_, { countFor, addCut, delCut, moveCut, cutEdges: edgesNow, setCutEdges: setEdges, loadRange, saveRange, setRange, setEnd, defaultRange, RG, nSec, binStart, binEnd, rangeEnd, binAt, curSec, inputSec, inRange, secLabel, rangeSig, syncRangeUI });
})();
