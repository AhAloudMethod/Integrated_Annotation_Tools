// 書き出し（CSV・JSON）
(() => {
  const _ = AH._;
  const { FPS, $, video, S, model, isInt, addLog, nSec, binStart, secLabel, valueAt, endStroke } = _;
  // ---------- 書き出し ----------
  const csvCell = x => { const s = String(x ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const toCSV = (header, rows) => [header.join(','), ...rows.map(r => r.map(csvCell).join(','))].join('\n');
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + text], { type }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  $('exportBtn').addEventListener('click', () => exportAll());
  // 今の評価を全部書き出す（「書き出す」）
  function exportAll() {
    const fs = buildFiles(); if (!fs) return;
    for (const f of fs) download(f.name, f.text, f.type);
    $('status').textContent = `書き出しました（${fs.length}ファイル）`;
  }
  // 書き出すファイルの一覧 [{ name, text, type }] を作る（実験モードは zip にまとめる）
  function buildFiles() {
    if (!video.src) return null;
    endStroke('export'); addLog('export');
    if (_.colorSnapshot) S.meta.colors = _.colorSnapshot();   // 書き出し時点の色の設定を記録する
    const X = S.meta.experiment, tag = X ? `_t${String(X.trial + 1).padStart(2, '0')}${X.practice ? 'p' : ''}` : '';   // 実験モードでは試行の番号（p は練習）を入れる
    const base = `${S.meta.participant || 'noid'}${tag}_${S.meta.video_file.replace(/\.[^.]+$/, '')}_${_.M.id}`;
    const D = S.meta.duration, N = Math.floor(D * FPS), n = nSec();
    const files = [];   // [{ name, text, type }]
    // 列名は評価の軸に合わせる（VA 以外は valence→pa・energy など）。回した軸（PANA・Thayer）は VA に直した値の列も付ける
    const AX = _.axSet(), rot = AX.rotated, colName = c => (/^va_/.test(c) ? c : String(c).replace('valence', AX.v.col).replace('arousal', AX.a.col));   // va_ で始まる列（VA に直した値）はそのまま
    const vaCols = (x, y) => { if (x === '' || y === '' || x == null || y == null) return ['', '']; const r = _.toVA(+x, +y); return [r.v.toFixed(3), r.a.toFixed(3)]; };
    const out = (suffix, header, rows) => files.push({ name: base + suffix, text: toCSV(header.map(colName), rows), type: 'text/csv' });
    S.meta.axes = _.axesCurrent();
    S.meta.gamepads = _.padMeta();   // ゲームパッドの設定・使った機器（core/gamepad.js）
    const binCols = s => [s, secLabel(s), binStart(s).toFixed(3), _.binEnd(s).toFixed(3)];
    const binHead = ['bin', 'label', 't_start', 't_end'];

    if (model() === 'series') {
      const smp = [];
      for (let k = 0; k <= N; k++) { const t = k / FPS, x = valueAt('v', t), y = valueAt('a', t); smp.push(rot ? [k, t.toFixed(4), x, y, ...vaCols(x, y)] : [k, t.toFixed(4), x, y]); }
      out('_60hz.csv', rot ? ['frame', 't', 'valence', 'arousal', 'va_valence', 'va_arousal'] : ['frame', 't', 'valence', 'arousal'], smp);
      // 区間系列。整数値の方式：各区間で最も長く続いた値（同数なら先）。連続値：各区間の平均（有界なら9段階丸めも）
      const rows = [];
      for (let s = 0; s < n; s++) {
        const k0 = Math.round(binStart(s) * FPS), k1 = Math.min(Math.round(_.binEnd(s) * FPS), N + 1);
        const ks = []; for (let k = k0; k < k1; k++) ks.push(k);
        const row = binCols(s);
        for (const ax of ['v', 'a']) {
          const xs = ks.map(k => valueAt(ax, k / FPS));
          if (!xs.length) { row.push(''); continue; }
          if (isInt()) {
            const cnt = new Map(), order = [];
            for (const v of xs) { if (!cnt.has(v)) order.push(v); cnt.set(v, (cnt.get(v) || 0) + 1); }
            let best = order[0]; for (const v of order) if (cnt.get(v) > cnt.get(best)) best = v;
            row.push(best);
          } else row.push((xs.reduce((p, c) => p + c, 0) / xs.length).toFixed(3));
        }
        if (!isInt() && !_.M.unbounded) row.push(row[4] === '' ? '' : Math.round(+row[4]), row[5] === '' ? '' : Math.round(+row[5]));
        if (rot && !_.M.unbounded) row.push(...vaCols(row[4], row[5]));
        rows.push(row);
      }
      const vaH = rot && !_.M.unbounded ? ['va_valence', 'va_arousal'] : [];
      out('_bins.csv', isInt() ? [...binHead, 'valence', 'arousal', ...vaH] : _.M.unbounded ? [...binHead, 'valence_mean', 'arousal_mean']
        : [...binHead, 'valence_mean', 'arousal_mean', 'valence_r9', 'arousal_r9', ...vaH], rows);
      const cps = [];
      for (const ax of ['v', 'a']) for (const p of S.data.points[ax]) cps.push([colName(ax === 'v' ? 'valence' : 'arousal'), p.t, p.val, p.init ? 1 : 0]);
      out('_changepoints.csv', ['axis', 't', 'value', 'initial'], cps);
      if (S.data.strokes.length) {
        const rs = []; for (const s of S.data.strokes) for (const [t, v, a] of s.samples) rs.push([s.id, s.source || 'input', s.axes, t, v, a]);
        out('_strokes.csv', ['stroke', 'source', 'axes', 't', 'valence', 'arousal'], rs);
      }
    } else if (model() === 'table') {
      out('_bins.csv', [...binHead, 'valence', 'arousal', ...(rot ? ['va_valence', 'va_arousal'] : [])],
        [...Array(n).keys()].map(s => { const x = S.data.cells.v[s] ?? '', y = S.data.cells.a[s] ?? ''; return [...binCols(s), x, y, ...(rot ? (x === 0 || y === 0 ? ['', ''] : vaCols(x, y)) : [])]; }));   // 0 は発声なし（VA に直さない）
    } else if (model() === 'events') {
      out('_ranks.csv', ['t', 'label', 'd_valence', 'd_arousal', 'source'], S.data.events.map(e => [e.t, e.label, e.dv, e.da, e.source || 'input']));
      const rows = [];
      for (let s = 0; s < n; s++) {
        const es = S.data.events.filter(e => e.t >= binStart(s) && e.t < _.binEnd(s));
        rows.push([...binCols(s), es.length, es.reduce((p, e) => p + e.dv, 0), es.reduce((p, e) => p + e.da, 0)]);
      }
      out('_bins.csv', [...binHead, 'n_changes', 'sum_d_valence', 'sum_d_arousal'], rows);
    }
    if (_.F0 && _.F0.status === 'ready') {   // 動画の音声の F0（10ms ごと。t は窓の中心、声なしは空欄）
      const F = _.F0, rows = [];
      for (let k = 0; k < F.f0.length; k++) rows.push([(k * F.hop + 0.02).toFixed(3), F.f0[k] > 0 ? F.f0[k].toFixed(1) : '', F.rms[k].toFixed(5)]);
      out('_f0.csv', ['t', 'f0_hz', 'rms'], rows);
    }
    // 聴いてから入力で評価したか（連続の方式：区間を聴いて止め、再生し直して記録。区間方式：区間を聴いて止め、値を入れて次へ）
    S.meta.listen = { on: _.listenUsable(), flow: model() === 'table' ? 'listen-pause-input' : 'listen-pause-replay-record' };
    S.meta.frame_rate = _.fpsMeta();   // 1フレーム移動に使ったフレームレート（source：default／auto／manual）
    S.meta.display = _.displayMeta();   // 区切りの線・スティックを四角に広げたか
    S.meta.f0 = { shown: !!(_.f0Shown && _.f0Shown()), method: 'YIN 16kHz win=40ms hop=10ms 70-1000Hz th=0.15' };
    out('_events.csv', ['wall_ms', 'video_t', 'type', 'axis', 'value', 'detail'], S.log.map(e => [e.wall_ms, e.video_t, e.type, e.axis, e.value, e.detail]));
    files.push({ name: base + '_session.json', text: JSON.stringify({ meta: S.meta, data: S.data, log: S.log }, null, 1), type: 'application/json' });
    return files;
  }

  Object.assign(_, { exportAll, buildFiles, download, toCSV });
})();
