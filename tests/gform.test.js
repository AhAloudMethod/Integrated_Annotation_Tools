// Google フォームの変換（tools/gform/convert.js）：export.gs の書き出しの形から、画面の中のアンケートの定義を作る。ブラウザは使わない
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { OUT } = require('./_env');
const { convert } = require('../tools/gform/convert');
const { lintForm } = require('../core/exp-check');

let failed = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? ' ' + info : ''}`); if (!ok) failed++; };

// export.gs の書き出しの見本（tests/survey.test.js も画面の中で答えるのに使う）
const SRC = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'gform-export.json'), 'utf8'));
const r = convert(SRC);
const els = r.form.pages.flatMap(p => p.elements), byTitle = t => els.find(e => e.title === t);
check('ページ区切りでページを分け、ページの名前・説明を移す', r.form.pages.length === 2 && r.form.pages[1].title === 'あなたについて' && r.form.pages[1].description === '最後のページです' && r.form.showProgressBar === 'top', JSON.stringify(r.form.pages.map(p => p.title)));
check('タイトルと説明を移す', r.form.title === '実験後アンケート' && r.form.description === '感じたとおりに答えてください');
check('セクションの見出しは説明の文（html）にする（改行は <br>）', els[0].type === 'html' && els[0].html === '<h3>評価について</h3><p>1 行目<br>2 行目</p>', JSON.stringify(els[0]));
const sc = byTitle('評価のしやすさ');
check('均等目盛（SCALE）は段階の評定にし、範囲と両端のラベルを移す', sc.type === 'rating' && sc.rateMin === 1 && sc.rateMax === 7 && sc.minRateDescription === '全くしやすくない' && sc.maxRateDescription === '非常にしやすい' && sc.name === 'q01', JSON.stringify(sc));
const gr = byTitle('ツールについて');
check('グリッドは表の形の評定にし、必須なら全行を必須にする', gr.type === 'matrix' && gr.rows.length === 2 && gr.columns[2] === 'はい' && gr.isAllRowRequired === true, JSON.stringify(gr));
check('ラジオボタン・チェックボックス・プルダウンを移し、「その他」も移す', byTitle('経験').type === 'radiogroup' && byTitle('経験').showOtherItem === true && byTitle('使った機能').type === 'checkbox' && byTitle('学年').type === 'dropdown');
check('段落は複数行の記述、記述式は 1 行の記述、日付は日付の欄', byTitle('感想').type === 'comment' && byTitle('名前').type === 'text' && byTitle('日付').inputType === 'date');
check('必須かどうかはフォームのまま明示し、必須でない設問を一覧にする', byTitle('使った機能').isRequired === false && byTitle('学年').isRequired === true && r.optional.length === 4 && r.optional[0].startsWith('q04：使った機能'), JSON.stringify(r.optional));
check('name は q01 から順に振る（見出し・画像には振らない）', els.filter(e => e.type !== 'html').map(e => e.name).join() === 'q01,q02,q03,q04,q05,q06,q07,q08,q09,q10', els.map(e => e.name).join());
check('分岐・画像・チェックボックスのグリッドは警告に出す', r.warnings.some(w => w.includes('分岐')) && r.warnings.some(w => w.includes('画像「図 1」')) && r.warnings.some(w => w.includes('チェックボックスのグリッド')), JSON.stringify(r.warnings));
const lint = lintForm(r.form, 'x');
check('変換した定義は検査で誤りが無く、ラベルの無い段階だけを警告する', !lint.errors.length && lint.warnings.length === 1 && lint.warnings[0].includes('q06'), JSON.stringify(lint));
let threw = '';
try { convert({ items: [] }); } catch (e) { threw = e.message; }
check('export.gs の書き出しでない JSON は断る', threw.includes('export.gs'), threw);

// コマンドとして：出力先に書き、必須でない設問と警告を出す
const dir = path.join(OUT, 'gform'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'in.form-export.json'), JSON.stringify(SRC));
const cmd = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'gform', 'convert.js'), path.join(dir, 'in.form-export.json')], { encoding: 'utf8' });
const outFile = path.join(dir, '実験後アンケート.json');
check('コマンド：入力と同じ場所に <フォームの名前>.json を書き、必須でない設問と警告を出す',
  cmd.status === 0 && fs.existsSync(outFile) && cmd.stdout.includes('必須でない設問') && cmd.stdout.includes('確かめてください') && JSON.parse(fs.readFileSync(outFile, 'utf8')).pages.length === 2, cmd.stdout);
const again = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'gform', 'convert.js'), path.join(dir, 'in.form-export.json')], { encoding: 'utf8' });
check('コマンド：出力先を省いて同じ名前のファイルがあれば上書きしない', again.status === 1 && again.stdout.includes('すでにあります'), again.stdout);

if (failed) process.exitCode = 1;
