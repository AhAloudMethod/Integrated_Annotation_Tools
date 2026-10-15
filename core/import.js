// 結果の読み込み：書き出した _session.json・実験モードの zip・評価値の CSV から評価を戻し、続きを編集する
// _session.json（zip の中のものも）は方式・設定・値・評価区間・操作ログをまとめて戻す。一緒に選んだ CSV は、その値を上書きする（表計算で直した値を戻す）。
// CSV だけのときは、ファイル名（<ID>_<動画名>_<方式id>_bins.csv など）から方式と参加者 ID を読み、値と評価区間（t_start・t_end）を戻す。
// 動画を開く前に読み込んだら、動画を開いたときに当てる（core/video.js の takeImport）
(() => {
  const _ = AH._;
  const { $, video, modes, S, addLog, endStroke, setArmed, pen } = _;
  const KINDS = ['bins', 'changepoints', '60hz', 'ranks', 'panas'];
  const V_COLS = ['valence', 'pa', 'energy'], A_COLS = ['arousal', 'na', 'tension'];
  let pending = null;   // 動画を開く前に読み込んだ結果

  // ---------- ファイルを読む ----------
  // CSV：BOM を外し、"…" の中の , と改行と "" を扱う。空の行は捨てる
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', q = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim() !== ''));
  }
  // zip の中のファイル（格納と deflate）。[{ name, bytes }]
  async function unzip(buf) {
    const b = new Uint8Array(buf), v = new DataView(buf), dec = new TextDecoder();
    let e = b.length - 22; while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('zip ではありません');
    const out = []; let p = v.getUint32(e + 16, true);
    for (let k = 0, n = v.getUint16(e + 10, true); k < n; k++) {
      if (v.getUint32(p, true) !== 0x02014b50) break;
      const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lo = v.getUint32(p + 42, true);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nl)), at = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true);
      let bytes = b.subarray(at, at + size);
      if (method === 8) bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      else if (method !== 0) bytes = null;   // 読めない圧縮方式
      if (bytes) out.push({ name, bytes });
      p += 46 + nl + xl + cl;
    }
    return out;
  }
  // ファイル名から CSV の種類・方式・参加者 ID・動画名（拡張子なし）を読む。<ID>[_t01p]_<動画名>_<方式id>_<種類>.csv
  function csvName(name) {
    const m = /^(.*)_([A-Za-z0-9]+)_([A-Za-z0-9]+)\.csv$/.exec(name.split(/[\\/]/).pop());
    if (!m || !KINDS.includes(m[3])) return null;
    const head = /^([^_]*)(?:_t\d+p?)?_(.*)$/.exec(m[1]);
    return { kind: m[3], mode: modes[m[2]] ? m[2] : '', participant: head ? (head[1] === 'noid' ? '' : head[1]) : '', video: head ? head[2] : m[1] };
  }
  // 選んだファイルを読み、{ session, csvs: [{ name, kind, mode, participant, video, rows }], names, skipped } にする
  async function readFiles(files) {
    const r = { session: null, csvs: [], names: [], skipped: [] };
    const take = (name, text) => {
      if (/\.json$/i.test(name)) {
        const s = JSON.parse(text.replace(/^﻿/, ''));
        if (!s || !s.meta || !s.data || !modes[s.meta.mode]) throw new Error(`${name} は書き出した _session.json ではありません`);
        if (r.session) throw new Error('_session.json は 1 つだけ選んでください');
        r.session = { ...s, name }; r.names.push(name); return;
      }
      const c = /\.csv$/i.test(name) && csvName(name);
      if (!c) { r.skipped.push(name); return; }
      r.csvs.push({ ...c, name, rows: parseCSV(text) }); r.names.push(name);
    };
    for (const f of files) {
      if (/\.zip$/i.test(f.name)) {
        const es = (await unzip(await f.arrayBuffer())).filter(x => /_session\.json$/i.test(x.name));   // zip は _session.json だけを使う（中の CSV は同じ値から作ったもの）
        if (!es.length) throw new Error(`${f.name} に _session.json がありません`);
        take(es[0].name, new TextDecoder().decode(es[0].bytes));
      } else take(f.name, await f.text());
    }
    return r;
  }

  // ---------- 値を作る ----------
  const num = x => (x == null || String(x).trim() === '' ? null : Number(x));
  const axisCols = head => [head.findIndex(h => V_COLS.includes(h)), head.findIndex(h => A_COLS.includes(h))];
  // 区間の CSV（t_start・t_end）から評価区間を作る。区間の長さがそろっていれば等間隔、そろっていなければ区切り（edges）
  function rangeFromRows(c) {
    const [head, ...rows] = c.rows, i0 = head.indexOf('t_start'), i1 = head.indexOf('t_end');
    if (i0 < 0 || i1 < 0 || !rows.length) return null;
    const ts = rows.map(r => +r[i0]), end = +rows[rows.length - 1][i1];
    if (ts.some(isNaN) || isNaN(end)) return null;
    const label = /^0:00(\.0)?$/.test(rows[0][head.indexOf('label')] || '') && rows.length > 1 ? 'elapsed' : 'countdown';
    const bin = rows.length > 1 ? +(ts[1] - ts[0]).toFixed(4) : +(end - ts[0]).toFixed(4);
    const even = ts.every((t, k) => Math.abs(t - (ts[0] + k * bin)) < 2e-3);
    return even ? { start: ts[0], count: rows.length, bin, label, target: end } : { start: ts[0], count: rows.length, bin, label, target: end, edges: [...ts, end] };
  }
  // CSV の値を S.data に入れる。戻り値は入れなかった CSV の理由
  function applyCsvs(csvs) {
    const notes = [], model = _.model(), by = k => csvs.find(c => c.kind === k);
    const cp = by('changepoints'), hz = by('60hz'), bins = by('bins'), ranks = by('ranks'), panas = by('panas');
    if (model === 'series' && (cp || hz)) {
      const pts = { v: [], a: [] };
      if (cp) {
        const [head, ...rows] = cp.rows, ia = head.indexOf('axis'), it = head.indexOf('t'), iv = head.indexOf('value');
        for (const r of rows) {
          const ax = V_COLS.includes(r[ia]) ? 'v' : A_COLS.includes(r[ia]) ? 'a' : null, t = num(r[it]), val = num(r[iv]);
          if (ax && t != null && val != null) pts[ax].push({ t, val });
        }
      } else {   // 60 Hz の系列：値が変わった所を変化点にする
        const [head, ...rows] = hz.rows, it = head.indexOf('t'), [jv, ja] = axisCols(head);
        for (const r of rows) for (const [ax, j] of [['v', jv], ['a', ja]]) {
          const t = num(r[it]), val = num(r[j]), ps = pts[ax];
          if (t != null && val != null && (!ps.length || ps[ps.length - 1].val !== val)) ps.push({ t, val });
        }
      }
      for (const ax of ['v', 'a']) {
        const ps = pts[ax].sort((p, q) => p.t - q.t);
        if (!ps.length || ps[0].t > 1e-9) ps.unshift({ t: 0, val: ps.length ? ps[0].val : _.M.init[ax] });
        ps[0] = { t: 0, val: ps[0].val, init: true };
        S.data.points[ax] = ps;
      }
      if (cp && hz) notes.push(`${hz.name}（_changepoints.csv を使いました）`);
    } else for (const c of [cp, hz]) if (c) notes.push(`${c.name}（この方式は変化点を持ちません）`);
    if (bins) {
      const [head, ...rows] = bins.rows, [jv, ja] = axisCols(head);
      if (model !== 'table' || _.M.derivedCells) { if (!(_.M.derivedCells && panas)) notes.push(`${bins.name}（この方式の区間の値は${_.M.derivedCells ? ' _panas.csv の回答' : '変化点や変化の入力'}から作ります）`); }
      else if (_.curveOn && _.curveOn()) notes.push(`${bins.name}（区間内で変化を使う方式は _session.json から読み込んでください）`);
      else if (jv < 0 || ja < 0) notes.push(`${bins.name}（値の列が見つかりません）`);
      else {
        const ib = head.indexOf('bin'), cells = { v: [], a: [] };
        rows.forEach((r, k) => { const s = ib >= 0 ? +r[ib] : k; cells.v[s] = num(r[jv]); cells.a[s] = num(r[ja]); });
        S.data.cells = cells;
      }
    }
    if (ranks) {
      if (model !== 'events') notes.push(`${ranks.name}（この方式は変化の入力を持ちません）`);
      else {
        const [head, ...rows] = ranks.rows, col = k => head.indexOf(k);
        S.data.events = rows.map(r => ({ t: num(r[col('t')]), label: r[col('label')], dv: num(r[col('d_valence')]) || 0, da: num(r[col('d_arousal')]) || 0, source: r[col('source')] || 'input' }))
          .filter(e => e.t != null).sort((p, q) => p.t - q.t);
      }
    }
    if (panas) {
      if (_.M.id !== 'panas') notes.push(`${panas.name}（PANAS 以外の方式です）`);
      else {
        const [head, ...rows] = panas.rows, ib = head.indexOf('bin'), inv = head.indexOf('no_voice'), ids = head.filter(h => /^(pa|na)\d$/.test(h));
        const at = id => head.indexOf(id), order = ['pa', 'na'].flatMap(f => [1, 2, 3, 4, 5, 6, 7, 8].map(k => f + k)).filter(id => ids.includes(id));
        S.data.items = [];
        rows.forEach((r, k) => {
          const s = ib >= 0 ? +r[ib] : k, vals = order.map(id => num(r[at(id)]));
          S.data.items[s] = inv >= 0 && r[inv] === '1' ? 'novoice' : vals.some(x => x != null) ? vals : null;
        });
      }
    }
    return notes;
  }

  // ---------- 当てる ----------
  // 読み込んだ結果を S に入れる（画面の作り直しは呼ぶ側）。動画は開いていること
  function install(p) {
    const s = p.session, c0 = p.csvs[0], id = s ? s.meta.mode : c0.mode;
    _.M = modes[id];
    const base = s ? s.meta : { participant: c0.participant, options: S.meta.mode === id ? S.meta.options : {}, range: null };
    // 動画の名前・長さ・ツールの版は今のもの。評価区間・方式の設定・参加者 ID・実験の記録などは読み込んだもの
    S.meta = { ...S.meta, ...base, mode: id, options: { ...(_.M.options || {}), ...(base.options || {}) }, video_file: S.meta.video_file, duration: video.duration, tool: S.meta.tool };
    if (!s) S.meta.session_start_iso = new Date().toISOString();
    $('pid').value = S.meta.participant || '';
    if (s && s.meta.axes && !_.M.axesOnly && !_.M.vaOnly) _.setAxes(s.meta.axes, true);
    const range = s ? s.meta.range : (p.csvs.map(rangeFromRows).find(Boolean) || null);
    S.meta.range = range || _.defaultRange(S.meta.duration);
    const e = _.emptyData();
    S.data = s ? { ...e, ...s.data, points: s.data.points || e.points, cells: s.data.cells || e.cells } : e;
    S.log = s && Array.isArray(s.log) ? s.log : [];
    S.undo = []; S.redo = [];
    S.t0 = performance.now() - (S.log.length ? S.log[S.log.length - 1].wall_ms : 0);   // 操作ログの経過時間は続きから数える
    const notes = applyCsvs(p.csvs);
    if (!s) addLog('session_start', { detail: `import mode=${id}` });
    addLog('import', { detail: p.names.join(' ') });
    _.saveRange();
    return notes;
  }
  const videoBase = n => String(n || '').replace(/\.[^.]+$/, '');
  const fileOf = p => (p.session ? videoBase(p.session.meta.video_file) : p.csvs[0].video);
  // 結果の知らせ（画面上部の案内。ステータス欄は画面の更新で消えるので使わない）。使わなかったファイルがあれば長めに出す
  function notify(msg, ok) {
    const el = $('hint'); el.textContent = msg; el.hidden = false; el.classList.toggle('ok', ok);
    clearTimeout(notify.tm); notify.tm = setTimeout(() => { el.hidden = true; }, ok ? 3000 : 8000);
  }
  const report = (p, notes) => {
    const skip = [...p.skipped.map(n => `${n}（読めない種類のファイル）`), ...notes];
    notify(`結果を読み込みました（${p.names.length}ファイル）` + (skip.length ? `。使わなかったもの：${skip.join('、')}` : ''), !skip.length);
  };
  // 動画を開いたとき（core/video.js）：先に読み込んだ結果があれば当てて true。動画名が違えば確認する
  function takeImport() {
    if (!pending) return false;
    const p = pending; pending = null;
    if (_.expOn && _.expOn()) return false;   // 実験モードの試行には当てない
    if (fileOf(p) !== videoBase(S.meta.video_file) && !confirm(`読み込んだ結果は「${fileOf(p)}」の評価です。開いた動画「${S.meta.video_file}」に当てますか？\n（キャンセルすると、読み込んだ結果は使いません）`)) return false;
    report(p, install(p));
    return true;
  }
  async function importFiles(files) {
    if (_.expOn && _.expOn()) { notify('実験モードでは結果を読み込めません', false); return; }
    let p;
    try { p = await readFiles(files); } catch (err) { alert('結果を読み込めませんでした：' + err.message); return; }
    if (!p.session && !p.csvs.length) { alert('読み込めるファイルがありません（_session.json，実験モードの zip，評価値の CSV を選んでください）'); return; }
    const id = p.session ? p.session.meta.mode : (p.csvs.find(c => c.mode) || {}).mode;
    if (!id) { alert('CSV のファイル名から方式が分かりません（<ID>_<動画名>_<方式id>_bins.csv の形にしてください）'); return; }
    p.csvs.forEach(c => { c.mode = c.mode || id; });
    if (!p.session && p.csvs.some(c => c.mode !== id)) { alert('違う方式の CSV が混ざっています'); return; }
    if (!p.session && id === 'custom' && S.meta.mode !== 'custom') { alert('カスタムの CSV は，同じ設定のカスタムを選んでから読み込むか，_session.json と一緒に選んでください'); return; }
    if (p.session) p.csvs = p.csvs.filter(c => { if (c.mode === id) return true; p.skipped.push(c.name); return false; });
    if (!video.src) {
      pending = p;
      notify(`結果を読み込みました。動画「${fileOf(p)}」を開くと当てます`, true);
      return;
    }
    const other = fileOf(p) !== videoBase(S.meta.video_file) ? `\n※ 読み込んだ結果は「${fileOf(p)}」の評価です（開いている動画は「${S.meta.video_file}」）。` : '';
    if (!confirm(`今の評価（方式・参加者 ID・値・評価区間）を，読み込んだ結果で置き換えます。よろしいですか？${other}`)) return;
    endStroke('import'); setArmed(false); pen.down = false;
    _.autosave();   // 置き換える前の評価を今のキーに残す
    const notes = install(p);
    _.selectMode(S.meta.mode, true); _.syncRangeUI();
    _.seekTo(video.currentTime);   // 方式の操作面を読み込んだ値に追従させる
    _.refresh(); _.autosave();
    report(p, notes);
  }

  $('importBtn').addEventListener('click', e => { e.currentTarget.blur(); $('importFile').click(); });
  $('importFile').addEventListener('change', e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) importFiles(fs); });

  Object.assign(_, { importFiles, takeImport, parseCSV, unzip });
})();
