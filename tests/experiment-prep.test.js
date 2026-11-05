// experiment-prep skill の Todo の雛形（.claude/skills/experiment-prep/assets/todo.html）を確かめる
// 初期の描画，追加・子タスク・チェック・削除，開き直したあとの保存，Markdown の書き出しと読み込み
const { chromium } = require('playwright-core');
const path = require('path');
const { pathToFileURL } = require('url');
const { ROOT, BROWSER, out } = require('./_env');

const URL = pathToFileURL(path.join(ROOT, '.claude', 'skills', 'experiment-prep', 'assets', 'todo.html')).href;
let failed = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? ' ' + info : ''}`); if (!ok) failed++; };

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1200 } });
  const errs = [];
  const open = async () => {
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(URL);
    await page.waitForFunction(() => window.TODO && document.querySelectorAll('section.tier').length > 0);
    return page;
  };
  const S = page => page.evaluate(() => JSON.parse(JSON.stringify(TODO.state)));

  let page = await open();
  let s = await S(page);
  check('初期の 2 件を描画する', s.tasks.length === 2 && await page.locator('li.task').count() === 2);
  check('4 つの段を出す', JSON.stringify(await page.locator('section.tier h2').allTextContents()) === JSON.stringify(['説明', 'タスク', '募集', '環境']));
  check('ブラウザに保存する', await page.evaluate(() => TODO.store.kind) === 'local');

  // 募集の段に追加
  const add = page.locator('section[data-tier="募集"] .add');
  await add.locator('input').nth(0).fill('謝礼額を先生に相談する');
  await add.locator('input').nth(1).fill('募集開始前');
  await add.locator('input').nth(1).press('Enter');
  s = await S(page);
  const fee = s.tasks.find(t => t.title === '謝礼額を先生に相談する');
  check('段にタスクを追加する', fee && fee.tier === '募集' && fee.due === '募集開始前');

  // 子タスクを追加
  await page.locator(`li[data-id="${fee.id}"] > .row .more`).click();
  const ed = page.locator(`li[data-id="${fee.id}"] > .editor`);
  await ed.locator('input[aria-label="子タスクを追加"]').fill('最低賃金の最新額を確かめる');
  await ed.locator('input[aria-label="子タスクを追加"]').press('Enter');
  s = await S(page);
  const child = s.tasks.find(t => t.title === '最低賃金の最新額を確かめる');
  check('子タスクを追加する', child && child.parent === fee.id && child.tier === '募集');

  // チェック
  await page.locator(`li[data-id="${child.id}"] > .row .check`).check();
  s = await S(page);
  check('チェックで完了にする', s.tasks.find(t => t.id === child.id).done === true);
  await page.screenshot({ path: out('experiment-prep.png'), fullPage: true });

  // 開き直しても残る
  await page.close();
  page = await open();
  s = await S(page);
  check('開き直しても残る', s.tasks.length === 4 && s.tasks.find(t => t.id === child.id).done === true);

  // 書き出し
  await page.locator('#exportBtn').click();
  const md = await page.locator('#io').inputValue();
  check('Markdown に書き出す', md.includes('## 募集\n- [ ] 謝礼額を先生に相談する ｜いつまで：募集開始前\n  - [x] 最低賃金の最新額を確かめる'), JSON.stringify(md.slice(0, 80)));
  check('詳細も書き出す', md.includes('  - 詳細：言い回しで参加者の解釈が変わるため．'));

  // 読み込み（往復で同じになる・2 度押しで置き換える）
  const before = await S(page);
  await page.locator('#importBtn').click();
  check('1 度目の読み込みでは置き換えない', (await S(page)).tasks.map(t => t.id).join() === before.tasks.map(t => t.id).join());
  await page.locator('#importBtn').click();
  const after = await S(page);
  const shape = st => st.tasks.map(t => [t.tier, t.title, t.due, t.detail, t.memo, t.done, t.parent ? st.tasks.find(x => x.id === t.parent).title : null].join('|')).sort().join('\n');
  check('書き出して読み込むと同じリストになる', shape(after) === shape(before));

  // 手書きのリストを読み込む（チェックボックス無し・知らない見出し）
  await page.locator('#io').fill('# 実験4\n## 説明\n- 同意書を印刷する\n  - 詳細：手書き．テンプレート：[実験同意書テンプレート](https://scrapbox.io/ah-aloud/x) と https://example.com/y と javascript:alert(1)\n## その他\n- [x] 鍵を借りる ｜いつまで：前日\n  - メモ：事務室\n');
  await page.locator('#importBtn').click(); await page.locator('#importBtn').click();
  s = await S(page);
  check('手書きのリストを読み込む', s.title === '実験4' && s.tasks.length === 2 && s.tasks[1].tier === 'その他' && s.tasks[1].memo === '事務室' && s.tasks[1].done);
  check('知らない見出しも段として出す', (await page.locator('section.tier h2').allTextContents()).includes('その他'));
  const links = await page.locator('.detail a').evaluateAll(as => as.map(a => [a.textContent, a.getAttribute('href'), a.target]));
  check('詳細のリンクを押せるようにする', JSON.stringify(links) === JSON.stringify([['実験同意書テンプレート', 'https://scrapbox.io/ah-aloud/x', '_blank'], ['https://example.com/y', 'https://example.com/y', '_blank']]), JSON.stringify(links));
  check('リンクにしても書き出しは元のまま', (await page.evaluate(() => TODO.toMarkdown())).includes('[実験同意書テンプレート](https://scrapbox.io/ah-aloud/x) と https://example.com/y'));

  // 削除は 2 度押し
  const id = s.tasks[0].id;
  await page.locator(`li[data-id="${id}"] > .row .more`).click();
  const del = page.locator(`li[data-id="${id}"] > .editor .btn.danger`);
  await del.click();
  check('1 度目の削除では消さない', (await S(page)).tasks.some(t => t.id === id));
  await del.click();
  check('2 度押すと消す', !(await S(page)).tasks.some(t => t.id === id));

  // 保存できない環境では知らせる
  const ctx2 = await browser.newContext();
  await ctx2.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get(){ throw new Error('blocked'); } }); });
  const p2 = await ctx2.newPage(); p2.on('pageerror', e => errs.push(e.message));
  await p2.goto(URL); await p2.waitForFunction(() => document.querySelectorAll('li.task').length === 2);
  check('保存できないときは知らせる', await p2.locator('#notice').isVisible() && await p2.evaluate(() => TODO.store.kind) === 'none');

  console.log('errors:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
  if (failed) process.exit(1);
})();
