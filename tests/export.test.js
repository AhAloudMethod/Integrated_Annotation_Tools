// 書き出しの中身：既知の変化点・区間の値・変化の入力から期待値を手で計算し、書き出したファイルと照合する
const fs = require('fs');
const { chromium } = require('playwright-core');
const { URL, VID, BROWSER } = require('./_env');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);

// CSV を読む（"…" の中の , " 改行を扱う）
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  row.push(cell); rows.push(row);
  return rows;
}
// 変化点から t の値を引く（直前の変化点の値＝階段状）
const stepAt = (ps, t) => { let v = ps[0].val; for (const p of ps) if (p.t <= t + 1e-9) v = p.val; return v; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true });
  const open = async (mode, axes) => {
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss());   // 前のケースの自動保存は復元せず、新しく始める
    await p.addInitScript(a => {
      for (const k of Object.keys(localStorage)) if (k.startsWith('ahann_range')) localStorage.removeItem(k);   // 前のテストの評価区間を持ち越さない
      if (a) localStorage.setItem('ahann_axes', a); else localStorage.removeItem('ahann_axes');
      localStorage.setItem('ahann_voice_engine', 'webspeech');
    }, axes || '');
    await p.goto(URL); await p.selectOption('#mode', mode); await p.setInputFiles('#file', VID);
    await p.waitForFunction(() => AH.S.meta.duration > 0); await p.waitForTimeout(150);
    return p;
  };
  // 書き出して、ファイル名の末尾 → { raw（BOM 付きの生の文字列）, rows（CSV の行） } を返す
  const exportAll = async p => {
    const dls = []; p.on('download', d => dls.push(d));
    await p.click('#exportBtn'); await p.waitForTimeout(1500);
    const files = {};
    for (const d of dls) {
      const suf = d.suggestedFilename().match(/_[a-z0-9]+\.(csv|json)$/)[0];
      const raw = fs.readFileSync(await d.path(), 'utf8');
      files[suf] = { name: d.suggestedFilename(), raw, rows: suf.endsWith('.csv') ? parseCSV(raw.replace(/^﻿/, '')) : null };
    }
    return files;
  };
  const setRange = (p, r) => p.evaluate(r => AH._.setRange(r), r);

  // 1. 整数値の連続方式（テンキー）：_60hz・_bins（最も長く続いた値、同数なら先）・_changepoints・_strokes・_events・_session
  {
    const p = await open('key');
    await setRange(p, { start: 0, bin: 2, count: 3, target: 6, label: 'countdown' });
    const pts = {
      v: [{ t: 0, val: 5, init: true }, { t: 0.5, val: 7 }, { t: 1.5, val: 3 }, { t: 3, val: 8 }],
      a: [{ t: 0, val: 5, init: true }, { t: 5, val: 2 }],
    };
    const strokes = [
      { id: 0, source: 'input', axes: 'v', samples: [[0.5, 7, ''], [1.5, 3, '']] },
      { id: 1, axes: 'a', samples: [[5, '', 2]] },   // source が無い古い記録は input
    ];
    await p.evaluate(([pts, strokes]) => { AH.S.data.points = pts; AH.S.data.strokes = strokes; AH._.addLog('note', { detail: 'a,"b"\nc' }); }, [pts, strokes]);
    const D = await p.evaluate(() => AH.S.meta.duration);
    const f = await exportAll(p);

    // _60hz.csv：frame は 0〜floor(D×60)、t は小数 4 桁、値は直前の変化点の値
    const N = Math.floor(D * 60), hz = f['_60hz.csv'].rows;
    const want = [['frame', 't', 'valence', 'arousal']];
    for (let k = 0; k <= N; k++) want.push([String(k), (k / 60).toFixed(4), String(stepAt(pts.v, k / 60)), String(stepAt(pts.a, k / 60))]);
    check('_60hz.csv：行数は floor(長さ×60)+1', hz.length === N + 2, `rows=${hz.length - 1} N=${N}`);
    check('_60hz.csv：全行が変化点の階段状の値', same(hz, want), JSON.stringify(hz.find((r, i) => !same(r, want[i]))));
    check('_60hz.csv：変化点の時刻ちょうどのフレームから新しい値', same(hz[1 + 29].slice(2), ['5', '5']) && same(hz[1 + 30].slice(2), ['7', '5']) && same(hz[1 + 180].slice(2), ['8', '5']));

    // _bins.csv：区間 0〜2（5 が 30・7 が 60・3 が 30 フレーム → 7）、2〜4（3 と 8 が 60 ずつ → 先の 3）、4〜6（快度 8、覚醒度は 5 と 2 が 60 ずつ → 先の 5）
    check('_bins.csv（整数値）：最も長く続いた値、同数なら先に現れた値', same(f['_bins.csv'].rows, [
      ['bin', 'label', 't_start', 't_end', 'valence', 'arousal'],
      ['0', '0:04', '0.000', '2.000', '7', '5'],
      ['1', '0:02', '2.000', '4.000', '3', '5'],
      ['2', '0:00', '4.000', '6.000', '8', '5'],
    ]), JSON.stringify(f['_bins.csv'].rows));

    check('_changepoints.csv：軸・時刻・値と初期値の印', same(f['_changepoints.csv'].rows, [
      ['axis', 't', 'value', 'initial'],
      ['valence', '0', '5', '1'], ['valence', '0.5', '7', '0'], ['valence', '1.5', '3', '0'], ['valence', '3', '8', '0'],
      ['arousal', '0', '5', '1'], ['arousal', '5', '2', '0'],
    ]), JSON.stringify(f['_changepoints.csv'].rows));

    check('_strokes.csv：書き込みの番号・入れ方・軸、書き込んでいない軸は空欄', same(f['_strokes.csv'].rows, [
      ['stroke', 'source', 'axes', 't', 'valence', 'arousal'],
      ['0', 'input', 'v', '0.5', '7', ''], ['0', 'input', 'v', '1.5', '3', ''],
      ['1', 'input', 'a', '5', '', '2'],
    ]), JSON.stringify(f['_strokes.csv'].rows));

    // _events.csv と _session.json の log は同じ内容。, " 改行を含む値はエスケープして 1 セルに収める
    const ses = JSON.parse(f['_session.json'].raw.replace(/^﻿/, ''));
    const ev = f['_events.csv'].rows;
    const evWant = [['wall_ms', 'video_t', 'type', 'axis', 'value', 'detail'], ...ses.log.map(e => [e.wall_ms, e.video_t, e.type, e.axis, e.value, e.detail].map(x => String(x ?? '')))];
    check('_events.csv：列と、_session.json の log と同じ行', same(ev, evWant), `rows=${ev.length - 1} log=${ses.log.length}`);
    check('_events.csv：最後の行は export', ev[ev.length - 1][2] === 'export', ev[ev.length - 1].join());
    const note = ev.find(r => r[2] === 'note');
    check('CSV のエスケープ：, " 改行を含む値を 1 セルとして読み戻せる', !!note && note[5] === 'a,"b"\nc' && /"a,""b""\nc"/.test(f['_events.csv'].raw), JSON.stringify(note));
    check('CSV は BOM 付きの UTF-8（Excel で文字化けしない）', Object.entries(f).filter(([k]) => k.endsWith('.csv')).every(([, x]) => x.raw.startsWith('﻿')));

    check('_session.json：data の変化点と書き込みがそのまま残る', same(ses.data.points, pts) && same(ses.data.strokes, strokes), JSON.stringify(ses.data.points));
    check('_session.json：meta の評価区間・方式・フレームレート', ses.meta.range && ses.meta.range.bin === 2 && ses.meta.range.count === 3 && ses.meta.duration === D && ses.meta.frame_rate && ses.meta.axes === 'va',
      JSON.stringify({ range: ses.meta.range, axes: ses.meta.axes }));
    check('ファイル名は 参加者ID_動画名_方式', f['_bins.csv'].name === 'noid_test_key_bins.csv', f['_bins.csv'].name);
    await p.close();
  }

  // 2. 書き込みが無いときは _strokes.csv を出さない
  {
    const p = await open('key');
    const f = await exportAll(p);
    check('書き込みが無ければ _strokes.csv は出さない', !f['_strokes.csv'] && !!f['_60hz.csv'], Object.keys(f).join(' '));
    await p.close();
  }

  // 3. 連続値・上下限あり（FEELTRACE）：区間の平均（小数 3 桁）と 9 段階への丸め。列の表記はカウントアップ
  {
    const p = await open('feeltrace');
    await setRange(p, { start: 0, bin: 2, count: 3, target: 6, label: 'elapsed' });
    const pts = {
      v: [{ t: 0, val: 5, init: true }, { t: 1, val: 6.5 }, { t: 4.5, val: 2.2 }],
      a: [{ t: 0, val: 5, init: true }, { t: 3, val: 8 }],
    };
    await p.evaluate(pts => { AH.S.data.points = pts; }, pts);
    const f = await exportAll(p), bins = f['_bins.csv'].rows;
    // 期待値：各区間のフレーム（区間の始め〜終わりの手前）の値の平均
    const mean = (ax, a, b) => { const xs = []; for (let k = Math.round(a * 60); k < Math.round(b * 60); k++) xs.push(stepAt(pts[ax], k / 60)); return xs.reduce((p, c) => p + c, 0) / xs.length; };
    const want = [['bin', 'label', 't_start', 't_end', 'valence_mean', 'arousal_mean', 'valence_r9', 'arousal_r9']];
    [[0, 2], [2, 4], [4, 6]].forEach(([a, b], s) => {
      const mv = mean('v', a, b).toFixed(3), ma = mean('a', a, b).toFixed(3);
      want.push([String(s), ['0:00', '0:02', '0:04'][s], a.toFixed(3), b.toFixed(3), mv, ma, String(Math.round(+mv)), String(Math.round(+ma))]);
    });
    check('_bins.csv（連続値）：平均と 9 段階への丸め', same(bins, want), JSON.stringify(bins));
    check('_bins.csv（連続値）：区間 0〜2 は (5×60＋6.5×60)/120＝5.750 → 6、区間 2〜4 の 6.500 は 7 に上げる', same(bins[1].slice(4), ['5.750', '5.000', '6', '5']) && same(bins[2].slice(4, 8), ['6.500', '6.500', '7', '7']), JSON.stringify(bins.slice(1, 3)));
    await p.close();
  }

  // 4. 連続値・上下限なし（RankTrace）：平均だけ（丸めの列なし）。回した軸でも _bins に VA の列は付かず、_60hz には付く
  {
    const p = await open('ranktrace');
    await setRange(p, { start: 0, bin: 2, count: 2, target: 4, label: 'countdown' });
    await p.evaluate(() => { AH.S.data.points = { v: [{ t: 0, val: 0, init: true }, { t: 1, val: -3 }], a: [{ t: 0, val: 0, init: true }] }; });
    const f = await exportAll(p);
    check('_bins.csv（上下限なし）：平均だけ', same(f['_bins.csv'].rows, [
      ['bin', 'label', 't_start', 't_end', 'valence_mean', 'arousal_mean'],
      ['0', '0:02', '0.000', '2.000', '-1.500', '0.000'],
      ['1', '0:00', '2.000', '4.000', '-3.000', '0.000'],
    ]), JSON.stringify(f['_bins.csv'].rows));
    await p.close();

    const q = await open('ranktrace', 'pana');
    await setRange(q, { start: 0, bin: 2, count: 2, target: 4, label: 'countdown' });
    const g = await exportAll(q);
    check('上下限なし×PANA：_bins.csv に VA に直した列は付かない', same(g['_bins.csv'].rows[0], ['bin', 'label', 't_start', 't_end', 'pa_mean', 'na_mean']), g['_bins.csv'].rows[0].join());
    check('上下限なし×PANA：_60hz.csv には VA に直した列が付く', same(g['_60hz.csv'].rows[0], ['frame', 't', 'pa', 'na', 'va_valence', 'va_arousal']), g['_60hz.csv'].rows[0].join());
    await q.close();
  }

  // 5. 区間方式（Excel）：入力値、未入力は空欄。連続方式のファイルは出さない
  {
    const p = await open('excel');
    await setRange(p, { start: 0, bin: 1, count: 3, target: 3, label: 'countdown' });
    await p.evaluate(() => { AH.S.data.cells = { v: [7, undefined, 3], a: [2] }; });
    const f = await exportAll(p);
    check('_bins.csv（区間方式）：入力値、未入力は空欄', same(f['_bins.csv'].rows, [
      ['bin', 'label', 't_start', 't_end', 'valence', 'arousal'],
      ['0', '0:02', '0.000', '1.000', '7', '2'],
      ['1', '0:01', '1.000', '2.000', '', ''],
      ['2', '0:00', '2.000', '3.000', '3', ''],
    ]), JSON.stringify(f['_bins.csv'].rows));
    check('区間方式は _60hz・_changepoints・_strokes・_ranks を出さない', ['_60hz.csv', '_changepoints.csv', '_strokes.csv', '_ranks.csv'].every(k => !f[k]) && !!f['_events.csv'] && !!f['_session.json'], Object.keys(f).join(' '));
    await p.close();

    // PANA：VA に直した列。片方の軸が未入力なら空欄
    const q = await open('excel', 'pana');
    await setRange(q, { start: 0, bin: 1, count: 3, target: 3, label: 'countdown' });
    await q.evaluate(() => { AH.S.data.cells = { v: [9, 5, 0], a: [1, undefined, 0] }; });
    const g = await exportAll(q);
    check('区間方式×PANA：VA に直した値、片方が未入力か 0（発声なし）なら空欄', same(g['_bins.csv'].rows, [
      ['bin', 'label', 't_start', 't_end', 'pa', 'na', 'va_valence', 'va_arousal'],
      ['0', '0:02', '0.000', '1.000', '9', '1', '10.657', '5.000'],
      ['1', '0:01', '1.000', '2.000', '5', '', '', ''],
      ['2', '0:00', '2.000', '3.000', '0', '0', '', ''],
    ]), JSON.stringify(g['_bins.csv'].rows));
    await q.close();
  }

  // 6. AffectRank：_ranks.csv と、区間ごとの変化の回数と方向の合計（区間の始めちょうどはその区間、終わりちょうどは次の区間）
  {
    const p = await open('affectrank');
    await setRange(p, { start: 0, bin: 2, count: 2, target: 4, label: 'countdown' });
    const events = [
      { t: 0.5, label: 'up', dv: 0, da: 1, source: 'gamepad' },
      { t: 1.2, label: 'down-left', dv: -1, da: -1 },
      { t: 2, label: 'right', dv: 1, da: 0 },
      { t: 3.9, label: 'up-right', dv: 1, da: 1 },
      { t: 4, label: 'left', dv: -1, da: 0 },   // 評価区間の終わりちょうど：どの区間にも入らない
    ];
    await p.evaluate(ev => { AH.S.data.events = ev; }, events);
    const f = await exportAll(p);
    check('_ranks.csv：時刻・方向の名前・方向・入れ方（無いときは input）', same(f['_ranks.csv'].rows, [
      ['t', 'label', 'd_valence', 'd_arousal', 'source'],
      ['0.5', 'up', '0', '1', 'gamepad'], ['1.2', 'down-left', '-1', '-1', 'input'], ['2', 'right', '1', '0', 'input'],
      ['3.9', 'up-right', '1', '1', 'input'], ['4', 'left', '-1', '0', 'input'],
    ]), JSON.stringify(f['_ranks.csv'].rows));
    check('_bins.csv（変化の入力）：区間ごとの回数と方向の合計', same(f['_bins.csv'].rows, [
      ['bin', 'label', 't_start', 't_end', 'n_changes', 'sum_d_valence', 'sum_d_arousal'],
      ['0', '0:02', '0.000', '2.000', '2', '-1', '0'],
      ['1', '0:00', '2.000', '4.000', '2', '2', '1'],
    ]), JSON.stringify(f['_bins.csv'].rows));
    await p.close();
  }

  console.log('errors:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
