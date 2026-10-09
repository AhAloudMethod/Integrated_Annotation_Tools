// 実験モード：参加者内で方式を比べる実験に使う。実験者は experiment.json（試行の順）・setup.json（設定と動画ごとの評価区間）と動画を入れたフォルダを選び、参加者を選ぶ。
// 試行（方式×動画）を設定ファイルの順に進め、参加者が選べる要素（ID・方式・設定・評価区間など）を隠す。
// 各試行は ready（覆いに「開始」）→ running（評価する）→ done（完了で書き出し、入力をロック）と進む。
// タスク遂行時間は「開始」から「完了」まで。操作ログに task_start・task_end を残し、内訳（再生時間・シークの回数など）を要約にする。
// 書き出しは 1 試行 1 つの zip（その時点までの要約も入れる）。zip はブラウザ（IndexedDB）にも残し、参加者を選ぶ画面から書き出し直せる。
// 当てた設定はブラウザに保存されるので、実験モードを抜けるとき（とページを閉じるとき）に元の値へ戻す。Ctrl+Shift+E で抜ける（試行の途中なら _partial の zip を書き出す）。
// setup.json は通常の画面の「実験用の設定を書き出す」で作る（設定の欄と、フォルダの動画ごとに覚えてある評価区間）
(() => {
  const _ = AH._;
  const { $, video, S, modes, addLog, endStroke, setArmed, pen } = _;
  // 設定の項目・既定値（書いていない項目はこれ。参加者のブラウザに残った値は使わない）と検査は core/exp-check.js
  const E = _.expCheck, { DEF } = E;
  const LS_KEYS = ['ahann_axes', 'ahann_after', 'ahann_grid', 'ahann_pad_square', 'ahann_f0', 'ahann_listen', 'ahann_tl', 'ahann_vidsize', 'ahann_pad_joy', 'ahann_pad_slider'];
  const SUM_COLS = ['trial', 'practice', 'mode', 'condition', 'video', 'start_iso', 'end_iso', 'task_ms', 'play_ms', 'review_ms', 'n_play', 'n_seek', 'n_undo', 'n_redo',
    'n_strokes', 'n_events', 'bins', 'filled_v', 'filled_a', 'n_restore', 'partial', 'survey_opened'];
  const VIDEO_RE = /\.(mp4|m4v|mov|webm|mkv|avi|ogv|mpe?g|wmv)$/i;
  // X：実験の状態。cfg（experiment.json に setup.json を合わせたもの）、get（相対パス→File）、pid、trials、i（今の試行）、set（今の設定）、range、state、backup（元の設定）
  let X = null;

  // ---------- フォルダの読み込みと検査 ----------
  // 選んだフォルダの中の experiment.json（いちばん浅いもの）を探す。setup.json と動画のパスはそのフォルダからの相対で引く
  function readFolder(list) {
    const files = new Map(); let base = null, depth = Infinity;
    for (const f of list) {
      const rel = (f.webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name;
      files.set(rel, f);
      const d = rel.split('/').length;
      if (f.name === 'experiment.json' && d < depth) { depth = d; base = rel.slice(0, -'experiment.json'.length); }
    }
    const at = base ?? '';
    const get = p => files.get(at + String(p).replace(/^\.\//, '').replace(/\\/g, '/'));
    // 動画の一覧（experiment.json のあるフォルダから下）
    const videos = [...files.entries()].filter(([rel, f]) => rel.startsWith(at) && VIDEO_RE.test(f.name)).map(([rel, f]) => ({ path: rel.slice(at.length), file: f }))
      .sort((a, b) => a.path.localeCompare(b.path));
    return { cfgFile: base == null ? null : get('experiment.json'), setupFile: get('setup.json') || null, get, videos };
  }
  const readJSON = async f => JSON.parse((await f.text()).replace(/^﻿/, ''));   // 書き出したファイルは BOM で始まる
  const env = get => ({ modes: Object.keys(modes), axes: Object.keys(_.AXES), has: p => !!get(p) });

  // ---------- 結果の zip をブラウザ（IndexedDB）に残す ----------
  // キーは「実験名|参加者|試行の番号」（途中で抜けたものは末尾に |partial）。値は { name, blob, exp, pid, trial, time }
  function idb() {
    return new Promise((ok, ng) => {
      const r = indexedDB.open('ahann_exp', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('zips');
      r.onsuccess = () => ok(r.result); r.onerror = () => ng(r.error);
    });
  }
  async function idbDo(mode, fn) {
    const db = await idb();
    try {
      return await new Promise((ok, ng) => {
        const tx = db.transaction('zips', mode), st = tx.objectStore('zips'), res = fn(st);
        tx.oncomplete = () => ok(res && 'result' in res ? res.result : undefined); tx.onerror = () => ng(tx.error);
      });
    } finally { db.close(); }
  }
  const zipPut = (key, v) => idbDo('readwrite', st => st.put(v, key));
  const zipAll = () => idbDo('readonly', st => st.getAll());
  const zipDel = async (exp, pid) => {
    const keys = await idbDo('readonly', st => st.getAllKeys());
    await idbDo('readwrite', st => { for (const k of keys) if (k.startsWith(`${exp}|${pid}|`)) st.delete(k); });
  };
  function downloadBlob(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---------- 進行（終えた試行と要約）はブラウザに残す ----------
  const progKey = pid => `ahann_exp:${X.cfg.name}:${pid}`;
  function loadProgress(pid) {
    try { return JSON.parse(localStorage.getItem(progKey(pid)) || '{}').done || {}; } catch (_e) { return {}; }
  }
  function saveProgress(i, row) {
    const done = loadProgress(X.pid); done[i] = { ...(done[i] || {}), ...row };
    try { localStorage.setItem(progKey(X.pid), JSON.stringify({ done })); } catch (_e) {}
  }
  const summaryCSV = () => {
    const done = loadProgress(X.pid);
    return _.toCSV(SUM_COLS, Object.keys(done).map(Number).sort((a, b) => a - b).map(k => SUM_COLS.map(c => done[k][c] ?? '')));
  };
  const summaryName = () => `${X.pid}_${X.cfg.name}_trials.csv`;

  // ---------- 覆い（設定の画面・開始・完了後） ----------
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function cover(html) {
    $('expCover').hidden = !html;
    if (html) $('expCard').innerHTML = html;
  }
  const errList = errs => `<ul class="expErr">${errs.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`;
  const cond = t => E.conditionFor(X.cfg, t);   // 条件名（experiment.json の condition・conditions。無ければ空）
  const trialName = (t, k) => `${k + 1}. ${t.practice ? '練習　' : ''}${modes[t.mode] ? modes[t.mode].label : t.mode}${cond(t) ? `（${cond(t)}）` : ''}　${t.video}`;
  function setup(cfg, get, { errors: errs, warnings = [] }) {
    X = { cfg, get, state: 'setup', backup: null };
    if (errs.length) {
      cover(`<h2>実験フォルダの誤り</h2>${errList(errs)}<button id="expCancel" type="button">閉じる</button>`);
      $('expCancel').addEventListener('click', () => { X = null; cover(''); });
      return;
    }
    const pids = Object.keys(cfg.participants);
    cover(`<h2>実験：${esc(cfg.name)}</h2>
      ${warnings.length ? `<p>確かめてください（このままでも始められます）：</p><ul class="expWarn">${warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      <label>参加者 <select id="expPid">${pids.map(p => `<option>${esc(p)}</option>`).join('')}</select></label>
      <label>始める試行 <select id="expFrom"></select></label>
      <div class="expBtns"><button id="expGo" type="button">実験を始める</button><button id="expCancel" type="button">やめる</button></div>
      <div class="expSaved"><div class="refTitle">ブラウザに残っている結果</div><div id="expZips" class="expZips"></div></div>
      <p class="muted">実験中は Ctrl+Shift+E で実験モードを抜けます。結果は試行ごとに 1 つの zip としてダウンロード先に書き出し、ブラウザにも残します。</p>`);
    const fill = () => {
      const pid = $('expPid').value, done = loadProgress(pid), ts = cfg.participants[pid];
      const first = ts.findIndex((_t, k) => !done[k] || done[k].partial);
      $('expFrom').innerHTML = ts.map((t, k) => `<option value="${k}">${esc(trialName(t, k))}${done[k] ? (done[k].partial ? '（途中）' : '（済）') : ''}</option>`).join('');
      $('expFrom').value = String(first < 0 ? 0 : first);
      listZips(pid);
    };
    $('expPid').addEventListener('change', fill); fill();
    $('expCancel').addEventListener('click', () => { X = null; cover(''); });
    $('expGo').addEventListener('click', () => enter($('expPid').value, +$('expFrom').value));
  }
  // 参加者の zip の一覧：1 つずつ・まとめて書き出し直す。書き出しを確かめたら、ブラウザから消せる（進行と自動保存も消す）
  async function listZips(pid) {
    const box = $('expZips'); if (!box) return;
    let zs = [];
    try { zs = (await zipAll()).filter(z => z.exp === X.cfg.name && z.pid === pid).sort((a, b) => a.trial - b.trial || a.time - b.time); } catch (_e) { box.textContent = 'ブラウザの保存領域を読めません'; return; }
    if (!X || $('expPid').value !== pid) return;
    if (!zs.length) { box.innerHTML = '<p class="muted">まだありません</p>'; return; }
    box.innerHTML = `<ul>${zs.map((z, k) => `<li><button type="button" data-k="${k}">書き出す</button> ${esc(z.name)}</li>`).join('')}</ul>
      <div class="expBtns"><button id="expZipAll" type="button">すべて書き出す</button><button id="expZipDel" type="button">この参加者の記録をブラウザから消す</button></div>`;
    box.querySelectorAll('button[data-k]').forEach(b => b.addEventListener('click', () => downloadBlob(zs[+b.dataset.k].name, zs[+b.dataset.k].blob)));
    $('expZipAll').addEventListener('click', () => zs.forEach(z => downloadBlob(z.name, z.blob)));
    $('expZipDel').addEventListener('click', async () => {
      if (!confirm(`参加者 ${pid} の記録（zip・進行・途中の自動保存）をこのブラウザから消します。書き出したファイルを確かめましたか？`)) return;
      await zipDel(X.cfg.name, pid);
      try {
        localStorage.removeItem(progKey(pid));
        for (const t of X.cfg.participants[pid]) localStorage.removeItem(`ahann4:${t.mode}:${pid}:${t.video.split('/').pop()}`);
      } catch (_e) {}
      $('expPid').dispatchEvent(new Event('change'));
    });
  }

  // ---------- 実験モードに入る・抜ける ----------
  function enter(pid, from) {
    X.pid = pid; X.trials = X.cfg.participants[pid];
    X.backup = {};
    for (const k of LS_KEYS) { try { X.backup[k] = localStorage.getItem(k); } catch (_e) {} }
    _.closePops();
    $('pid').value = pid; S.meta.participant = pid;
    document.body.classList.add('exp');
    startTrial(from);
  }
  function restoreSettings() {
    if (!X || !X.backup) return;
    for (const [k, v] of Object.entries(X.backup)) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_e) {} }
  }
  async function exit() {
    const running = X.state === 'running';
    if (!confirm(`実験モードを終了しますか？${running ? '（今の試行は途中までを _partial の zip として書き出します）' : ''}（ページを読み込み直し、設定を実験前に戻します）`)) return;
    if (running) {
      if (!video.paused) video.pause();
      endStroke('exp_exit'); addLog('task_abort', { value: X.i + 1 });
      S.meta.experiment.partial = true;
      const row = { ...summarize(), partial: 1 };
      S.meta.experiment.task = row; saveProgress(X.i, row);
      await saveZip(true);
      await new Promise(r => setTimeout(r, 800));   // ダウンロードが始まるのを待ってから読み込み直す
    } else if (video.src && S.meta.video_file) { endStroke('exp_exit'); _.autosave(); }
    restoreSettings(); X = null;
    location.reload();
  }
  window.addEventListener('pagehide', () => restoreSettings());

  // ---------- 設定を当てる ----------
  // 各欄の既存の処理（操作ログ・ブラウザへの保存）をそのまま使うため、欄の値を変えて change を送る
  function applySettings(s) {
    const fire = (id, prop, v) => { const el = $(id); if (el[prop] === v) return; el[prop] = v; el.dispatchEvent(new Event('change')); };
    _.setAxes(s.axes);
    fire('rate', 'value', String(s.rate));
    fire('afterWrite', 'value', s.afterWrite);
    fire('graphEdit', 'checked', !!s.graphEdit);
    fire('gridShow', 'checked', !!s.grid);
    fire('padSquare', 'checked', !!s.padSquare);
    fire('padJoyUse', 'checked', !!s.padJoy);
    fire('padSliderUse', 'checked', !!s.padSlider);
    _.setF0Shown(!!s.f0); _.setListen(!!s.listen); _.setTimeline(!!s.timeline); _.setVideoSize(+s.videoSize);
    document.body.classList.toggle('expReview', !!s.review);
    document.body.classList.toggle('expVoice', !!s.voice);
    document.body.classList.toggle('expVwin', !!s.videoWindow);
  }
  // 評価区間を当てる。動画の長さに収まらなければ誤りの文を返す（黙って切り詰めない。フレームの端数 0.02 秒は許す）
  // 参加者が自分で区切る試行（Excel の cuts: "self"）は、区切りの無い 1 区間（開始〜終了）から始める
  function applyRange(r) {
    const D = S.meta.duration, tol = 0.02, label = r.label || 'countdown';
    const self = !!(_.M && _.M.selfCuts && _.M.selfCuts());
    if (r.edges) {
      const e = r.edges, end = e[e.length - 1];
      if (end > D + tol) return `評価区間の終了（${end} 秒）が動画の長さ（${D.toFixed(3)} 秒）を超えています`;
      const edges = self ? [e[0], end] : e.slice(); edges[edges.length - 1] = Math.min(end, D);
      _.setRange({ edges, start: edges[0], target: edges[edges.length - 1], count: edges.length - 1, bin: r.bin || 1, label });
      return null;
    }
    const start = r.start || 0, end = r.end != null ? r.end : D, bin = r.bin || 1;
    if (end > D + tol) return `評価区間の終了（${end} 秒）が動画の長さ（${D.toFixed(3)} 秒）を超えています`;
    if (start >= Math.min(end, D)) return `評価区間の開始（${start} 秒）が終了より後ろです`;
    const e = Math.min(end, D);
    if (self) _.setRange({ edges: [start, e], start, bin, label, target: e, count: 1 });
    else _.setRange({ edges: null, start, bin, label, target: e, count: _.countFor(start, Math.max(start + bin, e), bin) });
    return null;
  }

  // ---------- 試行 ----------
  // 前の試行を片づけてから、方式・設定を当てて動画を開く。片づけで video_file を空にし、新しい試行の値が前の動画の保存先に入らないようにする
  function teardown() {
    if (!video.paused) video.pause();
    if (_.reviewing()) _.setReview(false);
    if (_.setVoice) _.setVoice(false);
    if (document.body.classList.contains('vwin') && _.closeVideoWindow) _.closeVideoWindow();
    endStroke('trial'); setArmed(false); pen.down = false;
    if (video.src) _.autosave();
    S.meta.video_file = ''; S.data = null; S.undo = []; S.redo = []; S.log = [];
  }
  function startTrial(i) {
    teardown();
    const t = X.trials[i];
    X.i = i;
    X.set = { ...DEF, ...(X.cfg.settings || {}), ...(t.settings || {}) };
    X.range = E.rangeFor(X.cfg, t);
    _.selectMode(t.mode);
    S.meta.options = { ...S.meta.options, ...(t.options || {}) };
    applySettings(X.set);
    _.remount();
    setState('loading');
    _.openVideoFile(X.get(t.video), () => loaded(i));
  }
  function loaded(i) {
    const t = X.trials[i], log = S.log;
    const started = log.some(l => l.type === 'task_start'), ended = log.some(l => l.type === 'task_end');
    S.meta.experiment = { ...(S.meta.experiment && S.meta.experiment.trial === i ? S.meta.experiment : {}),
      name: X.cfg.name, participant: X.pid, trial: i, n_trials: X.trials.length, practice: !!t.practice, condition: cond(t), settings: X.set, options: { ...S.meta.options } };
    if (!started) {   // 復元したときは、その時点の評価区間のまま続ける
      const err = applyRange(X.range);
      if (err) { setState('error', err); return; }
      addLog('exp_trial', { value: i + 1, detail: JSON.stringify({ name: X.cfg.name, mode: t.mode, condition: cond(t), video: t.video, practice: !!t.practice, range: X.range }) });
    }
    setState(ended ? (i + 1 < X.trials.length ? 'done' : 'finished') : started ? 'running' : 'ready');
  }
  const progText = () => { const t = X.trials[X.i]; return `${X.i + 1} / ${X.trials.length}${t.practice ? '　練習' : ''}${cond(t) ? '　' + cond(t) : ''}`; };
  function setState(st, msg) {
    X.state = st;
    document.body.classList.toggle('expWait', st !== 'running');
    $('expInfo').hidden = false; $('expInfo').textContent = progText();
    $('expDoneBtn').hidden = st !== 'running';
    const head = `<p class="expProg">${esc(progText())}</p>`;
    if (st === 'loading') cover(head + '<p>読み込んでいます…</p>');
    else if (st === 'error') cover(head + `<h2>この試行を始められません</h2>${errList([`${X.trials[X.i].video}：${msg}`])}<p>実験者の方へ：setup.json（動画ごとの評価区間）を直してから、Ctrl+Shift+E で抜けて実験フォルダを開き直してください。</p>`);
    else if (st === 'ready') {
      cover(head + '<p>準備ができたら「開始」を押してください。</p><button id="expStart" type="button" class="expMain">開始</button>');
      $('expStart').addEventListener('click', start);   // フォーカスは置かない（Space で誤って始めないように）
    } else if (st === 'done' || st === 'finished') {
      // アンケートがある試行は、すべての「アンケートを開く」を押すまで「次へ」（最後なら終わりの案内）を出さない。最後の試行の後には finalSurvey も出す
      const last = st === 'finished', sv = surveys(X.i, last), opened = new Set();
      const next = last ? '<p>すべての試行が終わりました。ありがとうございました。</p><button id="expSum" type="button">要約をもう一度書き出す</button>'
        : '<button id="expNext" type="button" class="expMain">次へ</button>';
      const many = sv.length > 1;
      cover(head + '<p>完了しました。</p>' + (sv.length ? `<p>アンケートに答えてください${many ? `（${sv.length} つあります。上から順に答えてください）` : ''}。答え終わったら、この画面に戻ってください。</p>`
        + `<div class="expSurveys">${sv.map((s, k) => `<button id="expSurvey${k ? k + 1 : ''}" type="button" class="expMain expSurvey">${esc(s.label || (many ? `アンケート ${k + 1} を開く` : 'アンケートを開く'))}</button>`).join('')}</div>` : '')
        + `<div id="expAfter"${sv.length ? ' hidden' : ''} class="expAfter">${next}</div>`);
      sv.forEach((s, k) => $('expSurvey' + (k ? k + 1 : '')).addEventListener('click', e => {
        window.open(s.url, '_blank');
        opened.add(k); e.currentTarget.classList.add('expOpened');
        saveProgress(X.i, { survey_opened: opened.size });   // 完了の後なので、操作ログではなく要約に残す
        if (opened.size === sv.length) $('expAfter').hidden = false;
      }));
      if (last) $('expSum').addEventListener('click', () => _.download(summaryName(), summaryCSV(), 'text/csv'));
      else $('expNext').addEventListener('click', () => startTrial(X.i + 1));
    } else cover('');
  }
  // アンケートの一覧 [{ url, label }]：試行の survey（false なら無し）、なければ全体の survey（練習の試行には使わない）。
  // final なら、実験の後に 1 回だけ答える finalSurvey を後ろに足す。
  // どちらも URL の文字列か、URL の文字列・{ url, label } の配列。{pid} などを試行の値に置き換える
  function surveys(i, final) {
    const t = X.trials[i];
    const val = { pid: X.pid, trial: i + 1, mode: t.mode, condition: cond(t), video: t.video, practice: t.practice ? 1 : 0, name: X.cfg.name };
    const fill = u => u.replace(/\{(pid|trial|mode|condition|video|practice|name)\}/g, (_m, k) => encodeURIComponent(val[k]));
    const list = tpl => !tpl ? [] : (Array.isArray(tpl) ? tpl : [tpl]).map(s => typeof s === 'string' ? { url: fill(s) } : { url: fill(s.url), label: s.label });
    return [...list(t.survey !== undefined ? t.survey : t.practice ? null : X.cfg.survey), ...(final ? list(X.cfg.finalSurvey) : [])];
  }
  function start() {
    if (!X || X.state !== 'ready') return;
    S.meta.experiment.start_iso = new Date().toISOString();
    addLog('task_start', { value: X.i + 1 });
    setState('running');
  }
  async function complete() {
    if (!X || X.state !== 'running') return;
    if (!confirm('評価を終えて完了しますか？（完了すると、この動画の評価は変えられません）')) return;
    if (!video.paused) video.pause();
    if (_.reviewing()) _.setReview(false);
    if (_.setVoice) _.setVoice(false);
    endStroke('task_end'); setArmed(false); pen.down = false;
    S.meta.experiment.end_iso = new Date().toISOString();
    addLog('task_end', { value: X.i + 1 });
    const row = { ...summarize(), partial: 0, survey_opened: 0 };
    S.meta.experiment.task = row;
    saveProgress(X.i, row);
    setState(X.i + 1 >= X.trials.length ? 'finished' : 'done');
    await saveZip(false);
  }
  // 今の試行を 1 つの zip にして書き出し、ブラウザにも残す。書き出せたら、この試行の自動保存は消す（ブラウザの容量を空けるため）
  async function saveZip(partial) {
    const files = _.buildFiles(); if (!files) return;
    files.push({ name: summaryName(), text: summaryCSV() });
    const session = files.find(f => f.name.endsWith('_session.json')).name;
    const name = session.replace(/_session\.json$/, partial ? '_partial.zip' : '.zip');
    const blob = new Blob([_.makeZip(files.map(f => ({ name: f.name, data: '﻿' + f.text })))], { type: 'application/zip' });
    downloadBlob(name, blob);
    $('status').textContent = `書き出しました（${name}）`;
    const key = `ahann4:${S.meta.mode}:${S.meta.participant}:${S.meta.video_file}`;
    try {
      await zipPut(`${X.cfg.name}|${X.pid}|${X.i}${partial ? '|partial' : ''}`, { name, blob, exp: X.cfg.name, pid: X.pid, trial: X.i, time: Date.now() });
      if (!partial) { S.meta.video_file = ''; localStorage.removeItem(key); }   // video_file を空にして、以後の操作で自動保存を作り直さない
    } catch (_e) { /* 残せなくても、ダウンロードと自動保存はある */ }
  }

  // ---------- 要約 ----------
  // 最後の task_start から task_end（なければ今）までの操作ログを数える。再生・見返しの時間は、開始と終わりの組の間の合計。
  // 途中で抜けて（task_abort）再開した試行も、抜けていた間は経過時間に入らない（再開すると操作ログの経過時間が続きから数える）
  function summarize() {
    const log = S.log, t = X.trials[X.i];
    let k0 = -1; for (let k = log.length - 1; k >= 0; k--) if (log[k].type === 'task_start') { k0 = k; break; }
    const seg = k0 < 0 ? [] : log.slice(k0);
    const kEnd = seg.findIndex(l => l.type === 'task_end');
    const span = kEnd < 0 ? seg : seg.slice(0, kEnd + 1);
    const w0 = span.length ? span[0].wall_ms : 0, w1 = span.length ? span[span.length - 1].wall_ms : 0;
    const n = type => span.filter(l => l.type === type).length;
    let play = 0, playAt = null, rev = 0, revAt = null;
    for (const l of span) {
      if (l.type === 'play' && playAt == null) playAt = l.wall_ms;
      else if ((l.type === 'pause' || l.type === 'ended') && playAt != null) { play += l.wall_ms - playAt; playAt = null; }
      else if (l.type === 'review' && l.value === 'on' && revAt == null) revAt = l.wall_ms;
      else if (l.type === 'review' && l.value === 'off' && revAt != null) { rev += l.wall_ms - revAt; revAt = null; }
    }
    if (playAt != null) play += w1 - playAt;
    if (revAt != null) rev += w1 - revAt;
    // 値を入れた区間の数。区間内で変化（core/curve.js）の変化の区間は、書き込みがかかった区間を数える
    const bins = _.nSec(), filled = ax => S.data.cells[ax].slice(0, bins).filter((x, s) => (x === 'curve' ? (_.curveInfo(ax, s) || {}).entered : x != null && x !== '')).length;
    return { trial: X.i + 1, practice: t.practice ? 1 : 0, mode: t.mode, condition: cond(t), video: t.video,
      start_iso: S.meta.experiment.start_iso || '', end_iso: S.meta.experiment.end_iso || '',
      task_ms: +(w1 - w0).toFixed(1), play_ms: +play.toFixed(1), review_ms: +rev.toFixed(1),
      n_play: n('play'), n_seek: n('seek'), n_undo: n('undo'), n_redo: n('redo'),
      n_strokes: S.data.strokes.length, n_events: S.data.events.length, bins, filled_v: filled('v'), filled_a: filled('a'),
      n_restore: log.filter(l => l.type === 'restore').length };
  }

  // ---------- 実験用の設定（setup.json）を書き出す（通常の画面） ----------
  // 設定の欄は exp-check.js の SETTINGS から作り、今の画面の値を初めの値にする。動画はフォルダの中のものを並べ、
  // それぞれに覚えてある評価区間（通常の画面で合わせたもの）を付ける。区間の無い動画は「未設定」と出し、書き出さない
  function currentSettings() {
    return { ...DEF, axes: _.axesId(), rate: +$('rate').value, afterWrite: $('afterWrite').value, timeline: !document.body.classList.contains('noTl'),
      graphEdit: $('graphEdit').checked, grid: _.gridShown(), f0: _.f0Shown(), listen: _.listenOn(), videoSize: +$('vidSize').value,
      padJoy: $('padJoyUse').checked, padSlider: $('padSliderUse').checked, padSquare: _.padSquare() };
  }
  function durationOf(file) {
    return new Promise(ok => {
      const v = document.createElement('video'), url = URL.createObjectURL(file);
      const done = d => { clearTimeout(tm); URL.revokeObjectURL(url); v.removeAttribute('src'); ok(d); };
      const tm = setTimeout(() => done(null), 10000);
      v.preload = 'metadata'; v.muted = true;
      v.onloadedmetadata = () => done(v.duration); v.onerror = () => done(null);
      v.src = url;
    });
  }
  // 覚えてある評価区間（range.js の形）を setup.json の形にする
  function videoEntry(r, dur) {
    const r4 = x => +(+x).toFixed(4), d = dur ? { duration: +dur.toFixed(3) } : {};
    if (r.edges) return { edges: r.edges.map(r4), label: r.label || 'countdown', ...d };
    const full = r.start + r.count * r.bin;
    const end = r.target != null ? Math.min(full, Math.max(r.target, full - r.bin + 1e-3)) : full;
    return { start: r4(r.start), end: r4(end), bin: r.bin, label: r.label || 'countdown', ...d };
  }
  async function setupExport(list) {
    const { videos } = readFolder(list);
    cover('<h2>実験用の設定を書き出す</h2><p>フォルダの動画を調べています…</p>');
    const rows = [];
    for (const v of videos) {
      const dur = await durationOf(v.file);
      const r = dur ? _.loadRange(v.file.name, `${v.file.size}:${dur.toFixed(2)}`) : null;
      rows.push({ path: v.path, dur, entry: r ? videoEntry(r, dur) : null });
    }
    const cur = currentSettings();
    const ctl = d => {
      const id = 'es_' + d.key, v = cur[d.key];
      if (d.type === 'check') return `<label class="chk"><input id="${id}" type="checkbox"${v ? ' checked' : ''}> ${esc(d.label)}</label>`;
      if (d.type === 'number') return `<label>${esc(d.label)} <input id="${id}" type="number" min="${d.min}" max="${d.max}" value="${v}"></label>`;
      const ch = d.key === 'axes' ? Object.entries(_.AXES).map(([k, s]) => [k, s.label]) : d.choices;
      return `<label>${esc(d.label)} <select id="${id}">${ch.map(([k, l]) => `<option value="${k}"${String(k) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    };
    const span = e => (e.edges ? `${e.edges[0]}〜${e.edges[e.edges.length - 1]} 秒（自分で区切った ${e.edges.length - 1} 区間）` : `${e.start}〜${e.end} 秒，${e.bin} 秒ごと`);
    const missing = rows.filter(r => !r.entry).length;
    cover(`<h2>実験用の設定を書き出す</h2>
      <p class="muted">実験中の画面の設定と、動画ごとの評価区間を setup.json に書き出します。ダウンロードした setup.json を実験フォルダ（experiment.json と同じ場所）に入れてください。</p>
      <div class="refTitle">設定</div>
      <div class="expForm">${E.SETTINGS.filter(d => !d.exp).map(ctl).join('')}</div>
      <div class="refTitle">実験中に出すボタン</div>
      <div class="expForm">${E.SETTINGS.filter(d => d.exp).map(ctl).join('')}</div>
      <div class="refTitle">動画ごとの評価区間（通常の画面で動画を開いて合わせたもの）</div>
      ${rows.length ? `<table class="expVids"><tr><th>動画</th><th>評価区間</th></tr>${rows.map(r => `<tr><td>${esc(r.path)}</td><td>${r.entry ? esc(span(r.entry)) : '<b class="expMiss">未設定</b>'}</td></tr>`).join('')}</table>` : '<p class="muted">動画がありません</p>'}
      ${missing ? `<p class="expMiss">未設定の動画が ${missing} 本あります。実験で使う動画なら、通常の画面で開いて評価区間を合わせてから書き出し直してください（このまま書き出すと、その動画の試行は始められません）。</p>` : ''}
      <div class="expBtns"><button id="esSave" type="button">setup.json を書き出す</button><button id="esClose" type="button">閉じる</button></div>`);
    $('esClose').addEventListener('click', () => cover(''));
    $('esSave').addEventListener('click', () => {
      const settings = {};
      for (const d of E.SETTINGS) {
        const el = $('es_' + d.key);
        settings[d.key] = d.type === 'check' ? el.checked : d.type === 'number' || d.key === 'rate' ? +el.value : el.value;
      }
      const vids = Object.fromEntries(rows.filter(r => r.entry).map(r => [r.path, r.entry]));
      _.download('setup.json', JSON.stringify({ settings, videos: vids }, null, 2), 'application/json');
      $('status').textContent = 'setup.json を書き出しました';
    });
  }

  // ---------- 操作の制限 ----------
  // 開始前・完了後はキーを効かせない（覆いの中の欄とボタンは除く）。見返しを許していなければ V も効かせない。
  // 他のキー操作（core/keys.js）より先に受け取るため、window の捕捉段階で止める
  window.addEventListener('keydown', e => {
    if (e.code === 'KeyE' && e.ctrlKey && e.shiftKey) { if (X && X.state !== 'setup') { e.preventDefault(); exit(); } return; }
    const inCover = !$('expCover').hidden && $('expCover').contains(e.target);
    if (!X) { if (inCover) e.stopImmediatePropagation(); return; }   // setup.json の書き出しの画面の欄
    const block = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    // 覆いの中（「開始」ボタンなど）では既定の動作（Space・Enter で押す）だけを残し、再生などのツールの操作には渡さない
    if (X.state !== 'running') { if (inCover) e.stopImmediatePropagation(); else block(); return; }
    if (e.code === 'KeyV' && !X.set.review && !e.ctrlKey && !e.metaKey) block();
  }, true);

  $('expBtn').addEventListener('click', e => { e.currentTarget.blur(); $('expDir').click(); });
  $('expDir').addEventListener('change', async e => {
    const list = [...e.target.files]; e.target.value = '';
    if (!list.length) return;
    const { cfgFile, setupFile, get } = readFolder(list);
    if (!cfgFile) { setup(null, get, { errors: ['選んだフォルダに experiment.json がありません'] }); return; }
    let exp = null, su = null;
    try { exp = await readJSON(cfgFile); } catch (err) { setup(null, get, { errors: ['experiment.json を JSON として読めません：' + err.message] }); return; }
    try { su = setupFile ? await readJSON(setupFile) : null; } catch (err) { setup(null, get, { errors: ['setup.json を JSON として読めません：' + err.message] }); return; }
    const res = E.check(exp, env(get), su);
    setup(res.errors.length ? exp : E.merge(exp, su), get, res);
  });
  $('expSetupBtn').addEventListener('click', e => { e.currentTarget.blur(); _.closePops(); $('expSetupDir').click(); });
  $('expSetupDir').addEventListener('change', e => { const list = [...e.target.files]; e.target.value = ''; if (list.length) setupExport(list); });
  $('expDoneBtn').addEventListener('click', e => { e.currentTarget.blur(); complete(); });

  // 自動保存から再開してよいか：この実験・参加者・試行の保存データで、「開始」を押した後のもの（core/storage.js）
  const expResumable = s => {
    const m = s && s.meta && s.meta.experiment;
    return !!X && !!m && m.name === X.cfg.name && m.participant === X.pid && m.trial === X.i && (s.log || []).some(l => l.type === 'task_start');
  };
  Object.assign(_, { expResumable, expOn: () => !!X, expBlocked: () => !!X && X.state !== 'running', expState: () => (X ? X.state : null) });
})();
