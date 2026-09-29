// 声で値を入力する（Web Speech API。Chrome・Edge。Firefox 系は非対応）
// 「快度7」「覚醒度3」「快度7 覚醒度3」、または数字2つ「7 3」（快度・覚醒度の順）。1軸の方式では数字1つでも入る。
// 「再生」「停止」でも操作できる。値は話し始めた時刻（最初の途中結果が届いた時点の動画時刻）に入れる。
// 「12秒 快度7」「1分5秒 7 3」のように時刻を言うと、その時刻に入れる。時刻は評価区間の「列の表記」と同じ読み方
// （カウントダウン＝残り秒、経過＝評価区間の開始からの秒）。
(() => {
  const _ = AH._;
  const { $, video, S, addLog, pushUndo, snapshot, placePoint, binAt, nSec, clamp } = _;
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;

  // ---------- 聞き取った文の解釈（テストから直接呼べるよう純粋関数） ----------
  const KANJI = { '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  // 数字の読み。軸の語の直後に来たときだけ数字として読む（聞き間違えやすい同音の漢字も含める）
  const READ = { いち: 1, に: 2, さん: 3, よん: 4, し: 4, ご: 5, ろく: 6, なな: 7, しち: 7, はち: 8, きゅう: 9, く: 9,
    位置: 1, 市: 1, 壱: 1, 荷: 2, 参: 3, 酸: 3, 算: 3, 産: 3, 語: 5, 後: 5, 碁: 5, 誤: 5, 録: 6, 碌: 6,
    菜々: 7, 奈々: 7, 鉢: 8, 蜂: 8, 急: 9, 球: 9, 旧: 9, 級: 9, 救: 9 };
  // 聞き間違い辞書：Chrome の認識が化けやすい語を軸の語に読み替える（長いものから当てる）
  const ALIAS = [
    ['快度', ['街道', '海道', '開度', '会度', '回度', '解度', '改度', '界度', '階度', '海度', '甲斐度', '買い度', '貝度', '快ど', 'かいど', 'カイド', 'カイドー', '快適度']],
    ['覚醒度', ['学生', '拡声', '確性', '隔世', '核生', '革製', '格性', '各性', '角性', '覚せい', 'かくせい', 'カクセイ', '覚醒度',
      // 「かく・せいど」が2語に分かれた聞き間違い（実際のログ「25秒角 精度 7」から）
      '角精度', '確精度', '核精度', '各精度', '格精度', '画精度', '拡精度', '隔精度', '学精度', '覚精度', '覚醒 度', '精度']],
  ];
  const ALIAS_LIST = ALIAS.flatMap(([to, froms]) => froms.map(f => [f, to])).sort((x, y) => y[0].length - x[0].length);
  function unalias(s) {   // 長い語から順に読み替える（読み替え先がほかの語を含まないので順番に置き換えてよい）
    for (const [from, to] of ALIAS_LIST) s = s.split(from).join(to);
    return s;
  }
  const AXIS_V = /(快度|かいど|カイド|快|かい|valence|バレンス)/i;
  const AXIS_A = /(覚醒度|かくせいど|カクセイド|覚醒|かくせい|arousal|アローザル)/i;
  // 漢数字の並び（「十二」「二十三」「百五」など）を数にする
  function kanjiNum(k) {
    let total = 0, cur = 0;
    for (const c of k) {
      if (c === '百') { total += (cur || 1) * 100; cur = 0; }
      else if (c === '十') { total += (cur || 1) * 10; cur = 0; }
      else cur = cur * 10 + KANJI[c];
    }
    return total + cur;
  }
  function normalize(text) {
    // 数字以外どうしの間の空白を詰めてから読み替える（「角 精度」→「角精度」。「7 3」の空白は残す）
    return unalias(String(text).replace(/([^\s0-9０-９])[\s　]+(?=[^\s0-9０-９])/g, '$1'))
      .replace(/[０-９．]/g, c => (c === '．' ? '.' : String.fromCharCode(c.charCodeAt(0) - 0xFEE0)))
      .replace(/[〇零一二三四五六七八九十百]+/g, kanjiNum)
      .replace(/(?<![0-9])\.|\.(?![0-9])/g, ' ')   // 小数点以外の「.」は区切り
      .replace(/[、。,]/g, ' ');
  }
  // 「◯分◯秒」「◯秒」「◯分」を秒数にする。見つからなければ null
  const TIME_RE = /(?:([0-9]+)\s*分\s*)?([0-9]+(?:\.[0-9]+)?)\s*秒|([0-9]+)\s*分(?!\s*[0-9])/;
  function spokenTime(s) {
    const m = s.match(TIME_RE); if (!m) return null;
    const sec = m[3] != null ? +m[3] * 60 : (+(m[1] || 0)) * 60 + +m[2];
    return { sec, rest: s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length) };
  }
  // 数字として読める語（数字1文字、または読み仮名）を返す。1〜9 以外は null
  function num(tok) {
    const t = tok.trim();
    if (/^[1-9]$/.test(t)) return +t;
    if (t in READ) return READ[t];
    return null;
  }
  function parseVoice(text, { oneAxis = null } = {}) {
    let s = normalize(text);
    const out = {};
    const tm = spokenTime(s);
    if (tm) { out.time = tm.sec; s = tm.rest; }   // 時刻の部分は値の数字として数えない
    if (/(再生|さいせい|スタート)/.test(s)) out.cmd = 'play';
    else if (/(停止|ていし|ストップ|止めて|とめて)/.test(s)) out.cmd = 'pause';
    // 「軸の語＋数字」を順に拾う（軸の語は長いものから当てる）
    const re = new RegExp(`(${AXIS_A.source}|${AXIS_V.source})\\s*(は|が|を)?\\s*([1-9](?![0-9])|${Object.keys(READ).sort((x, y) => y.length - x.length).join('|')})`, 'gi');   // 長い読みを先に（「しち」を「し」と読まない）
    let m;
    while ((m = re.exec(s))) {
      const n = num(m[m.length - 1]); if (n == null) continue;
      if (AXIS_A.test(m[1])) out.a = n; else out.v = n;
    }
    if (out.v == null && out.a == null) {
      const ns = (s.match(/[0-9]+/g) || []).filter(x => /^[1-9]$/.test(x)).map(Number);   // 10 などの2桁は数えない
      if (ns.length === 2) { out.v = ns[0]; out.a = ns[1]; }
      else if (ns.length === 1 && oneAxis) out[oneAxis] = ns[0];
    }
    return out;
  }

  // ---------- 入力の反映 ----------
  function toast(msg, kind = 'ok') {
    const el = $('hint'); el.textContent = msg; el.hidden = false; el.classList.toggle('ok', kind === 'ok');
    clearTimeout(toast.tm); toast.tm = setTimeout(() => { el.hidden = true; el.classList.remove('ok'); }, 2500);
  }
  // 1軸だけを評価する状態か（CARMA・RankTrace の回、カスタムの1軸）
  function oneAxis() {
    const o = S.meta.options || {};
    if (o.axis && (_.M.id === 'carma' || _.M.id === 'ranktrace')) return o.axis;
    if (_.M.id === 'custom' && (o.dims === 'v' || o.dims === 'a')) return o.dims;
    return null;
  }
  // 言われた秒数（列の表記と同じ読み方）を動画の時刻にする
  function videoTimeOf(sec) {
    const r = _.RG();
    if (r.label === 'elapsed') return r.start + sec;
    const s = nSec() - 1 - Math.round(sec / r.bin);   // カウントダウン：残り sec 秒の区間
    return _.binStart(s);
  }
  // 聞き取りの履歴（「設定」パネルに最新10件を表示。聞き間違いの傾向を見るため）
  const hist = [];
  function showHist() {
    const el = $('voiceHist'); if (!el) return;
    el.innerHTML = hist.length ? hist.map(h => `<li><span class="time">${_.fmt(h.t)}</span> 「${h.text.replace(/</g, '&lt;')}」 → ${h.res}</li>`).join('') : '<li class="muted">まだありません</li>';
  }
  function applyVoice(p, t, text, alts = [text]) {
    const res = [p.time != null ? p.time + '秒' : '', p.v != null ? '快度' + p.v : '', p.a != null ? '覚醒度' + p.a : '', p.cmd || ''].filter(Boolean).join(' ') || '読めず';
    hist.unshift({ t, text, res }); hist.length = Math.min(hist.length, 10); showHist();
    const tHeard = t;
    if (p.time != null) t = videoTimeOf(p.time);
    const vals = {}; for (const ax of ['v', 'a']) if (p[ax] != null) vals[ax] = p[ax];
    const one = oneAxis(); if (one) for (const ax of Object.keys(vals)) if (ax !== one) delete vals[ax];
    const label = Object.entries(vals).map(([ax, v]) => (ax === 'v' ? '快度' : '覚醒度') + v).join(' ');
    // t_heard＝話し始めた動画時刻、t_target＝値を入れる動画時刻（時刻を言ったときはその時刻）
    addLog('voice_heard', { value: text, detail: JSON.stringify({ ...p, t_heard: +tHeard.toFixed(4), t_target: +t.toFixed(4), alts }) });
    if (p.time != null && (t < _.RG().start - 1e-6 || t >= _.rangeEnd() - 1e-6)) {
      toast(`「${p.time}秒」は評価区間の外です（声の入力）`, 'warn'); addLog('input_out_of_range', { detail: 'voice spoken=' + p.time }); return false;
    }
    if (p.cmd === 'play' && video.src && video.paused) video.play();
    if (p.cmd === 'pause' && !video.paused) video.pause();
    if (!Object.keys(vals).length) { if (!p.cmd) toast(`聞き取り：「${text}」（値として読めませんでした）`, 'warn'); return false; }
    const M = _.M;
    if (M.model === 'events' || M.unbounded) { toast('この方式では声による値の入力は使えません', 'warn'); return false; }
    if (M.model === 'table') {
      let s = binAt(t); if (s === nSec() && t >= (S.meta.duration || 0) - 0.05) s = nSec() - 1;
      if (s < 0 || s >= nSec()) { toast('評価区間の外です（声の入力）', 'warn'); addLog('input_out_of_range', { detail: 'voice t=' + t.toFixed(3) }); return false; }
      _.setCells(s, vals, 'voice');
    } else {
      const before = snapshot(); let ch = false;
      for (const [ax, v] of Object.entries(vals)) ch = placePoint(ax, +t.toFixed(4), v) || ch;
      if (ch) { pushUndo(before); addLog('voice_input', { axis: Object.keys(vals).join(''), value: Object.values(vals).join('/'), detail: 't=' + t.toFixed(4) }); }
      _.refresh();
    }
    toast(`聞き取り：${label}（${p.time != null ? `「${p.time}秒」→ 動画の ` : ''}${_.fmt(t)}）`);
    return true;
  }

  // ---------- 認識の開始・停止 ----------
  let rec = null, on = false;
  const heardAt = new Map();   // 結果の番号 → 話し始めの動画時刻
  function start() {
    if (!Rec) { toast('このブラウザは音声認識に対応していません（Chrome・Edge で使えます）', 'warn'); return; }
    rec = new Rec(); rec.lang = 'ja-JP'; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 5;
    // 認識の優先語（対応している Chrome のみ。対応していなければ何もしない）
    try { if (window.SpeechRecognitionPhrase && 'phrases' in rec) rec.phrases = ['快度', '覚醒度', '秒', '再生', '停止'].map(w => new window.SpeechRecognitionPhrase(w, 5)); } catch (_) {}
    heardAt.clear();
    rec.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (!heardAt.has(i)) heardAt.set(i, clamp(video.currentTime || 0, 0, S.meta.duration || 0));
        if (!r.isFinal) continue;
        // 候補のうち、値（またはコマンド）として読めた最初のものを使う
        const alts = Array.from({ length: r.length }, (_x, k) => r[k].transcript);
        const parsed = alts.map(a => parseVoice(a, { oneAxis: oneAxis() }));
        let k = parsed.findIndex(p => p.v != null || p.a != null);
        if (k < 0) k = parsed.findIndex(p => p.cmd); if (k < 0) k = 0;
        applyVoice(parsed[k], heardAt.get(i), alts[k], alts);
      }
    };
    rec.onerror = e => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      toast('音声認識のエラー：' + e.error + (e.error === 'not-allowed' ? '（マイクの使用を許可してください）' : e.error === 'network' ? '（ネット接続が必要です）' : ''), 'warn');
      addLog('voice_error', { value: e.error });
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setOn(false);
    };
    rec.onend = () => { if (on) setTimeout(() => { if (on) { heardAt.clear(); try { rec.start(); } catch (_) {} } }, 200); };   // 無音で止まったら再開
    try { rec.start(); } catch (_) {}
  }
  function setOn(v) {
    if (v === on) return;
    on = v;
    if (on) start(); else if (rec) { const r = rec; rec = null; try { r.stop(); } catch (_) {} }
    $('voiceBtn').classList.toggle('on', on); $('voiceBtn').textContent = on ? '● 音声' : '音声';
    addLog('voice', { value: on ? 'on' : 'off' });
  }
  $('voiceBtn').addEventListener('click', e => { e.currentTarget.blur(); setOn(!on); });
  if (!Rec) { $('voiceBtn').disabled = true; $('voiceBtn').title = 'このブラウザは音声認識に対応していません（Chrome・Edge で使えます）'; }

  showHist();
  Object.assign(_, { parseVoice, applyVoice, setVoice: setOn });
})();
