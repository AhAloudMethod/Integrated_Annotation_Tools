// あアラウド アノテーション 共通部分（core/*.js）。これは最初に読み込むファイル。
// 動画・再生制御・巻き戻し上書き・グラフ直接編集・評価区間・操作ログ・取り消し・自動保存・書き出しを全方式で共通化する。
// 各方式（modes/*.js）は AH.register() で登録し、入力UIと値の読み取りだけを受け持つ。
//
// core のファイル間で共有する内部の値・関数は AH._ に置く（方式側は使わず、AH.* の公開 API だけを使う）。
//  - 各ファイルは最後に Object.assign(_, {...}) で、他のファイルが使う定義を AH._ に載せる
//  - 先に読み込まれたファイルの定義は、各ファイル冒頭で const { ... } = _; として受け取る
//  - 後で読み込まれるファイルの定義（前方参照）と、再代入される状態（_.M＝選択中の方式、_.stroke＝書き込み中の区間）は _.名前 で参照する
//  - 公開 API（AH.S, AH.register など）は core/init.js でまとめて AH に載せる
//
// このファイル：状態（S）・定数・操作ログ・取り消し
const AH = { _: {} };
(() => {
  const _ = AH._;
  const FPS = 60;              // 書き出しのサンプリング周波数
  const SNAP = 1 / FPS;        // この幅以内の既存変化点は上書き
  const $ = id => document.getElementById(id);
  const video = $('video'), tl = $('tl'), tctx = tl.getContext('2d');
  const modes = {};
  _.M = null;                // 選択中の方式

  // ---------- 状態 ----------
  const S = {
    meta: { participant: '', video_file: '', duration: 0, session_start_iso: '', tool: 'ah-annotator-v0.5', mode: '', options: {}, range: null },
    data: null,   // {points:{v,a}, strokes:[], cells:{v,a}, events:[], memo:''}
    log: [], undo: [], t0: performance.now(), lastTime: 0,
    armed: false,
    videoSig: '',   // 動画の見分け（ファイルの大きさ＋長さ）。ファイル名を変えても評価区間を復元するため
  };
  const emptyData = () => {
    const iv = _.M ? _.M.init : { v: 5, a: 5 };
    return { points: { v: [{ t: 0, val: iv.v, init: true }], a: [{ t: 0, val: iv.a, init: true }] },
             strokes: [], cells: { v: [], a: [] }, events: [], memo: '' };
  };
  const model = () => (_.M ? _.M.model : 'series');
  // 値が整数か。方式が isInteger を持てばそれに従う（カスタムの「値」）。なければ区間表と integer の方式が整数
  const isInt = () => !!(_.M && (_.M.isInteger ? _.M.isInteger() : model() === 'table' || _.M.integer));

  const wall = () => +(performance.now() - S.t0).toFixed(1);
  const vt = () => +video.currentTime.toFixed(4);
  const r2 = x => Math.round(x * 100) / 100;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  function addLog(type, extra = {}) {
    S.log.push({ wall_ms: wall(), video_t: vt(), type, axis: '', value: '', detail: '', ...extra });
    _.autosave();
  }
  const snapshot = () => JSON.parse(JSON.stringify(S.data));
  const pushUndo = s => { S.undo.push(s || snapshot()); if (S.undo.length > 200) S.undo.shift(); };
  function undo() {
    if (!S.undo.length) return;
    _.endStroke('undo');
    S.data = S.undo.pop();
    addLog('undo'); _.refresh();
  }

  Object.assign(_, { FPS, SNAP, $, video, tl, tctx, modes, S, emptyData, model, isInt, wall, vt, r2, clamp, addLog, snapshot, pushUndo, undo });
})();
