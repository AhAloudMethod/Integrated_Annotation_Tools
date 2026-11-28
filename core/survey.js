// 画面の中のアンケート：実験フォルダの定義（JSON）を SurveyJS（vendor/surveyjs/）で、同梱の雛形（NASA-TLX）を元のページ（tlx/）の埋め込みで、Ahnotation の画面に重ねて出す。
// 回答は縦長の表（1 行 1 設問）にして返し、実験モード（core/experiment.js）が試行の zip に入れる。
// SurveyJS は定義のアンケートを初めて出すときにだけ読み込む（通常の画面と、URL や NASA-TLX だけの実験では読み込まない）。
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
  // NASA-TLX は、見慣れた画面を変えないため、tlx/nasatlx-ja.html を箱の中に埋め込んで出す（SurveyJS は使わない）。
  // embed=1 で開くと、結果を CSV に保存せず、同じ列と値を postMessage で渡してくる。nasa-tlx は一対比較まで、raw-tlx は評定だけ
  const TLX_LABEL = { mental: '知的・知覚的要求', physical: '身体的要求', temporal: 'タイムプレッシャー', performance: '作業成績', effort: '努力', frustration: 'フラストレーション' };
  const BUILTIN = {
    'nasa-tlx': { label: 'NASA-TLX', page: 'tlx/nasatlx-ja.html?embed=1' },
    'raw-tlx': { label: 'NASA-TLX（評定のみ）', page: 'tlx/nasatlx-ja.html?embed=1&raw=1' },
  };
  // 渡された列と値（head・row）を回答の行にする。参加者などの欄（URL で渡していないので空）は除き、時刻は start_iso・end_iso の列に入れる
  function tlxRows(head, row) {
    const get = c => row[head.indexOf(c)];
    const title = c => {
      const m = /^(\w+?)_(rating|tally|weight)$/.exec(c);
      if (m && TLX_LABEL[m[1]]) return `${TLX_LABEL[m[1]]}${{ rating: 'の評定', tally: 'が選ばれた回数', weight: 'の重み' }[m[2]]}`;
      return { overall: '重み付きの総合点', pairs: '一対比較の答え（a/b>選んだ方）', variant: '計算の種類', raw_tlx: '6 尺度の評定の平均' }[c] || '';
    };
    const skip = ['pid', 'trial', 'condition', 'mode', 'video', 'name', 'start_iso', 'end_iso'];
    return { start: get('start_iso') || '', end: get('end_iso') || '', rows: head.filter(c => !skip.includes(c)).map(c => [c, cell(get(c)), title(c)]) };
  }
  function runPage(item, b) {
    const box = openBox('ahSurveyBox ahTlxBox');
    const frame = document.createElement('iframe');
    frame.className = 'ahTlxFrame'; frame.title = b.label; frame.src = b.page;
    box.appendChild(frame);
    return new Promise(ok => {
      const onMsg = e => {
        if (e.source !== frame.contentWindow || !e.data || e.data.type !== 'ahnotation-tlx' || !Array.isArray(e.data.head) || !Array.isArray(e.data.row)) return;
        window.removeEventListener('message', onMsg);
        const r = tlxRows(e.data.head, e.data.row);
        closeBox(box);
        ok({ id: item.id, rows: r.rows.map(([q, v, t]) => [item.id, q, v, t, r.start, r.end]) });
      };
      window.addEventListener('message', onMsg);
    });
  }

  // ---------- 回答を縦長の行にする ----------
  // 1 行 1 設問。表の形の設問は行ごと（name.row）、複数選んだものは「;」でつなぐ。答えていない設問も空の値で行を残す（スライダーを動かしていないなど）
  const cell = v => (v == null ? '' : Array.isArray(v) ? v.map(cell).join(';') : isObj(v) ? JSON.stringify(v) : typeof v === 'boolean' ? (v ? 1 : 0) : v);
  function answerRows(model, data) {
    const rows = [], used = new Set();
    for (const q of model.getAllQuestions(false, false, true)) {
      if (NO_INPUT.includes(q.getType()) || q.parentQuestion) continue;   // 表のセルの設問は表の行として出す
      const v = data[q.name], title = (q.title || q.name).replace(/\s+/g, ' ');
      used.add(q.name);
      if (q.getType() === 'matrix') {
        for (const r of q.rows) { const rv = isObj(v) ? v[r.value] : undefined; rows.push([`${q.name}.${r.value}`, cell(rv), `${title}：${r.text || r.value}`]); }
      } else if (q.getType() === 'matrixdropdown') {
        // 行ごと。列が 1 つ（Google フォームのチェックボックスのグリッドを移したものなど）ならその値、2 つ以上なら name.row.column
        const cols = q.columns.map(c => c.name);
        for (const r of q.rows) {
          const rv = isObj(v) && isObj(v[r.value]) ? v[r.value] : {};
          if (cols.length === 1) rows.push([`${q.name}.${r.value}`, cell(rv[cols[0]]), `${title}：${r.text || r.value}`]);
          else for (const c of cols) rows.push([`${q.name}.${r.value}.${c}`, cell(rv[c]), `${title}：${r.text || r.value}：${c}`]);
        }
      } else if (isObj(v) && q.getType() === 'multipletext') {
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
  // 画面を覆う箱（#ahSurvey）を出す・消す
  function openBox(cls) {
    let box = document.getElementById('ahSurvey');
    if (!box) { box = document.createElement('div'); box.id = 'ahSurvey'; document.body.appendChild(box); }
    box.className = cls; box.innerHTML = ''; box.hidden = false; box.scrollTop = 0;
    return box;
  }
  const closeBox = box => { box.hidden = true; box.innerHTML = ''; };
  // item：{ form（定義の JSON）か builtin（雛形の名前）, id（表の survey 列）}。答え終わると { id, rows（COLS の行）} を返す。
  // 画面を覆う箱（#ahSurvey）に出し、答え終わったら消す
  async function run(item) {
    if (item.builtin) {
      const b = BUILTIN[item.builtin];
      if (!b) throw new Error(`同梱のアンケート「${item.builtin}」はありません`);
      return runPage(item, b);
    }
    const Survey = await load();
    const model = new Survey.Model(withDefaults(item.form));
    model.applyTheme(THEME);
    const start = new Date().toISOString();
    const box = openBox('ah-survey ahSurveyBox');
    box.innerHTML = '<div class="ahSurveyRoot"></div>';
    model.onAfterRenderSurvey.add(s => drawProgress(box, s));
    model.onCurrentPageChanged.add(s => { box.scrollTop = 0; setTimeout(() => drawProgress(box, s), 0); });
    return new Promise(ok => {
      model.onComplete.add(s => {
        const end = new Date().toISOString(), data = s.data;
        const rows = answerRows(s, data).map(([q, v, t]) => [item.id, q, v, t, start, end]);
        closeBox(box);
        ok({ id: item.id, rows, data });
      });
      model.render(box.firstChild);
    });
  }
  const builtinLabel = name => (BUILTIN[name] ? BUILTIN[name].label : name);
  const csv = rows => _.toCSV(COLS, rows);

  _.survey = { load, run, withDefaults, answerRows, tlxRows, builtinLabel, csv, BUILTIN_NAMES: Object.keys(BUILTIN), COLS };
})();
