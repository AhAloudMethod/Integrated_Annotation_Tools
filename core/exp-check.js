// 実験の設定ファイル（experiment.json）の検査。ブラウザ（core/experiment.js）と Node（tools/exp-check.js）の両方で使う。
// errors は実験を始められない誤り、warnings は始められるが確かめたほうがよいこと（カウンターバランスの偏りなど）
(() => {
  // 設定の既定値（書いていない項目はこれ）。review・voice・videoWindow はボタンを出すか
  const DEF = { axes: 'va', rate: 1, afterWrite: 'hold', graphEdit: true, grid: false, f0: true, listen: false, timeline: false, videoSize: 55,
    padJoy: true, padSlider: true, padSquare: true, review: false, voice: false, videoWindow: false };
  const RATES = ['0.5', '0.75', '1'];

  // env：modes（方式 id の配列）、axes（評価軸の組の id の配列）、has(path)（動画がフォルダにあるか）
  function check(cfg, env) {
    const errors = [], warnings = [];
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return { errors: ['experiment.json が JSON のオブジェクトではありません'], warnings };
    if (!cfg.name) errors.push('name（実験名）がありません');
    const chkSet = (s, where) => {
      if (s == null) return;
      for (const k of Object.keys(s)) if (!(k in DEF)) errors.push(`${where}：settings の「${k}」は使えない項目です`);
      if (s.axes != null && !env.axes.includes(s.axes)) errors.push(`${where}：axes は ${env.axes.join('・')} のどれかです`);
      if (s.rate != null && !RATES.includes(String(s.rate))) errors.push(`${where}：rate は ${RATES.join('・')} のどれかです`);
      if (s.afterWrite != null && !['hold', 'restore'].includes(s.afterWrite)) errors.push(`${where}：afterWrite は hold か restore です`);
    };
    const chkRange = (r, where) => {
      if (r == null) return;
      if (r.bin != null && !(r.bin > 0)) errors.push(`${where}：range.bin は正の数です`);
      if (r.start != null && !(r.start >= 0)) errors.push(`${where}：range.start は 0 以上です`);
      if (r.end != null && !(r.end > (r.start || 0))) errors.push(`${where}：range.end は start より後です`);
      if (r.label != null && !['countdown', 'elapsed'].includes(r.label)) errors.push(`${where}：range.label は countdown か elapsed です`);
    };
    const chkSurvey = (v, where) => { if (v != null && v !== false && typeof v !== 'string') errors.push(`${where}：survey は URL の文字列か false です`); };
    chkSet(cfg.settings, '全体'); chkRange(cfg.range, '全体'); chkSurvey(cfg.survey, '全体');
    const ps = cfg.participants;
    if (!ps || typeof ps !== 'object' || !Object.keys(ps).length) { errors.push('participants（参加者ごとの試行）がありません'); return { errors, warnings }; }
    for (const [pid, ts] of Object.entries(ps)) {
      if (!Array.isArray(ts) || !ts.length) { errors.push(`${pid}：試行の配列がありません`); continue; }
      const seen = new Set();
      ts.forEach((t, k) => {
        const where = `${pid} の ${k + 1} 番目`;
        if (!t || typeof t !== 'object') { errors.push(`${where}：試行がオブジェクトではありません`); return; }
        if (!env.modes.includes(t.mode)) errors.push(`${where}：方式「${t.mode}」はありません`);
        if (!t.video || !env.has(t.video)) errors.push(`${where}：動画「${t.video}」がフォルダにありません`);
        // 自動保存のキー（方式＋参加者ID＋動画名）が衝突するので、同じ組は 1 回だけ
        const key = `${t.mode}|${t.video}`;
        if (seen.has(key)) errors.push(`${where}：方式と動画の組（${t.mode}・${t.video}）が重複しています`); seen.add(key);
        chkSet(t.settings, where); chkRange(t.range, where); chkSurvey(t.survey, where);
      });
    }
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

  const api = { DEF, RATES, check, orderWarnings };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else AH._.expCheck = api;
})();
