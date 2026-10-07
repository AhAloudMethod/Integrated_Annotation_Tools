// zip を作る（圧縮しない格納方式。ファイル名は UTF-8）。実験モードで 1 試行の書き出しを 1 つのファイルにまとめるのに使う。
// ブラウザでは AH._.makeZip、Node では module.exports.makeZip。files：[{ name, data（文字列か Uint8Array） }] → Uint8Array
(() => {
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  // MS-DOS の日時（2 秒単位）
  function dosTime(d) {
    return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
  }
  function makeZip(files, now = new Date()) {
    const enc = new TextEncoder(), { time, date } = dosTime(now);
    const parts = [], central = [];
    let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
      // 共通の項目：版 20、フラグ 0x0800（名前が UTF-8）、格納（0）、時刻、日付、CRC、大きさ×2、名前の長さ、拡張の長さ 0
      const common = (v, at) => { v.setUint16(at, 20, true); v.setUint16(at + 2, 0x0800, true); v.setUint16(at + 4, 0, true); v.setUint16(at + 6, time, true); v.setUint16(at + 8, date, true);
        v.setUint32(at + 10, crc, true); v.setUint32(at + 14, data.length, true); v.setUint32(at + 18, data.length, true); v.setUint16(at + 22, name.length, true); v.setUint16(at + 24, 0, true); };
      const lh = new Uint8Array(30 + name.length), lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true); common(lv, 4); lh.set(name, 30);
      const ch = new Uint8Array(46 + name.length), cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); common(cv, 6); cv.setUint32(42, off, true); ch.set(name, 46);
      parts.push(lh, data); central.push(ch);
      off += lh.length + data.length;
    }
    const csize = central.reduce((p, c) => p + c.length, 0);
    const end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, csize, true); ev.setUint32(16, off, true);
    const all = [...parts, ...central, end], out = new Uint8Array(all.reduce((p, c) => p + c.length, 0));
    let at = 0; for (const c of all) { out.set(c, at); at += c.length; }
    return out;
  }
  const api = { makeZip, crc32 };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else AH._.makeZip = makeZip;
})();
