// 評価の軸の組（Yik, Russell & Barrett, 1999 の Figure 1）
// 値の持ち方（横軸 v・縦軸 a、1〜9、5 が中立）は変えず、画面の軸の名前・両端のラベル・書き出しの列名・声の入力の語だけを差し替える。
//   VA（Russell）          横＝快度（不快→快）         縦＝覚醒度（眠気→覚醒）
//   PANA（Watson & Tellegen）横＝ポジティブ（低→高）   縦＝ネガティブ（低→高）
//   Thayer                 横＝エネルギー（疲労→活気）   縦＝緊張（平静→緊張）
// PANA・Thayer は VA の円環を 45° 回した軸なので、書き出しには VA に直した値（va_valence・va_arousal）も付ける。
// 絵や感情語が VA を前提にしている方式（vaOnly：SAM・Affect Grid・FEELTRACE・AffectRank）は、軸の組にかかわらず VA のまま。
(() => {
  const _ = AH._;
  const { $, S, addLog } = _;
  const SETS = {
    va: {
      label: 'VA（Russell：快度・覚醒度）', rotated: false,
      v: { name: '快度', short: '快度', lo: '不快', hi: '快', col: 'valence', words: ['快度', 'かいど', 'カイド', '快', 'かい', 'valence', 'バレンス'] },
      a: { name: '覚醒度', short: '覚醒度', lo: '眠気', hi: '覚醒', col: 'arousal', words: ['覚醒度', 'かくせいど', 'カクセイド', '覚醒', 'かくせい', 'arousal', 'アローザル'] },
    },
    pana: {
      label: 'PANA（Watson & Tellegen：ポジティブ・ネガティブ）', rotated: true,
      v: { name: 'ポジティブ', short: 'ポジティブ', lo: 'ポジティブ低', hi: 'ポジティブ高', col: 'pa', words: ['ポジティブ', '正の感情', 'ピーエー', 'PA', 'プラス'] },
      a: { name: 'ネガティブ', short: 'ネガティブ', lo: 'ネガティブ低', hi: 'ネガティブ高', col: 'na', words: ['ネガティブ', '負の感情', 'エヌエー', 'NA', 'マイナス'] },
    },
    thayer: {
      label: 'Thayer（エネルギー・緊張）', rotated: true,
      v: { name: 'エネルギー', short: 'エネルギー', lo: '疲労', hi: '活気', col: 'energy', words: ['エネルギー', '活気'] },
      a: { name: '緊張', short: '緊張', lo: '平静', hi: '緊張', col: 'tension', words: ['緊張', 'きんちょう'] },
    },
  };
  let setId = 'va';
  try { const s = localStorage.getItem('ahann_axes'); if (s && SETS[s]) setId = s; } catch (_e) {}
  S.meta.axes = setId;

  // 今の方式で使う軸の組（VA 前提の方式は VA）
  const current = () => ((_.M && _.M.vaOnly) ? 'va' : setId);
  const axSet = () => SETS[current()];
  const ax = k => axSet()[k];
  // 文中の「快度」「覚醒度」「快」「不快」「覚醒」「眠気」を今の軸の名前に置き換える（方式の説明文など）
  function relabel(text) {
    if (current() === 'va' || !text) return text;
    const A = axSet(), V = SETS.va;
    const map = [[V.v.name, A.v.name], [V.a.name, A.a.name], ['不快', A.v.lo], ['眠気', A.a.lo], ['覚醒', A.a.hi], ['快', A.v.hi]];
    const tok = map.map((_m, i) => '\u0001' + i + '\u0001');
    let s = String(text);
    map.forEach(([from], i) => { s = s.split(from).join(tok[i]); });
    map.forEach(([, to], i) => { s = s.split(tok[i]).join(to); });
    return s;
  }
  // 回した軸（PANA・Thayer）の値を VA に直す：V = 5 + (x−y)/√2、A = 5 + (x+y)/√2（x, y は中立 5 からのずれ）
  function toVA(x, y) {
    const dx = x - 5, dy = y - 5;
    return { v: 5 + (dx - dy) / Math.SQRT2, a: 5 + (dx + dy) / Math.SQRT2 };
  }

  function setAxes(id) {
    if (!SETS[id] || id === setId) return;
    const hasData = S.data && (S.undo.length || S.data.strokes.length || (_.M && (S.data.points.v[0].val !== _.M.init.v || S.data.points.a[0].val !== _.M.init.a)) ||   // 冒頭（t=0）の値を変えただけの入力も数える
      S.data.points.v.length > 1 || S.data.points.a.length > 1 ||
      S.data.cells.v.some(x => x != null) || S.data.cells.a.some(x => x != null) || S.data.events.length);
    if (hasData && !confirm(`評価の途中で軸を変えると、ここまでの記録の意味が変わります（値はそのまま、軸の名前だけが変わります）。\n「${SETS[id].label}」に変えますか？`)) { $('axesSel').value = setId; return; }
    setId = id; S.meta.axes = id;
    try { localStorage.setItem('ahann_axes', id); } catch (_e) {}
    addLog('axes', { value: id });
    if (_.relabelColors) _.relabelColors();
    if (_.M) _.remount();
  }
  const sel = $('axesSel');
  sel.innerHTML = Object.entries(SETS).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('');
  sel.value = setId;
  sel.addEventListener('change', e => { setAxes(e.target.value); e.target.blur(); });

  Object.assign(_, { AXES: SETS, axesId: () => setId, axesCurrent: current, axSet, ax, relabel, toVA, setAxes });
})();
