// 声で値を入力する。認識エンジンは「Chrome の音声認識」（Web Speech API。Chrome・Edge）か「Vosk」（PC の中で認識。Chrome・Firefox）
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
      // 「秒」「分」の前の読み仮名の数字（Vosk は「さん 秒」のように出す）。直前が「二十」などの十の位なら足す（「二 十 よん 秒」→ 24秒）
      .replace(/([1-9]0)?(きゅう|いち|さん|よん|ろく|なな|しち|はち|じゅう|に|し|ご|く)(?=\s*[秒分])/g, (_m, tens, w) => String((+tens || 0) + { いち: 1, に: 2, さん: 3, よん: 4, し: 4, ご: 5, ろく: 6, なな: 7, しち: 7, はち: 8, きゅう: 9, く: 9, じゅう: 10 }[w]))
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
    else if (/[秒]/.test(s)) out.timeMissing = true;   // 「秒」は聞こえたが数字が聞き取れなかった（値を入れない）
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
    if (p.timeMissing && Object.keys(vals).length) {   // 時刻を言ったのに数字が落ちた：話し始めの時刻に入れると間違った位置に入るので入れない
      toast(`「${text.trim()}」：時刻が聞き取れませんでした。もう一度言ってください（値は入れていません）`, 'warn');
      addLog('voice_time_missing', { detail: text }); return false;
    }
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

  // ---------- 認識エンジン ----------
  // 「Chrome の音声認識」（Web Speech API。Chrome・Edge。サーバーで認識）と「Vosk」（PC の中で認識。Chrome・Firefox）。
  // どちらも「話し始め」（partial）と「確定」（final：候補の配列）を知らせ、解釈と反映は共通（parseVoice・applyVoice）。
  let on = false, eng = null;
  let engineId = 'webspeech';
  try { engineId = localStorage.getItem('ahann_voice_engine') || (Rec ? 'webspeech' : 'vosk'); } catch (_) {}
  if (!Rec && engineId === 'webspeech') engineId = 'vosk';
  let restrict = true;   // Vosk：聞き取る語を限定する
  try { restrict = localStorage.getItem('ahann_voice_restrict') !== '0'; } catch (_) {}
  let heardT = null;     // 話し始めの動画時刻（確定したら消す）
  const nowT = () => clamp(video.currentTime || 0, 0, S.meta.duration || 0);
  function partial() { if (heardT == null) heardT = nowT(); }
  function final(alts) {
    const t = heardT ?? nowT(); heardT = null;
    alts = alts.filter(a => a != null && String(a).trim() !== '');
    if (!alts.length) return;
    // 候補のうち、値（またはコマンド）として読めた最初のものを使う
    const parsed = alts.map(a => parseVoice(a, { oneAxis: oneAxis() }));
    let k = parsed.findIndex(p => p.v != null || p.a != null);
    if (k < 0) k = parsed.findIndex(p => p.cmd); if (k < 0) k = 0;
    applyVoice(parsed[k], t, alts[k], alts);
  }
  function fail(msg, code, stop) {
    toast(msg, 'warn'); addLog('voice_error', { value: code, detail: engineId });
    if (stop) setOn(false);
  }

  // ---- Chrome の音声認識（Web Speech API） ----
  function webspeech() {
    if (!Rec) { toast('このブラウザは Chrome の音声認識に対応していません（「設定」で Vosk を選んでください）', 'warn'); return null; }
    const rec = new Rec(); rec.lang = 'ja-JP'; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 5;
    // 認識の優先語（対応している Chrome のみ。対応していなければ何もしない）
    try { if (window.SpeechRecognitionPhrase && 'phrases' in rec) rec.phrases = ['快度', '覚醒度', '秒', '再生', '停止'].map(w => new window.SpeechRecognitionPhrase(w, 5)); } catch (_) {}
    let alive = true;
    rec.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        partial();
        if (r.isFinal) final(Array.from({ length: r.length }, (_x, k) => r[k].transcript));
      }
    };
    rec.onerror = e => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      fail('音声認識のエラー：' + e.error + (e.error === 'not-allowed' ? '（マイクの使用を許可してください）' : e.error === 'network' ? '（ネット接続が必要です）' : ''), e.error,
        e.error === 'not-allowed' || e.error === 'service-not-allowed');
    };
    rec.onend = () => { if (alive) setTimeout(() => { if (alive) try { rec.start(); } catch (_) {} }, 200); };   // 無音で止まったら再開
    try { rec.start(); } catch (_) {}
    return { stop() { alive = false; try { rec.stop(); } catch (_) {} } };
  }

  // ---- Vosk（vendor/vosk.js。モデルは初回に選んでブラウザに保存） ----
  // 聞き取る語を限定するときの語の一覧（モデルの単語に合わせる）。[unk] はそれ以外の語
  // 数は 1〜99 を1語として入れる（モデルは「二十四」「十二」を1語で持つ。十の位と一の位に分けると「二 十 よん」と崩れる）
  const KD = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const kanji = n => (n < 10 ? KD[n - 1] : (n >= 20 ? KD[Math.floor(n / 10) - 1] : '') + '十' + (n % 10 ? KD[n % 10 - 1] : ''));
  const VOSK_WORDS = ['快', '覚醒',   // 「快度」「覚醒度」はモデルの単語にないので「快＋度」「覚醒＋度」で聞き取る
    '度', '秒', '分', '再生', '停止',
    ...Array.from({ length: 99 }, (_x, i) => kanji(i + 1)), 'いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう', 'じゅう'];
  const grammar = () => JSON.stringify([...VOSK_WORDS, '[unk]']);
  let voskLib = null;
  function loadVoskLib() {
    if (window.Vosk) return Promise.resolve(window.Vosk);
    if (voskLib) return voskLib;
    voskLib = new Promise((res, rej) => {
      const sc = document.createElement('script'); sc.src = 'vendor/vosk.js';
      sc.onload = () => (window.Vosk ? res(window.Vosk) : rej(new Error('vosk.js を読み込めませんでした')));
      sc.onerror = () => { voskLib = null; rej(new Error('vendor/vosk.js が見つかりません')); };
      document.head.appendChild(sc);
    });
    return voskLib;
  }
  // モデルの保存（IndexedDB）。保存できない環境では、ページを開くたびに選び直す
  const DB = 'ahann_vosk', STORE = 'model';
  function idb() {
    return new Promise((res, rej) => {
      try {
        const q = indexedDB.open(DB, 1);
        q.onupgradeneeded = () => q.result.createObjectStore(STORE);
        q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
      } catch (e) { rej(e); }
    });
  }
  async function idbGet() {
    try { const db = await idb(); return await new Promise(r => { const q = db.transaction(STORE).objectStore(STORE).get('model'); q.onsuccess = () => r(q.result || null); q.onerror = () => r(null); }); }
    catch (_) { return null; }
  }
  async function idbPut(v) {
    try { const db = await idb(); await new Promise((r, j) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(v, 'model'); tx.oncomplete = r; tx.onerror = () => j(tx.error); }); return true; }
    catch (_) { return false; }
  }
  async function idbDel() {
    try { const db = await idb(); await new Promise(r => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete('model'); tx.oncomplete = r; tx.onerror = r; }); } catch (_) {}
  }
  let modelFile = null;   // { name, size, blob }
  let voskModel = null, voskModelFor = null, voskLoading = null;
  const mb = n => (n / 1e6).toFixed(0) + 'MB';
  function modelStatus(text) { const el = $('voskModelStatus'); if (el) el.textContent = text; }
  async function refreshModelStatus() {
    if (!modelFile) modelFile = await idbGet();
    modelStatus(modelFile ? `モデル：${modelFile.name}（${mb(modelFile.size)}、ブラウザに保存済み）` : 'モデル：未設定（「モデルを選ぶ」から .tar.gz を選んでください）');
  }
  function dropModel() { if (voskModel) { try { voskModel.terminate(); } catch (_) {} } voskModel = null; voskModelFor = null; voskLoading = null; }
  async function setModelFile(f) {
    modelFile = { name: f.name, size: f.size, blob: f };
    const saved = await idbPut({ name: f.name, size: f.size, blob: f });
    dropModel();
    addLog('voice_model', { value: f.name, detail: `size=${f.size} saved=${saved}` });
    modelStatus(`モデル：${f.name}（${mb(f.size)}、${saved ? 'ブラウザに保存済み' : 'このページを開いている間だけ'}）`);
  }
  async function getVoskModel() {
    if (voskModel && voskModelFor === modelFile) return voskModel;
    if (voskLoading) return voskLoading;
    voskLoading = (async () => {
      const V = await loadVoskLib();
      toast('Vosk のモデルを読み込み中…（数十秒かかることがあります）');
      try {
        // file:// で開いたページでは worker が blob: を読めないので、モデルの中身をメッセージで渡す（vendor/vosk.js の修正と対）
        const m = new V.Model('ah-model:' + modelFile.name, -1);
        const buf = await modelFile.blob.arrayBuffer();
        m.postMessage({ action: 'ah-model', buffer: buf }, [buf]);
        await new Promise((res, rej) => {
          const tm = setTimeout(() => rej(new Error('時間内に読み込めませんでした')), 180000);
          m.on('load', msg => { clearTimeout(tm); msg && msg.result ? res() : rej(new Error('モデルの形式が違う可能性があります')); });
          m.on('error', msg => { clearTimeout(tm); rej(new Error((msg && msg.error) || '読み込みエラー')); });
        });
        voskModel = m; voskModelFor = modelFile; return m;
      } finally { voskLoading = null; }
    })();
    return voskLoading;
  }
  function vosk() {
    let alive = true, ctx = null, stream = null, node = null, recog = null;
    (async () => {
      if (!modelFile) modelFile = await idbGet();
      if (!modelFile) { fail('Vosk のモデルが未設定です。「設定」の「モデルを選ぶ」で .tar.gz を選んでください', 'no-model', true); return; }
      let model;
      try { model = await getVoskModel(); } catch (e) { fail('Vosk のモデルを読み込めませんでした：' + (e && e.message || e), 'model-load', true); return; }
      if (!alive) return;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }, video: false }); }
      catch (e) { fail('マイクを使えませんでした（マイクの使用を許可してください）：' + e.message, 'not-allowed', true); return; }
      if (!alive) { stream.getTracks().forEach(t => t.stop()); return; }
      // モデルの標準（16kHz）で処理する。対応しないブラウザ（異なる標本化周波数をつなげない Firefox など）は機器の周波数のまま
      let src;
      try { ctx = new AudioContext({ sampleRate: 16000 }); src = ctx.createMediaStreamSource(stream); }
      catch (_) { try { ctx && ctx.close(); } catch (_e) {} ctx = new AudioContext(); src = ctx.createMediaStreamSource(stream); }
      recog = restrict ? new model.KaldiRecognizer(ctx.sampleRate, grammar()) : new model.KaldiRecognizer(ctx.sampleRate);
      recog.on('partialresult', m => { if (m && m.result && m.result.partial && m.result.partial.replace(/\[unk\]/g, '').trim()) partial(); });
      recog.on('result', m => {
        const t = ((m && m.result && m.result.text) || '').replace(/\[unk\]/g, ' ');
        if (t.trim()) final([t]); else heardT = null;
      });
      node = ctx.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = e => { if (alive) try { recog.acceptWaveform(e.inputBuffer); } catch (_) {} };
      src.connect(node); node.connect(ctx.destination);
      addLog('voice_ready', { detail: `vosk sr=${ctx.sampleRate} ${restrict ? 'restrict' : 'free'}` });
      toast('Vosk：聞き取りを始めました' + (restrict ? '（語を限定）' : ''));
    })();
    return {
      stop() {
        alive = false;
        try { node && node.disconnect(); } catch (_) {}
        try { stream && stream.getTracks().forEach(t => t.stop()); } catch (_) {}
        try { ctx && ctx.close(); } catch (_) {}
        try { recog && recog.remove && recog.remove(); } catch (_) {}
      },
    };
  }

  // ---------- オン／オフと設定欄 ----------
  function setOn(v) {
    if (v === on) return;
    on = v; heardT = null;
    if (on) { eng = engineId === 'vosk' ? vosk() : webspeech(); if (!eng) on = false; }
    else if (eng) { const e = eng; eng = null; e.stop(); }
    $('voiceBtn').classList.toggle('on', on); $('voiceBtn').textContent = on ? '● 音声' : '音声';
    addLog('voice', { value: on ? 'on' : 'off', detail: engineId + (engineId === 'vosk' ? (restrict ? ' restrict' : ' free') : '') });
  }
  function setEngine(id) {
    if (id === engineId) return;
    const was = on; if (was) setOn(false);
    engineId = id; try { localStorage.setItem('ahann_voice_engine', id); } catch (_) {}
    addLog('voice_engine', { value: id }); syncVoiceUI();
    if (was) setOn(true);
  }
  function syncVoiceUI() {
    $('voiceEngine').value = engineId;
    $('voiceEngine').querySelector('option[value=webspeech]').disabled = !Rec;
    $('voskBox').hidden = engineId !== 'vosk';
    $('voiceRestrict').checked = restrict;
    $('voiceBtn').title = engineId === 'vosk' ? '声で値を入力する（Vosk：PC の中で認識）' : '声で値を入力する（Chrome の音声認識）';
  }
  $('voiceBtn').addEventListener('click', e => { e.currentTarget.blur(); setOn(!on); });
  $('voiceEngine').addEventListener('change', e => { setEngine(e.target.value); e.target.blur(); });
  $('voiceRestrict').addEventListener('change', e => {
    restrict = e.target.checked; try { localStorage.setItem('ahann_voice_restrict', restrict ? '1' : '0'); } catch (_) {}
    addLog('voice_restrict', { value: restrict }); e.target.blur();
    if (on && engineId === 'vosk') { setOn(false); setOn(true); }
  });
  $('voskModelBtn').addEventListener('click', e => { e.currentTarget.blur(); $('voskModelFile').click(); });
  $('voskModelFile').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    await setModelFile(f);
    if (on && engineId === 'vosk') { setOn(false); setOn(true); }
  });
  $('voskModelDel').addEventListener('click', async e => { e.currentTarget.blur(); await idbDel(); modelFile = null; dropModel(); addLog('voice_model', { value: 'deleted' }); refreshModelStatus(); });
  syncVoiceUI(); refreshModelStatus();

  showHist();
  Object.assign(_, { voskWords: () => VOSK_WORDS.slice(), parseVoice, applyVoice, setVoice: setOn, setVoiceEngine: setEngine, voiceFinal: final, voicePartial: partial, voskGetModel: () => (modelFile ? getVoskModel() : null) });
})();
