// 発声者の区切り：発声者の結果（試行の zip か _session.json）から評価区間（開始・終了・区切り）を読み、
// 評価区間の欄で当てて区間ごとに再生する。setup.json の書き出しの画面（core/experiment.js）でも、同じ読み取りで動画ごとの評価区間に取り込む
(() => {
  const _ = AH._;
  const { $, video, S, addLog } = _;
  const isObj = x => x != null && typeof x === 'object' && !Array.isArray(x);

  // zip の中のファイルを読む → [{ name, bytes }]。書き出しの zip（格納）と、エクスプローラーなどで圧縮し直した zip（deflate）を読める
  async function unzip(buf) {
    const b = new Uint8Array(buf), v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let at = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (v.getUint32(i, true) === 0x06054b50) { at = i; break; }
    if (at < 0) throw new Error('zip として読めません');
    const n = v.getUint16(at + 10, true), dec = new TextDecoder(), out = [];
    let c = v.getUint32(at + 16, true);
    for (let k = 0; k < n; k++) {
      if (v.getUint32(c, true) !== 0x02014b50) throw new Error('zip の目次が壊れています');
      const method = v.getUint16(c + 10, true), size = v.getUint32(c + 20, true), nl = v.getUint16(c + 28, true), el = v.getUint16(c + 30, true), cl = v.getUint16(c + 32, true), off = v.getUint32(c + 42, true);
      const name = dec.decode(b.subarray(c + 46, c + 46 + nl));
      const body = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true), raw = b.subarray(body, body + size);
      if (method === 0) out.push({ name, bytes: raw });
      else if (method === 8) out.push({ name, bytes: new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()) });
      c += 46 + nl + el + cl;
    }
    return out;
  }
  const parse = text => JSON.parse(text.replace(/^﻿/, ''));   // 書き出したファイルは BOM で始まる

  // _session.json の中身 → { video, size, duration, range, refVideo, pid, trial, src }。range は評価区間の欄の形（S.meta.range）
  function fromSession(js, src) {
    const m = isObj(js) ? js.meta : null;
    if (!isObj(m) || !isObj(m.range)) throw new Error(`${src}：評価区間（meta.range）がありません`);
    const ex = isObj(m.experiment) ? m.experiment : {}, rec = isObj(ex.record) ? ex.record : {};
    return { video: rec.file || m.video_file || '', size: rec.size || null, duration: m.duration || rec.duration || null, range: m.range,
      refVideo: rec.ref_video || null, pid: m.participant || '', trial: typeof ex.trial === 'number' ? ex.trial + 1 : null, src };
  }
  // 1 つのファイル（zip か _session.json）→ 結果の配列（zip の中の _session.json ごとに 1 つ）
  async function readSpeaker(file) {
    if (/\.zip$/i.test(file.name)) {
      const ss = (await unzip(await file.arrayBuffer())).filter(f => /_session\.json$/.test(f.name));
      if (!ss.length) throw new Error(`${file.name}：_session.json が入っていません`);
      return ss.map(f => fromSession(parse(new TextDecoder().decode(f.bytes)), `${file.name}/${f.name}`));
    }
    return [fromSession(parse(await file.text()), file.name)];
  }
  const who = r => [r.pid, r.trial ? `試行 ${r.trial}` : ''].filter(Boolean).join(' ');
  const rangeEndOf = r => (r.edges ? r.edges[r.edges.length - 1] : r.target != null ? r.target : r.start + r.count * r.bin);

  // ---------- 評価区間の欄：発声者の区切りを読み込む ----------
  // 開いている動画と同じ名前（無ければ同じ大きさ）の結果を選ぶ。どれも違えば確かめてから当てる。取り消し（Ctrl+Z）で戻せる
  async function loadForVideo(files) {
    if (!S.meta.duration) { _.hintMsg('先に動画を開いてください'); return; }
    let list = [];
    try { for (const f of files) list.push(...await readSpeaker(f)); } catch (err) { alert('発声者の結果を読めません：' + err.message); return; }
    const size = +(S.videoSig || '').split(':')[0] || null;
    const r = list.find(x => x.video === S.meta.video_file) || list.find(x => size && x.size === size) || list[0];
    if (r.video !== S.meta.video_file && !(size && r.size === size)
      && !confirm(`発声者の結果の動画（${r.video || '不明'}）と、開いている動画（${S.meta.video_file}）が違います。このまま区切りを当てますか？`)) return;
    if (rangeEndOf(r.range) > S.meta.duration + 0.02) { alert(`発声者の評価区間の終了（${rangeEndOf(r.range)} 秒）が動画の長さを超えています`); return; }
    const before = S.data ? _.undoPoint() : null;
    _.setRange({ ...r.range, edges: Array.isArray(r.range.edges) ? r.range.edges.slice() : null });
    if (before) _.pushUndo(before);
    addLog('range_speaker', { detail: `${r.src}${who(r) ? ' ' + who(r) : ''}` });
    $('spkInfo').textContent = `${who(r) || r.src} の区切り：${_.nSec()} 区間`;
    $('status').textContent = '発声者の区切りを当てました';
  }
  $('spkLoad').addEventListener('click', e => { e.currentTarget.blur(); $('spkFile').click(); });
  $('spkFile').addEventListener('change', e => { const list = [...e.target.files]; e.target.value = ''; if (list.length) loadForVideo(list); });

  // ---------- 区間ごとに再生する ----------
  // 評価区間の区間を一覧にし、押すとその区間を始めから終わりまで再生して止める（core/listen.js の playSec）
  const fmtS = x => { const m = Math.floor(x / 60); return m + ':' + (x - m * 60).toFixed(1).padStart(4, '0'); };
  let shown = '';
  function segListSync() {
    const box = $('segList'); if (!box) return;
    const n = video.src ? _.nSec() : 0, sig = n ? _.rangeSig() + S.meta.video_file : '';
    if (sig !== shown) {
      shown = sig;
      box.textContent = '';
      for (let s = 0; s < n; s++) {
        const b = document.createElement('button');
        b.type = 'button'; b.dataset.sec = s;
        b.textContent = `${s + 1}　${fmtS(_.binStart(s))}〜${fmtS(_.binEnd(s))}`;
        b.title = `区間 ${s + 1} を再生して終わりで止める`;
        box.appendChild(b);
      }
    }
    markNow();
  }
  function markNow() {
    if ($('rgPanel').hidden || !video.src) return;
    const cur = String(_.curSec());
    for (const b of $('segList').children) b.classList.toggle('on', b.dataset.sec === cur);
  }
  $('segList').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    b.blur();
    const s = +b.dataset.sec;
    if (_.listenPlaySec(s)) addLog('seg_play', { detail: `sec=${s}` });
  });
  video.addEventListener('timeupdate', markNow);
  video.addEventListener('loadedmetadata', () => { $('spkInfo').textContent = ''; segListSync(); });
  $('rgBtn').addEventListener('click', () => segListSync());

  Object.assign(_, { readSpeaker, segListSync });
})();
