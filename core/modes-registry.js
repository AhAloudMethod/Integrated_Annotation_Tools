// 方式の登録・切り替え
(() => {
  const _ = AH._;
  const { $, video, modes, S, emptyData, addLog, defaultRange, pen, endStroke, setArmed, refresh } = _;
  // ---------- 方式の登録・切り替え ----------
  function register(m) { modes[m.id] = m; }
  function remount() {
    for (const el of ['panel', 'overlay', 'under']) $(el).innerHTML = '';
    $('stage').style.boxShadow = '';
    document.body.dataset.side = _.M.side || 'normal';
    $('modeHelp').innerHTML = _.relabel(_.M.help || '');
    _.M.mount({ panel: $('panel'), overlay: $('overlay'), under: $('under') });
    _.resize();
  }
  function selectMode(id, keepOptions = false) {
    _.M = modes[id]; S.meta.mode = id; $('mode').value = id;
    S.meta.options = { ...(_.M.options || {}), ...(keepOptions ? S.meta.options : {}) };
    if (!S.data || !video.src) S.data = emptyData();
    remount();
  }
  // 評価の途中で方式を切り替える：今の評価を保存し、切り替え先の保存データがあれば再開、なければ新規
  function switchMode(id) {
    if (!video.src) { selectMode(id); refresh(); return; }
    if (id === S.meta.mode) return;
    endStroke('mode_switch'); setArmed(false); pen.down = false;
    addLog('mode_switch', { detail: `${S.meta.mode} -> ${id}` }); _.autosave();
    const range = S.meta.range;
    _.M = modes[id]; S.meta.mode = id; S.meta.options = {};
    if (!_.tryRestore()) newSession(`mode=${id}`, range);
    selectMode(id, true); refresh();
  }
  function newSession(detail, range) {
    S.data = emptyData(); S.log = []; S.undo = [];
    S.t0 = performance.now(); S.meta.session_start_iso = new Date().toISOString();
    S.meta.range = range || defaultRange(S.meta.duration);
    addLog('session_start', { detail });
    if (_.padLogAll) _.padLogAll();   // つながっているゲームパッドを残す
  }
  function setOption(k, v) { S.meta.options[k] = v; addLog('option', { detail: `${k}=${v}` }); refresh(); }

  Object.assign(_, { register, remount, selectMode, switchMode, newSession, setOption });
})();
