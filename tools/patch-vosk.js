// vendor/vosk.js（vosk-browser 0.0.8）に、file:// で開いたページでも動くための修正を当てる
//   node tools/patch-vosk.js
// 元の dist/vosk.js に対して1回だけ実行する（当て済みなら何もしない）。修正の内容は vendor/README.txt
const fs = require('fs');
const path = require('path');
const P = path.resolve(__dirname, '..', 'vendor', 'vosk.js');
let s = fs.readFileSync(P, 'utf8');
const m = s.match(/createBase64WorkerFactory\('([A-Za-z0-9+/=]+)'/);
if (!m) throw new Error('worker のコードが見つかりません');
let src = Buffer.from(m[1], 'base64').toString('utf8');
if (src.includes('ah-annotator patch')) { console.log('当て済みです'); process.exit(0); }

// 1. モデルの URL を worker の場所から解決する処理：file:// では基準の URL が使えないので、絶対 URL のまま使う
const from = 'const fullModelUrl = new URL(modelUrl, location.href.replace(/^blob:/, ""));';
if (src.split(from).length !== 2) throw new Error('モデルの URL の処理が見つかりません');
src = src.replace(from, 'const fullModelUrl = (() => { try { return new URL(modelUrl, location.href.replace(/^blob:/, "")); } catch (_) { return new URL(modelUrl); } })();   // ah-annotator patch 1');

// 2. モデルをメッセージで受け取る：file:// では worker からページの blob: を fetch できないため、
//    「ah-model:」で始まる URL の fetch は、ページから送られた ArrayBuffer（{ action: 'ah-model', buffer }）を返す
const inject = `
// ah-annotator patch 2：モデルをメッセージで受け取る（file:// では worker からページの blob: を fetch できない）
let __ahModelResolve; const __ahModel = new Promise(r => { __ahModelResolve = r; });
self.addEventListener('message', e => { if (e.data && e.data.action === 'ah-model') { e.stopImmediatePropagation(); __ahModelResolve(e.data.buffer); } });
const __ahFetch = self.fetch.bind(self);
self.fetch = (u, o) => (String(u).startsWith('ah-model:') ? __ahModel.then(b => new Response(b)) : __ahFetch(u, o));
`;
const nl = src.indexOf('\n', 10) + 1;   // 1行目は createURL で捨てられるので、2行目の前に入れる
src = src.slice(0, nl) + inject + src.slice(nl);
s = s.replace(m[1], Buffer.from(src, 'utf8').toString('base64'));
fs.writeFileSync(P, s);
console.log('修正しました:', P);
