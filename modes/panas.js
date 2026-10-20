// ---- PANAS（日本語版 16 項目・6 件法） ----
// 佐藤 徳・安田朝子 (2001) 日本語版 PANAS の作成．性格心理学研究, 9, 138-139．
// 項目文・段階の表記・採点は，作者の「尺度使用マニュアル」（https://jspp.gr.jp/doc/PANAS_manual.pdf）による．転載は著者の承諾が要る．
// 区間ごとに 16 項目すべてに 1〜6 で答え，PA（ポジティブ）8 項目の合計・NA（ネガティブ）8 項目の合計を出す．
// 項目ごとの回答は S.data.items[区間]（項目の番号順．声のない区間は 'novoice'＝発声なし，評価の対象外），書き出しは _panas.csv．区間の表（cells）には，ほかの方式と並べて見られるよう
// 項目の平均（1〜6）を 1〜9 に引き伸ばして四捨五入した値（v＝PA，a＝NA）を入れる（オプション to9．既定はオフで，オフなら入れない）．
(() => {
  const { S } = AH;
  const { h, secStrip, autoNext } = AH.ui;
  const ITEMS = [
    ['pa', '活気のある'], ['pa', '誇らしい'], ['pa', '強気な'], ['pa', 'きっぱりとした'], ['pa', '気合いの入った'], ['pa', 'わくわくした'], ['pa', '機敏な'], ['pa', '熱狂した'],
    ['na', 'びくびくした'], ['na', 'おびえた'], ['na', 'うろたえた'], ['na', '心配した'], ['na', 'ぴりぴりした'], ['na', '苦悩した'], ['na', '恥じた'], ['na', 'いらだった'],
  ].map(([f, text], i) => ({ i, id: f + ((i % 8) + 1), factor: f, text }));
  const LO = '全く当てはまらない', HI = '非常によく当てはまる';   // 1 と 6 だけに表記がある
  const ID = ITEMS.map(x => x.id);

  // 項目の並びは，参加者 ID を種にしたランダム順（マニュアルの「ランダム順に並べ替えて使用」）．同じ ID なら毎回同じ並び
  function shuffled(seed) {
    let a = 2166136261; for (const c of String(seed)) a = Math.imul(a ^ c.charCodeAt(0), 16777619) >>> 0;
    const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const o = ITEMS.map(x => x.i); for (let k = o.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [o[k], o[j]] = [o[j], o[k]]; }
    return o;
  }
  const order = () => {
    const seed = S.meta.participant || 'noid', m = S.meta.panas;
    if (!m || m.order_seed !== seed) S.meta.panas = { ...meta(), order_seed: seed, order: shuffled(seed) };
    return S.meta.panas.order;
  };
  const meta = () => ({ scale: '日本語版PANAS（佐藤・安田 2001）', points: 6, anchors: { 1: LO, 6: HI }, items: ITEMS.map(x => ({ id: x.id, text: x.text })) });
  // 区間の回答：項目の番号順の配列。声のない区間は 'novoice'（発声なし．Excel の 0 と同じく，評価の対象から外す）
  const raw = s => (S.data.items && S.data.items[s]);
  // 事前に印が付いた区間（実験モード。setup.json の novoice）は固定。判定は区間表モデルの共通部分（core/table.js）
  const locked = s => AH.novoiceLocked(s);
  const isNV = s => raw(s) === 'novoice' || locked(s);
  const row = s => (Array.isArray(raw(s)) ? raw(s) : []);
  const sums = r => {
    const out = { pa: 0, na: 0, n: 0 };
    for (const x of ITEMS) { const v = r[x.i]; if (v != null) { out[x.factor] += v; out.n++; } }
    return out;
  };
  const to9 = sum => Math.min(9, Math.max(1, Math.round(1 + (sum / 8 - 1) * 8 / 5)));   // 平均 1〜6 → 1〜9
  let box, list, head, topBar, nvBtn, rows = [], act = 0, lastAct = -1, lastSec = -1, strip, mounted = '';   // mounted：画面に出している項目の並び

  // 区間の値（cells）は項目の回答から決める。1〜9 化（to9）をオフにすると入れない（グラフ・帯・_bins.csv は空欄．合計は _panas.csv にある）
  function syncCells(s) {
    const t = sums(row(s)), on = !!S.meta.options.to9 && t.n === ITEMS.length, nv = isNV(s);
    const v = nv ? 0 : on ? to9(t.pa) : null, a = nv ? 0 : on ? to9(t.na) : null;   // 発声なしは，1〜9 化にかかわらず 0（他の方式の「発声なし」と同じ）
    if ((S.data.cells.v[s] ?? null) === v && (S.data.cells.a[s] ?? null) === a) return;
    S.data.cells.v[s] = v; S.data.cells.a[s] = a;
  }
  const syncAll = () => { for (let s = 0; s < AH.nSec(); s++) syncCells(s); };   // 取り消し・やり直しで値と設定がずれないよう，画面更新のたびに合わせる
  function setTo9(on) {
    if (AH.reviewing()) return;
    AH.setOption('to9', on);   // 設定なので取り消しの対象にしない。区間の値は update() が合わせる
  }
  function setItem(s, i, v) {
    if (AH.reviewing() || locked(s)) return;
    if (!S.data.items) S.data.items = [];
    const cur = row(s);
    if ((cur[i] ?? null) === (v ?? null)) return;
    AH.pushUndo();
    const was = sums(cur).n === ITEMS.length;
    const r = S.data.items[s] = Array.from({ length: ITEMS.length }, (_x, k) => cur[k] ?? null);
    r[i] = v;
    const done = !was && sums(r).n === ITEMS.length;   // 次の区間へ進むのは，最後の項目を埋めたときだけ（答え終えた区間の回答を直しても進まない）
    syncCells(s);
    AH.addLog('panas_item', { axis: ITEMS[i].id, value: v ?? '', detail: 'bin ' + s + ' (' + AH.secLabel(s) + ')' });
    AH.refresh();
    if (done) autoNext(s);
  }
  // 発声なし：声のない区間に印を付け、16 項目に答えずに次へ進む（もう一度押すと解除。項目に答えても解除）。印を付けると、その区間の回答は消える（Ctrl+Z で戻せる）
  function setNoVoice(s, on) {
    if (AH.reviewing() || locked(s) || isNV(s) === on) return;
    AH.pushUndo();
    if (!S.data.items) S.data.items = [];
    S.data.items[s] = on ? 'novoice' : null;
    syncCells(s);
    AH.addLog('panas_novoice', { value: on ? 1 : 0, detail: 'bin ' + s + ' (' + AH.secLabel(s) + ')' });
    AH.refresh();
    if (on) autoNext(s);
  }
  // 次に答える項目（表示の順で，今の項目より後の未回答，なければ先頭の未回答）
  function nextOpen(s, from) {
    const o = order(), r = row(s), n = o.length, k0 = Math.max(0, o.indexOf(from));
    for (let d = 1; d <= n; d++) { const i = o[(k0 + d) % n]; if (r[i] == null) return i; }
    return from;
  }
  const answer = (i, v) => { const s = AH.inputSec(); if (s == null) return; setItem(s, i, v); act = nextOpen(s, i); AH.refresh(); };

  AH.register({
    derivedCells: true,   // 区間の値は回答から作るので、声・グラフで直接は置けない（core/voice.js・core/timeline.js）
    axesOnly: 'pana',   // PA・NA の尺度なので，評価の軸の組にかかわらず PANA（core/axes.js）
    id: 'panas', group: '離散', label: 'PANAS（日本語版・16項目）', model: 'table', side: 'wide', init: { v: 5, a: 5 },
    options: { autoNext: false, to9: false },
    help: '<p>今の区間について、16 の気分の項目がどれだけ当てはまるかを 1〜6 で答えます（1＝全く当てはまらない、6＝非常によく当てはまる）。全項目に答えると区間の値が入ります（「合計を 1〜9 にしてグラフに出す」をオフにすると、区間の値は入れず、グラフには合計 8〜48 をそのまま描きます）。数字キー <kbd>1</kbd>〜<kbd>6</kbd> で今の項目に答えて次へ進み、<kbd>↑</kbd><kbd>↓</kbd> で項目を移り、<kbd>Backspace</kbd> で消します。声のない区間は <kbd>0</kbd>（または「発声なし」）で印を付け、答えずに次へ進みます（もう一度押すと解除）。評価の対象から外れます。</p>',
    mount({ panel, under }) {
      rows = []; lastSec = -1; lastAct = -1; mounted = order().join(',');
      box = h('div', { class: 'planeBox panas' });
      // 見出しと 1・6 の表記は上に固定する（右の列がスクロールしても見える）
      topBar = h('div', { class: 'pnTop' }); box.appendChild(topBar);
      head = h('div', { class: 'pnHead' }); topBar.appendChild(head);
      topBar.appendChild(h('div', { class: 'pnAnchor' }, `<span>1 ${LO}</span><span>6 ${HI}</span>`));
      list = h('div', { class: 'pnList' }); box.appendChild(list);
      const o = h('div', { class: 'opts' }); AH.ui.toggle(o, 'autoNext', '全項目に答えたら次の区間へ');
      const l = h('label', { class: 'optCtl', title: 'オフ：区間の値（グラフ・帯・_bins.csv）を入れない。PA・NA の合計と項目ごとの回答は _panas.csv に残る' }, '<input type="checkbox"> 合計を 1〜9 にしてグラフに出す'), cb = l.querySelector('input');
      cb.checked = !!S.meta.options.to9;
      cb.addEventListener('change', () => { setTo9(cb.checked); cb.blur(); });
      o.appendChild(l);
      nvBtn = h('button', { type: 'button', class: 'pnNv', title: '声のない区間：16 項目に答えず、評価の対象から外す（0 キー。もう一度押すと解除）', onclick: e => { const s = AH.inputSec(); if (s != null && !locked(s)) setNoVoice(s, !isNV(s)); e.currentTarget.blur(); } }, '発声なし<small>0</small>');
      o.appendChild(nvBtn); box.appendChild(o);
      for (const k of order()) {
        const it = ITEMS[k];
        const r = h('div', { class: 'pnRow ' + it.factor, 'data-i': k }, `<span class="pnName">${it.text}</span>`);
        const bs = h('div', { class: 'pnBtns' });
        for (let v = 1; v <= 6; v++) bs.appendChild(h('button', { type: 'button', 'data-v': v, onclick: e => { act = k; answer(k, v); e.currentTarget.blur(); } }, v));
        r.appendChild(bs); r.addEventListener('pointerdown', () => { act = k; });
        list.appendChild(r); rows[k] = r;
      }
      panel.appendChild(box); strip = secStrip(under);
    },
    onKey(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      const s = AH.inputSec(); if (s == null) return false;
      const m = /^(?:Digit|Numpad)([1-6])$/.exec(e.code);
      if (locked(s)) return /^(?:Digit|Numpad)[0-6]$|^Backspace$/.test(e.code);   // 事前に印が付いた区間は固定（キーは受け取るだけで何も変えない）
      if (m) { answer(act, +m[1]); return true; }
      if (e.code === 'Digit0' || e.code === 'Numpad0') { setNoVoice(s, !isNV(s)); return true; }
      if (e.code === 'Backspace') { if (isNV(s)) setNoVoice(s, false); else setItem(s, act, null); return true; }
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        const o = order(), k = o.indexOf(act) + (e.code === 'ArrowDown' ? 1 : -1);
        act = o[(k + o.length) % o.length]; AH.refresh(); return true;
      }
      return false;
    },
    update() {
      if (!box) return;
      if (mounted !== order().join(',')) { AH.remount(); return; }   // 参加者 ID が変わって並びが変わったら、画面を作り直す（画面の並びと記録する並び meta.panas.order を食い違わせない）
      syncAll();
      const s = AH.curSec(), r = row(s), t = sums(r), nv = isNV(s);
      if (s !== lastSec) { lastSec = s; act = nextOpen(s, order()[ITEMS.length - 1]); }
      const lk = locked(s);
      list.classList.toggle('nv', nv); list.classList.toggle('lock', lk); nvBtn.classList.toggle('on', nv); nvBtn.disabled = lk;
      head.innerHTML = nv ? `<b>区間 ${AH.secLabel(s)}</b>　<span class="pnSum">${lk ? '発声なし（事前設定。変更できません）' : '発声なし（評価の対象外）'}</span>` : `<b>区間 ${AH.secLabel(s)}</b>　<span>回答 ${t.n}/${ITEMS.length}</span>　<span class="pnSum">PA ${t.n === ITEMS.length ? t.pa : '–'}</span>　<span class="pnSum">NA ${t.n === ITEMS.length ? t.na : '–'}</span>`;
      rows.forEach((el, k) => {
        el.classList.toggle('act', k === act);
        for (const b of el.querySelectorAll('button')) b.classList.toggle('on', +b.dataset.v === r[k]);
      });
      // 今の項目が見える位置へ（項目か区間が変わったときだけ．スクロールしているのは一覧ではなく右の列なので scrollIntoView で上位の枠ごと動かす。手でスクロールした位置は変えない）
      if (act !== lastAct && rows[act]) { lastAct = act; rows[act].style.scrollMarginTop = (topBar.offsetHeight + 4) + 'px'; rows[act].scrollIntoView({ block: 'nearest' }); }   // 上に固定した見出しの下に隠れないよう余白を取る
      if (strip) strip();
    },
    // 評価グラフ（core/timeline.js）と区間の帯（modes/_shared.js の secStrip）：1〜9 化をオフにしたときは，PA・NA の合計（8〜48）をそのまま描く
    graphScale() { return !S.meta.options.to9 ? { lo: 8, hi: 48, mid: 28, tag: '（合計）' } : null; },
    graphCell(ax, s) {
      if (isNV(s)) return 0;   // 発声なし：グラフでは灰色の帯、帯の表示は 0
      if (S.meta.options.to9) return S.data.cells[ax][s];
      const t = sums(row(s)); return t.n === ITEMS.length ? t[ax === 'v' ? 'pa' : 'na'] : null;
    },
    // 実験モードの要約（core/experiment.js）の filled_v・filled_a：1〜9 化がオフでも、全項目に答えた区間の数を数える
    filledCount() { let n = 0; for (let s = 0; s < AH.nSec(); s++) if (isNV(s) || sums(row(s)).n === ITEMS.length) n++; return n; },   // 発声なしの印も「入れた区間」に数える（Excel の 0 と同じ）
    // 書き出し（core/export.js）：項目ごとの回答と PA・NA の合計
    extraCsv() {
      const n = AH.nSec(), rowsOut = [];
      for (let s = 0; s < n; s++) {
        const r = row(s), t = sums(r), done = t.n === ITEMS.length;
        rowsOut.push([s, AH.secLabel(s), AH.binStart(s).toFixed(3), AH.binEnd(s).toFixed(3), ...ITEMS.map(x => r[x.i] ?? ''), t.n, done ? t.pa : '', done ? t.na : '', isNV(s) ? 1 : 0, locked(s) ? 1 : 0]);
      }
      order();
      return [{ suffix: '_panas.csv', header: ['bin', 'label', 't_start', 't_end', ...ID, 'n_answered', 'pa_sum', 'na_sum', 'no_voice', 'no_voice_preset'], rows: rowsOut }];
    },
  });
})();
