// 画面の中のアンケート：SurveyJS（vendor/surveyjs/）で、実験フォルダの定義（JSON）か同梱の雛形（NASA-TLX など）を Ahnotation の画面に重ねて出す。
// 回答は縦長の表（1 行 1 設問）にして返し、実験モード（core/experiment.js）が試行の zip に入れる。
// SurveyJS は初めて出すときにだけ読み込む（通常の画面と、URL のアンケートだけの実験では読み込まない）。
// 定義の既定（書いていなければ当てる）：設問は必須、段階の評定は 1〜7 の 7 段階、言語は日本語。
// 見た目は survey/ah-survey.css（評定は横長の帯）
(() => {
  const _ = AH._;
  const BASE = 'vendor/surveyjs/';
  const COLS = ['survey', 'question', 'value', 'title', 'start_iso', 'end_iso'];
  const NO_INPUT = ['html', 'image', 'expression', 'panel', 'paneldynamic'];   // 必須を当てない種類（答える欄が無いか、中の設問に当てる）
  const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);

  // ---------- 読み込み ----------
  let lib = null;
  function load() {
    if (lib) return lib;
    const css = href => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); };
    const js = src => new Promise((ok, ng) => {
      const s = document.createElement('script'); s.src = src;
      s.onload = ok; s.onerror = () => ng(new Error(`${src} が見つかりません`));
      document.head.appendChild(s);
    });
    css(BASE + 'survey-core.min.css'); css('survey/ah-survey.css');
    lib = js(BASE + 'survey.core.min.js').then(() => js(BASE + 'japanese.min.js')).then(() => js(BASE + 'survey-js-ui.min.js'))
      .then(() => { if (!window.Survey || !window.SurveyUI) throw new Error('SurveyJS を読み込めませんでした'); return window.Survey; })
      .catch(err => { lib = null; throw err; });
    return lib;
  }

  // ---------- 既定を当てる ----------
  // 定義をたどり、isRequired の無い設問を必須に、段階の数の無い評定を 1〜7 にする（元の定義は変えない）
  function withDefaults(def) {
    const d = JSON.parse(JSON.stringify(def));
    if (!d.locale) d.locale = 'ja';
    if (d.questionErrorLocation == null) d.questionErrorLocation = 'bottom';
    if (d.showQuestionNumbers == null) d.showQuestionNumbers = 'on';
    const walk = els => {
      for (const e of Array.isArray(els) ? els : []) {
        if (!isObj(e)) continue;
        if (Array.isArray(e.elements)) walk(e.elements);
        if (Array.isArray(e.templateElements)) walk(e.templateElements);
        if (!NO_INPUT.includes(e.type) && e.isRequired == null) e.isRequired = true;
        if (e.type === 'matrix' && e.isAllRowRequired == null && e.isRequired) e.isAllRowRequired = true;
        if (e.type === 'rating' && e.rateMax == null && e.rateCount == null && !Array.isArray(e.rateValues)) { if (e.rateMin == null) e.rateMin = 1; e.rateMax = e.rateMin + 6; }
      }
    };
    walk(d.elements);
    for (const p of Array.isArray(d.pages) ? d.pages : []) if (isObj(p)) walk(p.elements);
    return d;
  }
  // ---------- 同梱の雛形 ----------
  // NASA-TLX（日本語版）：尺度の名前・両端・定義は tlx/nasatlx-ja.html と同じ。評定は元と同じく 20 個の枠（5〜100 を 5 刻み、0 は無い）を横長の帯で選ぶ
  // （数字は出さず、中央に目盛りを付ける。CSS の .ah-tlx-scale）。スライダーにしないのは、動かす前のつまみが答えた値に見えるため。
  // nasa-tlx は評定の後に一対比較（15 組、順は無作為）を行い、重みと総合点を出す。raw-tlx は評定だけで、6 尺度の平均を出す
  const TLX = [
    { key: 'mental', name: '知的・知覚的要求', left: '小さい', right: '大きい', def: 'どの程度の知的・知覚的活動(考える，決める，計算する，記憶する，見るなど)を必要としましたか．課題はやさしかったですか難しかったですか，単純でしたか複雑でしたか，正確さが求められましたか大ざっぱでよかったですか' },
    { key: 'physical', name: '身体的要求', left: '小さい', right: '大きい', def: 'どの程度の身体的活動(押す，引く，回す，制御する，動き回るなど)を必要としましたか．作業はラクでしたかキツかったですか，ゆっくりできましたかキビキビやらなければなりませんでしたか，休み休みできましたか働きづめでしたか' },
    { key: 'temporal', name: 'タイムプレッシャー', left: '弱い', right: '強い', def: '仕事のペースや課題が発生する頻度のために感じる時間的切迫感はどの程度でしたか．ペースはゆっくりとして余裕があるものでしたか，それとも速くて余裕のないものでしたか' },
    { key: 'performance', name: '作業成績', left: '良い', right: '悪い', def: '作業指示者(またはあなた自身)によって設定された課題の目標をどの程度達成できたと思いますか．目標の達成に関して自分の作業成績にどの程度満足していますか' },
    { key: 'effort', name: '努力', left: '少ない', right: '多い', def: '作業成績のレベルを達成・維持するために，精神的・身体的にどの程度いっしょうけんめいに作業しなければなりませんでしたか' },
    { key: 'frustration', name: 'フラストレーション', left: '低い', right: '高い', def: '作業中に，不安感，落胆，いらいら，ストレス，悩みをどの程度感じましたか．あるいは逆に，安心感，満足感，充足感，楽しさ，リラックスをどの程度感じましたか' },
  ];
  const shuffle = (a, rnd = Math.random) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  function tlxForm(weighted, rnd) {
    const values = Array.from({ length: 20 }, (_v, k) => ({ value: (k + 1) * 5, text: String((k + 1) * 5) }));
    const rating = TLX.map(s => ({ type: 'rating', name: s.key, title: s.name, description: s.def, rateValues: values, displayMode: 'buttons', isRequired: true,
      minRateDescription: s.left, maxRateDescription: s.right }));
    const pages = [{ name: 'rating', title: 'それぞれの項目について、今の課題に最も近い枠を選んでください', elements: rating }];
    if (weighted) {
      const pairs = [];
      for (let i = 0; i < TLX.length; i++) for (let j = i + 1; j < TLX.length; j++) pairs.push(shuffle([TLX[i], TLX[j]], rnd));
      pages.push({ name: 'pairs', title: '各組で、今の課題の作業負荷により大きく影響した方を選んでください', elements: shuffle(pairs, rnd).map(([a, b]) => ({
        type: 'radiogroup', name: `pair_${[a.key, b.key].sort().join('_')}`, title: `${a.name} と ${b.name}`, colCount: 2, isRequired: true,
        choices: [{ value: a.key, text: a.name }, { value: b.key, text: b.name }] })) });
    }
    return { title: weighted ? 'NASA-TLX' : 'NASA-TLX（評定のみ）', showProgressBar: weighted ? 'top' : 'off', pages };
  }
  // 評定から出す値：raw_tlx（6 尺度の平均）。一対比較があれば tally（選ばれた回数）・weight（tally / 15）・overall（評定 × tally の和 / 15）
  function tlxScores(data, weighted) {
    const out = [], num = k => (typeof data[k] === 'number' ? data[k] : null);
    const rs = TLX.map(s => num(s.key));
    const ok = rs.every(x => x != null);
    out.push(['variant', weighted ? 'weighted' : 'raw', '計算の種類']);
    out.push(['raw_tlx', ok ? +(rs.reduce((p, c) => p + c, 0) / TLX.length).toFixed(4) : '', '6 尺度の評定の平均']);
    if (weighted) {
      const tally = Object.fromEntries(TLX.map(s => [s.key, 0]));
      for (const [k, v] of Object.entries(data)) if (k.startsWith('pair_') && tally[v] != null) tally[v]++;
      const n = Object.values(tally).reduce((p, c) => p + c, 0);
      for (const s of TLX) out.push([`${s.key}_tally`, tally[s.key], `${s.name}が選ばれた回数`]);
      for (const s of TLX) out.push([`${s.key}_weight`, n === 15 ? +(tally[s.key] / 15).toFixed(4) : '', `${s.name}の重み`]);
      out.push(['overall', ok && n === 15 ? +(TLX.reduce((p, s) => p + num(s.key) * tally[s.key], 0) / 15).toFixed(4) : '', '重み付きの総合点']);
    }
    return out;
  }
  const BUILTIN = {
    'nasa-tlx': { label: 'NASA-TLX', form: rnd => tlxForm(true, rnd), scores: d => tlxScores(d, true), scale: true },
    'raw-tlx': { label: 'NASA-TLX（評定のみ）', form: rnd => tlxForm(false, rnd), scores: d => tlxScores(d, false), scale: true },
  };

  // ---------- 回答を縦長の行にする ----------
  // 1 行 1 設問。表の形の設問は行ごと（name.row）、複数選んだものは「;」でつなぐ。答えていない設問も空の値で行を残す（スライダーを動かしていないなど）
  const cell = v => (v == null ? '' : Array.isArray(v) ? v.map(cell).join(';') : isObj(v) ? JSON.stringify(v) : typeof v === 'boolean' ? (v ? 1 : 0) : v);
  function answerRows(model, data) {
    const rows = [], used = new Set();
    for (const q of model.getAllQuestions(false, false, true)) {
      if (NO_INPUT.includes(q.getType())) continue;
      const v = data[q.name], title = (q.title || q.name).replace(/\s+/g, ' ');
      used.add(q.name);
      if (q.getType() === 'matrix') {
        for (const r of q.rows) { const rv = isObj(v) ? v[r.value] : undefined; rows.push([`${q.name}.${r.value}`, cell(rv), `${title}：${r.text || r.value}`]); }
      } else if (isObj(v) && ['multipletext', 'matrixdropdown'].includes(q.getType())) {
        for (const [k, x] of Object.entries(v)) rows.push([`${q.name}.${k}`, cell(x), `${title}：${k}`]);
      } else rows.push([q.name, cell(v), title]);
    }
    for (const [k, v] of Object.entries(data)) if (!used.has(k)) rows.push([k, cell(v), k.endsWith('-Comment') ? 'その他の記述' : '']);   // 「その他」の記述など
    return rows;
  }

  // ---------- 出す ----------
  // 進み具合：用紙の上端に細い線と「1 / 2」を出す（1 ページなら出さない）
  function drawProgress(box, survey) {
    const card = box.querySelector('.sd-container-modern'); if (!card) return;
    let el = card.querySelector('.ah-progress');
    const n = survey.visiblePages.length;
    if (n < 2) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div'); el.className = 'ah-progress';
      el.innerHTML = '<div class="ah-progress__bar"><div class="ah-progress__fill"></div></div><span class="ah-progress__text"></span>';
      card.prepend(el);
    }
    const i = survey.currentPageNo + 1;
    el.querySelector('.ah-progress__fill').style.width = (100 * i / n) + '%';
    el.querySelector('.ah-progress__text').textContent = `${i} / ${n}`;
  }
  const THEME = { isPanelless: true, cssVariables: {
    '--sjs-primary-backcolor': '#1F6F80', '--sjs-primary-backcolor-dark': '#185B69', '--sjs-primary-backcolor-light': '#E8F1F3', '--sjs-primary-forecolor': '#FFFFFF',
    '--sjs-general-backcolor-dim': 'transparent', '--sjs-general-forecolor': '#1F2328', '--sjs-general-forecolor-light': '#6A737D',
    '--sjs-border-default': '#D0D5DA', '--sjs-corner-radius': '6px', '--sjs-font-size': '15px' } };
  // item：{ form（定義の JSON）か builtin（雛形の名前）, id（表の survey 列）}。答え終わると { id, rows（COLS の行）} を返す。
  // 画面を覆う箱（#ahSurvey）に出し、答え終わったら消す
  async function run(item, opts = {}) {
    const Survey = await load();
    const b = item.builtin ? BUILTIN[item.builtin] : null;
    if (item.builtin && !b) throw new Error(`同梱のアンケート「${item.builtin}」はありません`);
    const def = withDefaults(b ? b.form(opts.random) : item.form);
    const model = new Survey.Model(def);
    model.applyTheme(THEME);
    const start = new Date().toISOString();
    let box = document.getElementById('ahSurvey');
    if (!box) { box = document.createElement('div'); box.id = 'ahSurvey'; box.className = 'ah-survey ahSurveyBox'; document.body.appendChild(box); }
    box.innerHTML = '<div class="ahSurveyRoot"></div>'; box.hidden = false; box.scrollTop = 0;
    model.onAfterRenderSurvey.add(s => drawProgress(box, s));
    // 雛形の評定に印のクラスを付ける（描き直しても消えないよう、SurveyJS が設問のクラスを決めるところで足す）
    if (b && b.scale) model.onUpdateQuestionCssClasses.add((_s, o) => { if (TLX.some(t => t.key === o.question.name)) o.cssClasses.root = `${o.cssClasses.root || ''} ah-tlx-scale`; });
    model.onCurrentPageChanged.add(s => { box.scrollTop = 0; setTimeout(() => drawProgress(box, s), 0); });
    return new Promise(ok => {
      model.onComplete.add(s => {
        const end = new Date().toISOString(), data = s.data;
        const id = item.id;
        const rows = [...answerRows(s, data), ...(b ? b.scores(data) : [])].map(([q, v, t]) => [id, q, v, t, start, end]);
        box.hidden = true; box.innerHTML = '';
        ok({ id, rows, data });
      });
      model.render(box.firstChild);
    });
  }
  const builtinLabel = name => (BUILTIN[name] ? BUILTIN[name].label : name);
  const csv = rows => _.toCSV(COLS, rows);

  _.survey = { load, run, withDefaults, answerRows, tlxScores, builtinLabel, csv, BUILTIN_NAMES: Object.keys(BUILTIN), COLS, TLX };
})();
