// 実験の設定（experiment.json と setup.json）の検査。ブラウザ（core/experiment.js）と Node（tools/exp-check.js）の両方で使う。
// errors は実験を始められない誤り、warnings は始められるが確かめたほうがよいこと（カウンターバランスの偏りなど）。
// setup.json は通常の画面の「実験用の設定を書き出す」で作る（settings と videos）。experiment.json の値が優先する
(() => {
  // 設定の項目：書き出しの画面の欄と検査はこの表から作る。exp は実験モードだけの項目（ボタンを出すか）。
  // axes の選択肢は評価軸の組（env.axes）。評価区間の変更は実験モードでは常にできない
  const SETTINGS = [
    { key: 'axes', label: '評価軸のラベル', type: 'select', choices: null, def: 'va' },
    { key: 'rate', label: '再生速度', type: 'select', choices: [[0.5, '0.5'], [0.75, '0.75'], [1, '1']], def: 1 },
    { key: 'afterWrite', label: '上書きした後ろ', type: 'select', choices: [['hold', '最後の値のまま続ける'], ['restore', '上書き前の値に戻す']], def: 'hold' },
    { key: 'timeline', label: '評価グラフを表示する', type: 'check', def: true },
    { key: 'graphEdit', label: 'グラフをなぞって値を編集する', type: 'check', def: true },
    { key: 'grid', label: 'グリッド線を表示する', type: 'check', def: true },
    { key: 'f0', label: '音声の F0（声の高さ）を表示する', type: 'check', def: false },
    { key: 'listen', label: '1区間ずつ聴いてから入力する', type: 'check', def: true },
    { key: 'videoSize', label: '動画の大きさ（％）', type: 'number', min: 25, max: 80, def: 55 },
    { key: 'padJoy', label: 'ジョイスティックを使う', type: 'check', def: true },
    { key: 'padSlider', label: 'スライダーを使う', type: 'check', def: true },
    { key: 'padSquare', label: '四角平面でスティックを角まで届かせる', type: 'check', def: true },
    { key: 'review', label: '「見返し」ボタンを出す', type: 'check', def: true, exp: true },
    { key: 'videoWindow', label: '「別ウィンドウ」ボタンを出す', type: 'check', def: true, exp: true },
    { key: 'voice', label: '「音声入力」ボタンを出す', type: 'check', def: false, exp: true },
  ];
  const DEF = Object.fromEntries(SETTINGS.map(s => [s.key, s.def]));
  const VIDEO_KEYS = ['start', 'end', 'bin', 'label', 'edges', 'duration'];
  const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);

  // experiment.json と setup.json を合わせる（settings と videos は experiment.json の値が優先）
  function merge(exp, setup) {
    if (!isObj(exp) || !isObj(setup)) return exp;
    return { ...exp, settings: { ...(setup.settings || {}), ...(exp.settings || {}) }, videos: { ...(setup.videos || {}), ...(exp.videos || {}) } };
  }
  // 試行の評価区間：試行の range ＞ 動画ごとの videos ＞ 全体の range。足りない項目（bin・label）は全体の range から補う
  function rangeFor(cfg, t) {
    const spec = t.range || (cfg.videos && cfg.videos[t.video]) || {};
    const r = { ...(cfg.range || {}), ...spec };
    if (!spec.edges) delete r.edges;
    delete r.duration;
    return r;
  }

  // 試行の条件名：試行の condition ＞ 全体の conditions（方式 id → 条件名）。無ければ空（画面に出さない）
  function conditionFor(cfg, t) {
    if (typeof t.condition === 'string') return t.condition;
    const c = isObj(cfg.conditions) ? cfg.conditions[t.mode] : null;
    return typeof c === 'string' ? c : '';
  }

  // exp：experiment.json、setup：setup.json（無ければ null）。env：modes（方式 id の配列）、axes（評価軸の組の id の配列）、has(path)（動画がフォルダにあるか）
  function check(exp, env, setup = null) {
    const errors = [], warnings = [];
    if (!isObj(exp)) return { errors: ['experiment.json が JSON のオブジェクトではありません'], warnings };
    if (setup != null) {
      if (!isObj(setup)) errors.push('setup.json が JSON のオブジェクトではありません');
      else for (const k of Object.keys(setup)) if (!['settings', 'videos'].includes(k)) errors.push(`setup.json の「${k}」は使えない項目です（settings と videos だけ）`);
    }
    const cfg = merge(exp, setup);
    if (!cfg.name) errors.push('name（実験名）がありません');
    const chkSet = (s, where) => {
      if (s == null) return;
      if (!isObj(s)) { errors.push(`${where}：settings がオブジェクトではありません`); return; }
      for (const [k, v] of Object.entries(s)) {
        const d = SETTINGS.find(x => x.key === k);
        if (!d) { errors.push(`${where}：settings の「${k}」は使えない項目です`); continue; }
        const choices = d.key === 'axes' ? env.axes : d.choices && d.choices.map(c => String(c[0]));
        if (d.type === 'select' && !choices.includes(String(v))) errors.push(`${where}：${k} は ${choices.join('・')} のどれかです`);
        if (d.type === 'check' && typeof v !== 'boolean') errors.push(`${where}：${k} は true か false です`);
        if (d.type === 'number' && !(typeof v === 'number' && v >= d.min && v <= d.max)) errors.push(`${where}：${k} は ${d.min}〜${d.max} の数です`);
      }
    };
    const chkRange = (r, where) => {
      if (r == null) return;
      if (!isObj(r)) { errors.push(`${where}：評価区間がオブジェクトではありません`); return; }
      if (r.bin != null && !(r.bin > 0)) errors.push(`${where}：bin は正の数です`);
      if (r.start != null && !(r.start >= 0)) errors.push(`${where}：start は 0 以上です`);
      if (r.end != null && !(r.end > (r.start || 0))) errors.push(`${where}：end は start より後です`);
      if (r.label != null && !['countdown', 'elapsed'].includes(r.label)) errors.push(`${where}：label は countdown か elapsed です`);
      if (r.edges != null && !(Array.isArray(r.edges) && r.edges.length >= 2 && r.edges.every((x, i) => typeof x === 'number' && x >= 0 && (i === 0 || x > r.edges[i - 1]))))
        errors.push(`${where}：edges は 2 つ以上の増えていく秒の配列です`);
      // 書き出したときの動画の長さより後ろは評価できない（フレームの端数 0.02 秒は許す）
      const end = Array.isArray(r.edges) ? r.edges[r.edges.length - 1] : r.end;
      if (r.duration > 0 && end != null && end > r.duration + 0.02) errors.push(`${where}：終了（${end} 秒）が動画の長さ（${r.duration} 秒）を超えています`);
    };
    const isUrl = s => typeof s === 'string' && s !== '';
    const chkSurvey = (v, where, key = 'survey') => {
      if (v == null || v === false || isUrl(v)) return;
      if (Array.isArray(v) && v.length && v.every(s => isUrl(s) || (isObj(s) && isUrl(s.url) && (s.label == null || typeof s.label === 'string')))) return;
      errors.push(`${where}：${key} は URL の文字列、URL（または { url, label }）の配列、false のどれかです`);
    };
    if (cfg.conditions != null) {
      if (!isObj(cfg.conditions) || Object.values(cfg.conditions).some(c => typeof c !== 'string')) errors.push('conditions は方式 id から条件名（文字列）への対応です');
      else for (const m of Object.keys(cfg.conditions)) if (!env.modes.includes(m)) errors.push(`conditions：方式「${m}」はありません`);
    }
    chkSet(cfg.settings, '全体'); chkRange(cfg.range, '全体の range'); chkSurvey(cfg.survey, '全体'); chkSurvey(cfg.finalSurvey, '全体', 'finalSurvey');
    const videos = isObj(cfg.videos) ? cfg.videos : {};
    for (const [v, r] of Object.entries(videos)) {
      chkRange(r, `動画「${v}」の評価区間`);
      if (isObj(r)) for (const k of Object.keys(r)) if (!VIDEO_KEYS.includes(k)) errors.push(`動画「${v}」の評価区間：「${k}」は使えない項目です`);
    }
    const ps = cfg.participants;
    if (!isObj(ps) || !Object.keys(ps).length) { errors.push('participants（参加者ごとの試行）がありません'); return { errors, warnings }; }
    const useVideos = Object.keys(videos).length > 0, noRange = new Set();
    for (const [pid, ts] of Object.entries(ps)) {
      if (!Array.isArray(ts) || !ts.length) { errors.push(`${pid}：試行の配列がありません`); continue; }
      const seen = new Set();
      ts.forEach((t, k) => {
        const where = `${pid} の ${k + 1} 番目`;
        if (!isObj(t)) { errors.push(`${where}：試行がオブジェクトではありません`); return; }
        if (!env.modes.includes(t.mode)) errors.push(`${where}：方式「${t.mode}」はありません`);
        if (!t.video || !env.has(t.video)) errors.push(`${where}：動画「${t.video}」がフォルダにありません`);
        // 自動保存のキー（方式＋参加者ID＋動画名）が衝突するので、同じ組は 1 回だけ
        const key = `${t.mode}|${t.video}`;
        if (seen.has(key)) errors.push(`${where}：方式と動画の組（${t.mode}・${t.video}）が重複しています`); seen.add(key);
        chkSet(t.settings, where); chkRange(t.range, where); chkSurvey(t.survey, where);
        if (t.condition != null && typeof t.condition !== 'string') errors.push(`${where}：condition（条件名）は文字列です`);
        if (useVideos && !t.range && t.video && !videos[t.video]) noRange.add(t.video);
      });
    }
    for (const v of noRange) errors.push(`動画「${v}」の評価区間がありません（通常の画面で評価区間を合わせ、setup.json を書き出し直してください）`);
    if (!useVideos) warnings.push('動画ごとの評価区間（setup.json の videos）がありません。どの動画も全体の range（無ければ動画全体を 1 秒ごと）で評価します');
    if (!errors.length) warnings.push(...orderWarnings(ps));
    return { errors, warnings };
  }

  // 順序の警告：本番の試行（練習を除く）の数、各位置に現れる方式・動画の偏り、方式と動画の組み合わせの偏り、練習の抜け
  function orderWarnings(ps) {
    const ws = [], pids = Object.keys(ps);
    const mains = pids.map(p => ps[p].filter(t => !t.practice));
    const lens = new Set(mains.map(m => m.length));
    if (lens.size > 1) ws.push(`参加者によって本番の試行の数が違います（${pids.map((p, i) => `${p} ${mains[i].length}`).join('，')}）`);
    const fmt = m => [...m].map(([v, n]) => `${v} ${n}`).join('，');
    if (pids.length >= 2) {
      for (const [key, name] of [['mode', '方式'], ['video', '動画']]) {
        const sets = new Set(mains.map(m => m.map(t => t[key]).sort().join('|')));
        const values = [...new Set(mains.flat().map(t => t[key]))];
        if (values.length < 2) continue;
        if (sets.size > 1) { ws.push(`参加者によって本番の${name}の組が違います`); continue; }
        // 位置ごとに数える。参加者の数が値の数で割り切れないときの差 1 は許す
        const L = Math.max(...mains.map(m => m.length));
        for (let k = 0; k < L; k++) {
          const cnt = new Map(values.map(v => [v, 0]));
          for (const m of mains) if (m[k]) cnt.set(m[k][key], cnt.get(m[k][key]) + 1);
          const ns = [...cnt.values()];
          if (Math.max(...ns) - Math.min(...ns) > 1) ws.push(`本番の ${k + 1} 番目に現れる${name}が偏っています（${fmt(cnt)}）`);
        }
      }
      // 方式ごとに、どの動画と組んだかの偏り（動画を方式に割り振るとき）
      const videos = [...new Set(mains.flat().map(t => t.video))];
      if (videos.length >= 2 && mains.every(m => new Set(m.map(t => t.video)).size >= 2)) {
        for (const mode of [...new Set(mains.flat().map(t => t.mode))]) {
          const cnt = new Map(videos.map(v => [v, 0]));
          for (const m of mains) for (const t of m) if (t.mode === mode) cnt.set(t.video, cnt.get(t.video) + 1);
          const ns = [...cnt.values()];
          if (Math.max(...ns) - Math.min(...ns) > 1) ws.push(`方式「${mode}」と組む動画が偏っています（${fmt(cnt)}）`);
        }
      }
    }
    // 練習を使う実験では、本番で初めて使う方式の前に、その方式の練習があるか
    if (pids.some(p => ps[p].some(t => t.practice))) {
      for (const p of pids) {
        const practiced = new Set(), missing = new Set();
        for (const t of ps[p]) {
          if (t.practice) practiced.add(t.mode);
          else if (!practiced.has(t.mode)) missing.add(t.mode);
        }
        if (missing.size) ws.push(`${p}：本番の前に練習が無い方式があります（${[...missing].join('，')}）`);
      }
    }
    return ws;
  }

  const api = { SETTINGS, DEF, merge, rangeFor, conditionFor, check, orderWarnings };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else AH._.expCheck = api;
})();
