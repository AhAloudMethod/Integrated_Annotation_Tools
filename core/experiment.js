// 実験モード：参加者内で方式を比べる実験に使う。実験者は experiment.json と動画を入れたフォルダを選び、参加者を選ぶ。
// 試行（方式×動画）を設定ファイルの順に進め、参加者が選べる要素（ID・方式・設定・評価区間など）を隠す。
// 各試行は ready（覆いに「開始」）→ running（評価する）→ done（完了で書き出し、入力をロック）と進む。
// タスク遂行時間は「開始」から「完了」まで。操作ログに task_start・task_end を残し、内訳（再生時間・シークの回数など）を要約にする。
// 当てた設定はブラウザに保存されるので、実験モードを抜けるとき（とページを閉じるとき）に元の値へ戻す。Ctrl+Shift+E で抜ける
(() => {
  const _ = AH._;
  const { $, video, S, modes, addLog, endStroke, setArmed, pen } = _;
  // 設定の既定値（書いていない項目はこれ。参加者のブラウザに残った値は使わない）と検査は core/exp-check.js
  const { DEF } = _.expCheck;
  const LS_KEYS = ['ahann_axes', 'ahann_after', 'ahann_grid', 'ahann_pad_square', 'ahann_f0', 'ahann_listen', 'ahann_tl', 'ahann_vidsize', 'ahann_pad_joy', 'ahann_pad_slider'];
  const SUM_COLS = ['trial', 'practice', 'mode', 'video', 'start_iso', 'end_iso', 'task_ms', 'play_ms', 'review_ms', 'n_play', 'n_seek', 'n_undo', 'n_redo',
    'n_strokes', 'n_events', 'bins', 'filled_v', 'filled_a', 'n_restore'];
  // X：実験の状態。cfg（設定ファイル）、files（相対パス→File）、pid、trials、i（今の試行）、set（今の設定）、state、backup（元の設定）
  let X = null;

  // ---------- フォルダの読み込みと検査 ----------
  // 選んだフォルダの中の experiment.json（いちばん浅いもの）を探し、動画のパスはそのフォルダからの相対で引く
  function readFolder(list) {
    const files = new Map(); let cfgFile = null, base = '', depth = Infinity;
    for (const f of list) {
      const rel = (f.webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name;
      files.set(rel, f);
      const d = rel.split('/').length;
      if (f.name === 'experiment.json' && d < depth) { depth = d; cfgFile = f; base = rel.slice(0, -'experiment.json'.length); }
    }
    const get = p => files.get(base + String(p).replace(/^\.\//, '').replace(/\\/g, '/'));
    return { cfgFile, get };
  }
  function validate(cfg, get) {
    return _.expCheck.check(cfg, { modes: Object.keys(modes), axes: Object.keys(_.AXES), has: p => !!get(p) });
  }

  // ---------- 進行（終えた試行と要約）はブラウザに残す ----------
  const progKey = () => `ahann_exp:${X.cfg.name}:${X.pid}`;
  function loadProgress(pid) {
    try { return JSON.parse(localStorage.getItem(`ahann_exp:${X.cfg.name}:${pid}`) || '{}').done || {}; } catch (_e) { return {}; }
  }
  function saveProgress(i, row) {
    const done = loadProgress(X.pid); done[i] = row;
    try { localStorage.setItem(progKey(), JSON.stringify({ done })); } catch (_e) {}
  }

  // ---------- 覆い（設定の画面・開始・完了後） ----------
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function cover(html) {
    $('expCover').hidden = !html;
    if (html) $('expCard').innerHTML = html;
  }
  const trialName = (t, k) => `${k + 1}. ${t.practice ? '練習　' : ''}${modes[t.mode] ? modes[t.mode].label : t.mode}　${t.video}`;
  function setup(cfg, get, { errors: errs, warnings = [] }) {
    X = { cfg, get, state: 'setup', backup: null };
    if (errs.length) {
      cover(`<h2>実験フォルダの誤り</h2><ul class="expErr">${errs.map(e => `<li>${esc(e)}</li>`).join('')}</ul><button id="expCancel" type="button">閉じる</button>`);
      $('expCancel').addEventListener('click', () => { X = null; cover(''); });
      return;
    }
    const pids = Object.keys(cfg.participants);
    cover(`<h2>実験：${esc(cfg.name)}</h2>
      ${warnings.length ? `<p>確かめてください（このままでも始められます）：</p><ul class="expWarn">${warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      <label>参加者 <select id="expPid">${pids.map(p => `<option>${esc(p)}</option>`).join('')}</select></label>
      <label>始める試行 <select id="expFrom"></select></label>
      <div class="expBtns"><button id="expGo" type="button">実験を始める</button><button id="expCancel" type="button">やめる</button></div>
      <p class="muted">実験中は Ctrl+Shift+E で実験モードを抜けます。完了のたびに書き出すので、ブラウザが複数のファイルのダウンロードを確認したら許可してください。</p>`);
    const fill = () => {
      const pid = $('expPid').value, done = loadProgress(pid), ts = cfg.participants[pid];
      const first = ts.findIndex((_t, k) => !done[k]);
      $('expFrom').innerHTML = ts.map((t, k) => `<option value="${k}">${esc(trialName(t, k))}${done[k] ? '（済）' : ''}</option>`).join('');
      $('expFrom').value = String(first < 0 ? 0 : first);
    };
    $('expPid').addEventListener('change', fill); fill();
    $('expCancel').addEventListener('click', () => { X = null; cover(''); });
    $('expGo').addEventListener('click', () => enter($('expPid').value, +$('expFrom').value));
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
  function exit() {
    if (!confirm('実験モードを終了しますか？（ページを読み込み直し、設定を実験前に戻します）')) return;
    if (video.src) { endStroke('exp_exit'); _.autosave(); }
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
  function applyRange(r) {
    const D = S.meta.duration, start = Math.min(r.start || 0, D), end = Math.min(r.end != null ? r.end : D, D), bin = r.bin || 1;
    _.setRange({ edges: null, start, bin, label: r.label || 'countdown', target: end, count: _.countFor(start, Math.max(start + bin, end), bin) });
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
    X.range = { ...(X.cfg.range || {}), ...(t.range || {}) };
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
      name: X.cfg.name, participant: X.pid, trial: i, n_trials: X.trials.length, practice: !!t.practice, settings: X.set, options: { ...S.meta.options } };
    if (!started) {   // 復元したときは、その時点の評価区間のまま続ける
      applyRange(X.range);
      addLog('exp_trial', { value: i + 1, detail: JSON.stringify({ name: X.cfg.name, mode: t.mode, video: t.video, practice: !!t.practice }) });
    }
    setState(ended ? (i + 1 < X.trials.length ? 'done' : 'finished') : started ? 'running' : 'ready');
  }
  const progText = () => `${X.i + 1} / ${X.trials.length}${X.trials[X.i].practice ? '　練習' : ''}`;
  function setState(st) {
    X.state = st;
    document.body.classList.toggle('expWait', st !== 'running');
    $('expInfo').hidden = false; $('expInfo').textContent = progText();
    $('expDoneBtn').hidden = st !== 'running';
    const head = `<p class="expProg">${esc(progText())}</p>`;
    if (st === 'loading') cover(head + '<p>読み込んでいます…</p>');
    else if (st === 'ready') {
      cover(head + '<p>準備ができたら「開始」を押してください。</p><button id="expStart" type="button" class="expMain">開始</button>');
      $('expStart').addEventListener('click', start);   // フォーカスは置かない（Space で誤って始めないように）
    } else if (st === 'done' || st === 'finished') {
      // アンケートがある試行は、「アンケートを開く」を押すまで「次へ」（最後なら終わりの案内）を出さない
      const url = surveyUrl(X.i), last = st === 'finished';
      const next = last ? '<p>すべての試行が終わりました。ありがとうございました。</p><button id="expSum" type="button">要約をもう一度書き出す</button>'
        : '<button id="expNext" type="button" class="expMain">次へ</button>';
      cover(head + '<p>完了しました。</p>' + (url ? '<p>アンケートに答えてください。答え終わったら、この画面に戻ってください。</p><button id="expSurvey" type="button" class="expMain">アンケートを開く</button>' : '')
        + `<div id="expAfter"${url ? ' hidden' : ''} class="expAfter">${next}</div>`);
      if (url) $('expSurvey').addEventListener('click', () => {
        window.open(url, '_blank');
        addLog('survey_open', { value: X.i + 1, detail: url });
        $('expAfter').hidden = false;
      });
      if (last) $('expSum').addEventListener('click', exportSummary);
      else $('expNext').addEventListener('click', () => startTrial(X.i + 1));
    } else cover('');
  }
  // アンケートの URL：試行の survey（false なら無し）、なければ全体の survey（練習の試行には使わない）。{pid} などを試行の値に置き換える
  function surveyUrl(i) {
    const t = X.trials[i];
    const tpl = t.survey !== undefined ? t.survey : t.practice ? null : X.cfg.survey;
    if (!tpl) return null;
    const val = { pid: X.pid, trial: i + 1, mode: t.mode, video: t.video, practice: t.practice ? 1 : 0, name: X.cfg.name };
    return tpl.replace(/\{(pid|trial|mode|video|practice|name)\}/g, (_m, k) => encodeURIComponent(val[k]));
  }
  function start() {
    if (!X || X.state !== 'ready') return;
    S.meta.experiment.start_iso = new Date().toISOString();
    addLog('task_start', { value: X.i + 1 });
    setState('running');
  }
  function complete() {
    if (!X || X.state !== 'running') return;
    if (!confirm('評価を終えて完了しますか？（完了すると、この動画の評価は変えられません）')) return;
    if (!video.paused) video.pause();
    if (_.reviewing()) _.setReview(false);
    if (_.setVoice) _.setVoice(false);
    endStroke('task_end'); setArmed(false); pen.down = false;
    S.meta.experiment.end_iso = new Date().toISOString();
    addLog('task_end', { value: X.i + 1 });
    const row = summarize();
    S.meta.experiment.task = row;
    _.exportAll();
    saveProgress(X.i, row);
    const last = X.i + 1 >= X.trials.length;
    setState(last ? 'finished' : 'done');
    if (last) exportSummary();
  }

  // ---------- 要約 ----------
  // 最後の task_start から task_end（なければ今）までの操作ログを数える。再生・見返しの時間は、開始と終わりの組の間の合計
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
    const bins = _.nSec(), filled = ax => S.data.cells[ax].slice(0, bins).filter(x => x != null && x !== '').length;
    return { trial: X.i + 1, practice: t.practice ? 1 : 0, mode: t.mode, video: t.video,
      start_iso: S.meta.experiment.start_iso || '', end_iso: S.meta.experiment.end_iso || '',
      task_ms: +(w1 - w0).toFixed(1), play_ms: +play.toFixed(1), review_ms: +rev.toFixed(1),
      n_play: n('play'), n_seek: n('seek'), n_undo: n('undo'), n_redo: n('redo'),
      n_strokes: S.data.strokes.length, n_events: S.data.events.length, bins, filled_v: filled('v'), filled_a: filled('a'),
      n_restore: log.filter(l => l.type === 'restore').length };
  }
  function exportSummary() {
    const done = loadProgress(X.pid);
    const rows = Object.keys(done).map(Number).sort((a, b) => a - b).map(k => SUM_COLS.map(c => done[k][c]));
    _.download(`${X.pid}_${X.cfg.name}_trials.csv`, _.toCSV(SUM_COLS, rows), 'text/csv');
  }

  // ---------- 操作の制限 ----------
  // 開始前・完了後はキーを効かせない（覆いの中の欄とボタンは除く）。見返しを許していなければ V も効かせない。
  // 他のキー操作（core/keys.js）より先に受け取るため、window の捕捉段階で止める
  window.addEventListener('keydown', e => {
    if (e.code === 'KeyE' && e.ctrlKey && e.shiftKey) { if (X && X.state !== 'setup') { e.preventDefault(); exit(); } return; }
    if (!X) return;
    const block = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    // 覆いの中（「開始」ボタンなど）では既定の動作（Space・Enter で押す）だけを残し、再生などのツールの操作には渡さない
    if (X.state !== 'running') { if ($('expCover').contains(e.target)) e.stopImmediatePropagation(); else block(); return; }
    if (e.code === 'KeyV' && !X.set.review && !e.ctrlKey && !e.metaKey) block();
  }, true);

  $('expBtn').addEventListener('click', e => { e.currentTarget.blur(); $('expDir').click(); });
  $('expDir').addEventListener('change', async e => {
    const list = [...e.target.files]; e.target.value = '';
    if (!list.length) return;
    const { cfgFile, get } = readFolder(list);
    if (!cfgFile) { setup(null, get, { errors: ['選んだフォルダに experiment.json がありません'] }); return; }
    let cfg = null;
    try { cfg = JSON.parse(await cfgFile.text()); } catch (err) { setup(null, get, { errors: ['experiment.json を JSON として読めません：' + err.message] }); return; }
    setup(cfg, get, validate(cfg, get));
  });
  $('expDoneBtn').addEventListener('click', e => { e.currentTarget.blur(); complete(); });

  Object.assign(_, { expOn: () => !!X, expBlocked: () => !!X && X.state !== 'running', expState: () => (X ? X.state : null), expValidate: validate });
})();
