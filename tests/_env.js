// テスト共通の設定：ページの URL、テスト動画、ブラウザ、出力先
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
const VID = path.join(__dirname, 'fixtures', 'test.mp4');
// ブラウザは環境変数 AH_BROWSER で上書きできる（既定は Edge）
const BROWSER = process.env.AH_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
// スクリーンショットや保存したファイルの置き場（.gitignore 済み）。AH_OUT で変えられる
const OUT = process.env.AH_OUT ? path.resolve(process.env.AH_OUT) : path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const out = name => path.join(OUT, name);

module.exports = { ROOT, URL, VID, BROWSER, OUT, out };
