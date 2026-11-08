// 操作のガイド：「？」で説明パネルを開いている間、各ボタンの近くに番号つきの吹き出しを出す。
// ヘッダーのボタンにマウスを乗せると、title の説明をすぐに出す（ブラウザ標準のツールチップは出るまで遅いので置き換える）
(() => {
  const _ = AH._;
  const { $ } = _;

  // 吹き出しの説明。見えているボタンにだけ出す。並びは画面の左から。評価グラフの操作はカードの「もっと詳しく」に書く
  const TIPS = [
    ['pid', '参加者の ID。書き出すファイルに入る'],
    ['mode', '入力方式。途中で切り替えても評価は保存される'],
    ['openBtn', '評価する動画を選ぶ（PC の外には出ない）'],
    ['backBtn', '1秒戻る。Shift+← で 0.1 秒'],
    ['playBtn', '再生／停止（Space）'],
    ['fwdBtn', '1秒進む。Shift+→ で 0.1 秒'],
    ['reviewBtn', '値を変えずに通して見る（V）'],
    ['refBtn', '基準の「あ」の声を聴き直す'],
    ['armBtn', '記録のオン／オフ（R）'],
    ['voiceBtn', '声で値を入れる。例：「快度7 覚醒度3」'],
    ['rgBtn', '評価する範囲と区間の区切り'],
    ['vwinBtn', '動画だけを別ウィンドウに出す'],
    ['tlBtn', '評価グラフを出す。なぞって値を直せる'],
    ['setBtn', '表示・コントローラー・実験の設定'],
    ['importBtn', '書き出した結果を読み込んで続きを編集'],
    ['exportBtn', '評価の結果をファイルに保存する'],
  ];

  const layer = document.createElement('div'); layer.id = 'guideLayer'; layer.className = 'guideLayer'; layer.hidden = true;
  const dim = document.createElement('div'); dim.className = 'guideDim'; dim.hidden = true;
  document.body.append(dim, layer);

  const shown = el => { if (!el || el.hidden) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? r : null; };
  const hits = (a, b) => a.l < b.r + 6 && b.l < a.r + 6 && a.t < b.b + 6 && b.t < a.b + 6;

  // 吹き出しを並べる：ボタンの真下に置き、ほかの吹き出しと重なるときは下へずらす。ボタンと吹き出しは線と番号でつなぐ
  function render() {
    layer.innerHTML = '';
    const W = window.innerWidth, H = window.innerHeight, placed = [];
    const card = shown($('helpPanel'));
    if (card) placed.push({ l: card.left, r: card.right, t: card.top, b: card.bottom });
    let n = 0;
    for (const [id, text] of TIPS) {
      const r = shown($(id));
      if (!r) continue;
      n++;
      const below = r.top < H / 2, cx = r.left + r.width / 2;
      const badge = document.createElement('span'); badge.className = 'guideNum'; badge.textContent = n;
      badge.style.left = (r.right - 9) + 'px'; badge.style.top = (r.top - 9) + 'px';
      const tip = document.createElement('div'); tip.className = 'guideTip'; tip.dataset.for = id;
      tip.innerHTML = `<b>${n}</b>`; tip.append(document.createTextNode(_.mod(text)));
      layer.append(tip);
      const w = tip.offsetWidth, h = tip.offsetHeight;
      const left = Math.max(8, Math.min(W - w - 8, cx - w / 2));
      let top = below ? r.bottom + 14 : r.top - h - 14;
      for (let moved = true; moved;) {   // 重なりがなくなるまでずらす
        moved = false;
        for (const p of placed) if (hits({ l: left, r: left + w, t: top, b: top + h }, p)) { top = below ? p.b + 8 : p.t - h - 8; moved = true; }
      }
      tip.style.left = left + 'px'; tip.style.top = top + 'px';
      placed.push({ l: left, r: left + w, t: top, b: top + h });
      const line = document.createElement('span'); line.className = 'guideLine';
      const y0 = below ? r.bottom : top + h, y1 = below ? top : r.top;
      Object.assign(line.style, { left: cx + 'px', top: y0 + 'px', height: Math.max(0, y1 - y0) + 'px' });
      layer.prepend(line);   // 線は吹き出しの後ろ
      layer.append(badge);
    }
  }

  // 説明パネル（#helpPanel）の開閉に合わせて吹き出しを出し入れする（開閉は core/layout.js）
  function sync() {
    const on = !$('helpPanel').hidden;
    layer.hidden = !on; dim.hidden = !on; document.body.classList.toggle('guide', on);
    $('helpBtn').classList.toggle('on', on);
    if (on) requestAnimationFrame(render); else layer.innerHTML = '';
  }
  new MutationObserver(sync).observe($('helpPanel'), { attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('resize', () => { if (!layer.hidden) render(); });
  $('guideClose').addEventListener('click', () => { $('helpPanel').hidden = true; });

  // ---------- すぐ出るツールチップ（ヘッダーのボタン） ----------
  // 乗せている間だけ title を外して、ブラウザ標準のツールチップと二重に出ないようにする
  const tipBox = document.createElement('div'); tipBox.className = 'quickTip'; tipBox.hidden = true; document.body.append(tipBox);
  let cur = null, timer = 0;
  function hide() {
    clearTimeout(timer); tipBox.hidden = true;
    if (cur && cur.dataset.tip != null) { cur.title = cur.dataset.tip; delete cur.dataset.tip; }
    cur = null;
  }
  document.querySelector('header').addEventListener('pointerover', e => {
    const el = e.target.closest('button[title], label[title]');
    if (el === cur) return;
    hide();
    if (!el || document.body.classList.contains('guide') || el.closest('.rgPanel')) return;
    cur = el; el.dataset.tip = el.title; el.removeAttribute('title');
    timer = setTimeout(() => {
      if (cur !== el) return;
      tipBox.textContent = el.dataset.tip; tipBox.hidden = false;
      const r = el.getBoundingClientRect(), w = tipBox.offsetWidth;
      tipBox.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
      tipBox.style.top = (r.bottom + 8) + 'px';
    }, 250);
  });
  document.querySelector('header').addEventListener('pointerout', e => { if (cur && !cur.contains(e.relatedTarget)) hide(); });
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', hide, true);

  Object.assign(_, { guideRender: render });
})();
