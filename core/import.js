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
  // CSV：BOM を外し、"…" の中の , と改行と "" を扱う。空の行は捨てる。各行の line はファイルの行番号（警告に使う）
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', q = false, ln = 1, start = 1;
    const end = () => { row.push(cell); row.line = start; rows.push(row); row = []; cell = ''; start = ln; };
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else { if (c === '\n') ln++; cell += c; } }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; ln++; end(); }
      else cell += c;
    }
    if (cell !== '' || row.length) end();
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
  // 方式に合わない CSV も、直せる部分は直して読む（区間の値 ⇄ 変化点）。行やセルの値が不正なら、そこだけ飛ばして警告に残す
  const num = x => { const s = String(x ?? '').trim(); return s === '' ? null : Number(s); };
  const AXN = { v: V_COLS, a: A_COLS };
  // 軸の値の列：valence（pa・energy）、無ければ valence_r9、valence_mean（区間内で変化の書き出しも _mean を持つ）
  function axisCol(head, ax) {
    for (const suf of ['', '_r9', '_mean']) for (const n of AXN[ax]) { const i = head.indexOf(n + suf); if (i >= 0) return { i, name: n + suf, mean: suf === '_mean' }; }
    return null;
  }
  // 区間の CSV（t_start・t_end）から評価区間を作る。区間の長さがそろっていれば等間隔、そろっていなければ区切り（edges）
  function rangeFromRows(c) {
    const [head, ...rows] = c.rows, i0 = head.indexOf('t_start'), i1 = head.indexOf('t_end');
    if ((c.kind !== 'bins' && c.kind !== 'panas') || i0 < 0 || i1 < 0 || !rows.length) return null;
    const ts = rows.map(r => num(r[i0])), end = num(rows[rows.length - 1][i1]);
    if (ts.some(t => t == null || !isFinite(t)) || end == null || !isFinite(end) || ts.some((t, k) => k && t <= ts[k - 1]) || end <= ts[ts.length - 1]) return null;
    const label = /^0:00(\.0)?$/.test(rows[0][head.indexOf('label')] || '') && rows.length > 1 ? 'elapsed' : 'countdown';
    const bin = rows.length > 1 ? +(ts[1] - ts[0]).toFixed(4) : +(end - ts[0]).toFixed(4);
    const even = ts.every((t, k) => Math.abs(t - (ts[0] + k * bin)) < 2e-3);
    return even ? { start: ts[0], count: rows.length, bin, label, target: end } : { start: ts[0], count: rows.length, bin, label, target: end, edges: [...ts, end] };
  }
  // CSV の値を S.data に入れる。戻り値 { warns（読み込めずに飛ばした所）, notes（使わなかった CSV）, convs（方式に合わせて直して読んだ CSV） }
  function applyCsvs(csvs) {
    const warns = [], notes = [], convs = [], model = _.model(), M = _.M, D = S.meta.duration;
    const W = (c, r, msg) => warns.push(`${c.name}${r ? ` ${r.line} 行目` : ''}：${msg}`);
    const bounded = !M.unbounded, int = _.isInt();
    // 軸の値を確かめる。区間の値は 0（発声なし）も入る。正しければ数、空欄は null、不正なら undefined（警告を出す）
    const axVal = (c, r, col, x, cell = false) => {
      const v = num(x);
      if (v == null) return null;
      if (!isFinite(v)) { W(c, r, `${col} の「${x}」は数ではありません`); return undefined; }
      if (cell && v === 0) return 0;
      if (bounded && (v < 1 || v > 9)) { W(c, r, `${col} の ${v} は範囲（1〜9${cell ? '，発声なしは 0' : ''}）の外です`); return undefined; }
      if (cell && int && !Number.isInteger(v)) { W(c, r, `${col} の ${v} は整数ではありません`); return undefined; }
      return v;
    };
    const timeOf = (c, r, i, col = 't') => {
      const t = num(r[i]);
      if (t == null || !isFinite(t) || t < 0 || t > D + 1e-3) { W(c, r, `${col} の「${r[i] ?? ''}」は動画の時刻（0〜${D.toFixed(3)} 秒）ではありません`); return null; }
      return t;
    };
    // 区間の行がどの区間か：t_start があれば時刻で合わせる（評価区間が違う CSV でも、区切りが合う行は入る）。無ければ bin の番号、それも無ければ行の順
    const binOf = (c, head, r, k) => {
      const i0 = head.indexOf('t_start'), ib = head.indexOf('bin'), n = _.nSec();
      if (i0 >= 0) {
        const t = num(r[i0]), s = t == null || !isFinite(t) ? -1 : _.binAt(t + 1e-6);
        if (s < 0 || s >= n || Math.abs(_.binStart(s) - t) > 0.01) { W(c, r, `t_start の「${r[i0] ?? ''}」は今の評価区間の区切りに合いません`); return -1; }
        return s;
      }
      const s = ib >= 0 ? num(r[ib]) : k;
      if (!Number.isInteger(s) || s < 0 || s >= n) { W(c, r, `区間「${ib >= 0 ? r[ib] : k}」は今の評価区間（0〜${n - 1}）にありません`); return -1; }
      return s;
    };
    // 変化点を作る（連続の方式へ入れる。区間方式では区間の値へ直す元）。{ v, a } か、作れなければ null
    function pointsFrom(c) {
      const [head, ...rows] = c.rows, pts = { v: [], a: [] };
      if (c.kind === 'changepoints') {
        const ia = head.indexOf('axis'), it = head.indexOf('t'), iv = head.indexOf('value');
        if (ia < 0 || it < 0 || iv < 0) { W(c, null, 'axis・t・value の列がありません'); return null; }
        for (const r of rows) {
          const ax = AXN.v.includes(r[ia]) ? 'v' : AXN.a.includes(r[ia]) ? 'a' : null;
          if (!ax) { W(c, r, `axis の「${r[ia] ?? ''}」は軸の名前ではありません`); continue; }
          const t = timeOf(c, r, it), val = axVal(c, r, 'value', r[iv]);
          if (t != null && val === null) W(c, r, 'value が空欄です');
          if (t != null && val != null) pts[ax].push({ t, val });
        }
      } else if (c.kind === '60hz') {   // 値が変わった所を変化点にする
        const it = head.indexOf('t'), cols = { v: axisCol(head, 'v'), a: axisCol(head, 'a') };
        if (it < 0 || !cols.v || !cols.a) { W(c, null, 't と軸の値の列がありません'); return null; }
        for (const r of rows) {
          const t = num(r[it]);
          if (t == null || !isFinite(t) || t < 0 || t > D + 1e-3) { W(c, r, `t の「${r[it] ?? ''}」は動画の時刻ではありません`); continue; }
          for (const ax of ['v', 'a']) { const val = axVal(c, r, cols[ax].name, r[cols[ax].i]), ps = pts[ax]; if (val != null && (!ps.length || ps[ps.length - 1].val !== val)) ps.push({ t, val }); }
        }
      } else {   // 区間の値（_bins.csv）：区間の始めから続く階段にする。空欄・発声なしの区間は前の値のまま
        const i0 = head.indexOf('t_start'), cols = { v: axisCol(head, 'v'), a: axisCol(head, 'a') };
        if (i0 < 0 || !cols.v || !cols.a) { W(c, null, 't_start と軸の値の列がありません'); return null; }
        for (const r of rows) {
          const t = timeOf(c, r, i0, 't_start'); if (t == null) continue;
          for (const ax of ['v', 'a']) {
            const val = axVal(c, r, cols[ax].name, r[cols[ax].i], true);
            if (val === 0) W(c, r, `${cols[ax].name} は発声なし（0）なので，連続の値にしません`);
            else if (val != null) pts[ax].push({ t, val });
          }
        }
      }
      for (const ax of ['v', 'a']) {
        const ps = pts[ax].sort((p, q) => p.t - q.t);
        if (!ps.length || ps[0].t > 1e-9) ps.unshift({ t: 0, val: ps.length ? ps[0].val : M.init[ax] });
        ps[0] = { t: 0, val: ps[0].val, init: true };
        if (c.kind === 'bins') pts[ax] = ps.filter((q, i) => !i || q.val !== ps[i - 1].val);   // 区間の値から作った点は、前と同じ値の点を除く
      }
      return pts;
    }
    // 区間の値を入れる：正しいセルだけ上書きし（空欄は消す）、不正なセルは今の値のまま
    function cellsFrom(c) {
      const [head, ...rows] = c.rows, cols = { v: axisCol(head, 'v'), a: axisCol(head, 'a') };
      if (!cols.v && !cols.a) { W(c, null, '値の列（valence・arousal など）がありません'); return; }
      rows.forEach((r, k) => {
        const s = binOf(c, head, r, k); if (s < 0) return;
        for (const ax of ['v', 'a']) {
          const col = cols[ax]; if (!col) continue;
          const shape = head.indexOf(col.name.replace(/_mean$/, '_shape'));   // 区間内で変化の書き出し：const 以外の形は 1 つの値にできない
          if (col.mean && shape >= 0 && r[shape] && r[shape] !== 'const') { W(c, r, `${col.name.replace(/_mean$/, '')} は区間内で変化（${r[shape]}）なので読み込めません`); continue; }
          const x = num(r[col.i]), v = col.mean && x != null && isFinite(x) && x !== 0 ? Math.round(x) : r[col.i];   // 平均の列は四捨五入
          const val = axVal(c, r, col.name, v, true);
          if (val !== undefined) S.data.cells[ax][s] = val;
        }
      });
    }
    // 変化点から区間の値を作る（区間の中の 60 Hz の値の平均を四捨五入）
    function cellsFromPoints(pts) {
      for (let s = 0; s < _.nSec(); s++) for (const ax of ['v', 'a']) {
        const k0 = Math.round(_.binStart(s) * _.FPS), k1 = Math.max(k0 + 1, Math.round(_.binEnd(s) * _.FPS));
        let sum = 0; for (let k = k0; k < k1; k++) sum += _.valueIn(pts[ax], k / _.FPS);
        S.data.cells[ax][s] = _.clamp(Math.round(sum / (k1 - k0)), 1, 9);
      }
    }

    const by = {}; for (const c of csvs) (by[c.kind] = by[c.kind] || []).push(c);
    for (const k in by) for (const c of by[k].slice(1)) notes.push(`${c.name}（同じ種類の CSV は最初の 1 つだけを使いました）`);
    const one = k => (by[k] ? by[k][0] : null), cp = one('changepoints'), hz = one('60hz'), bins = one('bins'), ranks = one('ranks'), panas = one('panas');
    const from = c => (c.mode && c.mode !== M.id ? `「${modes[c.mode].label}」の` : '');
    const unused = (c, why) => { if (c) notes.push(`${c.name}（${why}）`); };
    if (model === 'series') {
      const src = cp || hz || bins;
      const pts = src && pointsFrom(src);
      if (pts) { S.data.points = pts; if (src === bins) convs.push(`${bins.name}（${from(bins)}区間の値を，区間の始めから続く変化点に直しました）`); }
      if (src !== hz) unused(hz, '_changepoints.csv を使いました');
      if (src !== bins) unused(bins, 'この方式の区間の値は変化点から作ります');
    } else if (model === 'table' && !M.derivedCells) {
      if (bins) cellsFrom(bins);
      else if (cp || hz) {
        const pts = pointsFrom(cp || hz);
        if (pts) { cellsFromPoints(pts); convs.push(`${(cp || hz).name}（${from(cp || hz)}変化点を，区間ごとの平均を四捨五入した区間の値に直しました）`); }
      }
      if (bins || cp) unused(hz, bins ? '_bins.csv を使いました' : '_changepoints.csv を使いました');
      if (bins) unused(cp, '_bins.csv を使いました');
    } else {
      const why = model === 'events' ? 'この方式は変化の入力を記録します（値から直せません）' : 'この方式の区間の値は _panas.csv の回答から作ります';
      unused(cp, why); unused(hz, why);
      if (!(M.derivedCells && panas)) unused(bins, why);
    }
    if (ranks) {
      if (model !== 'events') unused(ranks, 'この方式は変化の入力を持ちません');
      else {
        const [head, ...rows] = ranks.rows, col = k => head.indexOf(k), evs = [];
        if (col('t') < 0) W(ranks, null, 't の列がありません');
        else {
          for (const r of rows) {
            const t = timeOf(ranks, r, col('t')); if (t == null) continue;
            const d = k => { const x = num(r[col(k)]) ?? 0; if (![-1, 0, 1].includes(x)) { W(ranks, r, `${k} の「${r[col(k)]}」は −1・0・1 ではありません`); return undefined; } return x; };
            const dv = d('d_valence'), da = d('d_arousal'); if (dv === undefined || da === undefined) continue;
            evs.push({ t, label: r[col('label')] ?? '', dv, da, source: r[col('source')] || 'input' });
          }
          S.data.events = evs.sort((p, q) => p.t - q.t);
        }
      }
    }
    if (panas) {
      if (M.id !== 'panas') unused(panas, 'PANAS 以外の方式です');
      else {
        const [head, ...rows] = panas.rows, inv = head.indexOf('no_voice'), ids = ['pa', 'na'].flatMap(f => [1, 2, 3, 4, 5, 6, 7, 8].map(k => f + k));
        if (!S.data.items) S.data.items = [];
        rows.forEach((r, k) => {
          const s = binOf(panas, head, r, k); if (s < 0) return;
          if (inv >= 0 && String(r[inv]).trim() === '1') { S.data.items[s] = 'novoice'; return; }
          const cur = Array.isArray(S.data.items[s]) ? S.data.items[s] : [];
          const vals = ids.map((id, i) => {   // 不正な回答は今の回答のまま
            const j = head.indexOf(id); if (j < 0) return cur[i] ?? null;
            const v = num(r[j]); if (v == null) return null;
            if (!Number.isInteger(v) || v < 1 || v > 6) { W(panas, r, `${id} の「${r[j]}」は 1〜6 の整数ではありません`); return cur[i] ?? null; }
            return v;
          });
          S.data.items[s] = vals.some(x => x != null) ? vals : null;
        });
      }
    }
    return { warns, notes, convs };
  }

  // ---------- 当てる ----------
  // 読み込んだ結果を S に入れる（画面の作り直しは呼ぶ側）。動画は開いていること
  function install(p) {
    const s = p.session, id = p.mode, c0 = p.csvs.find(c => c.mode === id) || p.csvs[0];
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
    const res = applyCsvs(p.csvs);
    if (!s) addLog('session_start', { detail: `import mode=${id}` });
    addLog('import', { value: res.warns.length, detail: p.names.join(' ') });   // value：読み込めずに飛ばした値の数
    _.saveRange();
    return res;
  }
  const videoBase = n => String(n || '').replace(/\.[^.]+$/, '');
  const fileOf = p => (p.session ? videoBase(p.session.meta.video_file) : p.csvs[0].video);
  // 結果の知らせ（画面上部の案内。ステータス欄は画面の更新で消えるので使わない）。使わなかったファイルがあれば長めに出す
  function notify(msg, ok) {
    const el = $('hint'); el.textContent = msg; el.hidden = false; el.classList.toggle('ok', ok);
    clearTimeout(notify.tm); notify.tm = setTimeout(() => { el.hidden = true; }, ok ? 3000 : 8000);
  }
  // 使わなかった CSV は上の案内に出す。読み込めずに飛ばした値（warns）と、方式に合わせて直して読んだ CSV（convs）は、確かめられるよう一覧をダイアログで出す
  const report = (p, { warns, notes, convs }) => {
    const ns = [...p.skipped.map(n => `${n}（読めない種類のファイル）`), ...notes];
    notify(`結果を読み込みました（${p.names.length}ファイル）` + (warns.length ? `。読み込めない値 ${warns.length} 件を飛ばしました` : '') + (ns.length ? `。使わなかったもの：${ns.join('、')}` : ''), !warns.length && !ns.length);
    if (!warns.length && !convs.length) return;
    const list = (xs, n) => xs.slice(0, n).map(x => '・' + x).join('\n') + (xs.length > n ? `\n…ほか ${xs.length - n} 件` : '');   // 多いときは先頭だけ
    alert('結果を読み込みました。\n' + (warns.length ? `\n次の値は読み込めないので飛ばし，今の値のままにしました（${warns.length} 件）：\n${list(warns, 30)}\n` : '')
      + (convs.length ? `\n方式に合わせて直して読み込みました：\n${list(convs, 10)}\n` : '') + (ns.length ? `\n使わなかったもの：\n${list(ns, 10)}` : ''));
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
    // 方式：_session.json の方式。CSV だけなら、ファイル名の方式（違う方式が混ざっていれば、今の方式があればそれ、無ければ最初の CSV の方式）。
    // 違う方式の CSV も、直せる部分は直して読む（applyCsvs）
    const ms = p.csvs.map(c => c.mode).filter(Boolean);
    const id = p.session ? p.session.meta.mode : ms.includes(S.meta.mode) ? S.meta.mode : ms[0];
    if (!id) { alert('CSV のファイル名から方式が分かりません（<ID>_<動画名>_<方式id>_bins.csv の形にしてください）'); return; }
    if (!p.session && id === 'custom' && S.meta.mode !== 'custom') { alert('カスタムの CSV は，同じ設定のカスタムを選んでから読み込むか，_session.json と一緒に選んでください'); return; }
    p.mode = id;
    if (!video.src) {
      pending = p;
      notify(`結果を読み込みました。動画「${fileOf(p)}」を開くと当てます`, true);
      return;
    }
    const other = fileOf(p) !== videoBase(S.meta.video_file) ? `\n※ 読み込んだ結果は「${fileOf(p)}」の評価です（開いている動画は「${S.meta.video_file}」）。` : '';
    if (!confirm(`今の評価（方式・参加者 ID・値・評価区間）を，読み込んだ結果で置き換えます。よろしいですか？${other}`)) return;
    endStroke('import'); setArmed(false); pen.down = false;
    _.autosave();   // 置き換える前の評価を今のキーに残す
    const res = install(p);
    _.selectMode(S.meta.mode, true); _.syncRangeUI();
    _.seekTo(video.currentTime);   // 方式の操作面を読み込んだ値に追従させる
    _.refresh(); _.autosave();
    report(p, res);
  }

  // ---------- 実験モードのやり直し（core/experiment.js） ----------
  // zip か _session.json から _session.json の中身を読む（name に読んだファイルの名前）
  async function readSession(f) {
    const r = await readFiles([f]);
    if (!r.session) throw new Error(`${f.name} は _session.json でも実験モードの zip でもありません`);
    return r.session;
  }
  // 試行の _session.json を開いた動画に当てる（方式の設定・値・評価区間・形の記録・操作ログ）。動画は開いていること
  function installSession(s) {
    install({ session: s, csvs: [], names: [s.name || '_session.json'], mode: s.meta.mode });
    _.selectMode(S.meta.mode, true); _.syncRangeUI(); _.refresh();
  }

  $('importBtn').addEventListener('click', e => { e.currentTarget.blur(); $('importFile').click(); });
  $('importFile').addEventListener('change', e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) importFiles(fs); });

  Object.assign(_, { importFiles, takeImport, parseCSV, unzip, readSession, installSession });
})();
