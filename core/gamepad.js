// ゲームパッド（ジョイスティック・スライダーの機器）と、設定パネルの「コントローラー」の欄
// 機器との約束（ツール側で決め打ち。基板側がこれに合わせる。README の「コントローラー（ゲームパッド）」）：
//   軸0＝ジョイスティック横（右＝＋）、軸1＝ジョイスティック縦（Gamepad API のとおり下＝＋。ここで符号を反転し、上＝値が高い）
//   軸2＝スライダー1、軸3＝スライダー2（+1＝上＝値が高い。−1→1、+1→9 の線形）、ボタン0＝記録のオン／オフ（押した瞬間に切り替え）
// 複数の機器を同時に読む。ジョイスティックに使う機器とスライダーに使う機器は、設定で選ぶか自動（下の poll の「自動の割り当て」）。
// 毎フレーム poll()（core/loop.js）で読み、方式からは AH.padJoy()・AH.padSliders() で今の値を受け取る
(() => {
  const _ = AH._;
  const { $, S, video, r2, clamp, addLog, writeMode, setArmed } = _;
  const DEAD = 0.08;       // ジョイスティックの遊び（modes/_shared.js の dead と同じ）
  const JOY_GRAB = 0.5;    // 自動：別の機器のスティックをここまで倒したら、そちらをジョイスティックにする
  const SL_GRAB = 0.2;     // 自動：別の機器のスライダーをここまで動かしたら、そちらをスライダーにする
  const SL_NOISE = 0.02;   // スライダーの揺れとみなす幅（これを超えたら「動かした」。値にすると 0.08）
  const ls = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
  // 使うか（既定オン）と、使う機器（'' は自動、それ以外は gamepad.id）。どれもブラウザに保存する
  const cfg = { joy: ls('ahann_pad_joy', '1') !== '0', slider: ls('ahann_pad_slider', '1') !== '0', joyDev: ls('ahann_pad_joydev', ''), sliderDev: ls('ahann_pad_sliderdev', '') };

  const list = () => (navigator.getGamepads ? [...navigator.getGamepads()].filter(g => g && g.connected !== false) : []);
  function gamepad() { return list()[0] || null; }   // 最初の機器（互換のため残す）

  // ---------- 毎フレームの読み取り ----------
  const auto = { joy: null, slider: null };   // 自動で選んだ機器（gamepad.index）
  const ref = {};        // 機器ごとのスライダーの基準値 { g: 自動の切り替え用, n: 揺れの判定用 }
  const btnPrev = {};    // 機器ごとのボタン0の前回の状態
  let joy = null, sl = null, edge0 = false, sig = '';
  const stickOut = g => Math.max(Math.abs(g.axes[0] || 0), Math.abs(g.axes[1] || 0)) > DEAD;
  const pick = (gps, dev, a) => (dev && gps.find(g => g.id === dev)) || gps.find(g => g.index === a) || null;
  function poll() {
    const gps = list(), has = i => gps.some(g => g.index === i);
    const moved = {};
    for (const g of gps) {
      const a = g.axes, r = ref[g.index] || (ref[g.index] = { g: [a[2], a[3]], n: [a[2], a[3]] });
      moved[g.index] = [false, false];
      for (const i of [0, 1]) {
        const x = a[2 + i]; if (x == null) continue;
        if (r.n[i] == null || Math.abs(x - r.n[i]) > SL_NOISE) { if (r.n[i] != null) moved[g.index][i] = true; r.n[i] = x; }
        if (r.g[i] == null) r.g[i] = x;
        else if (Math.abs(x - r.g[i]) > SL_GRAB) { r.g[i] = x; auto.slider = g.index; }
      }
      // 自動の割り当て：別の機器のスティックを大きく倒したら、そちらをジョイスティックにする（今のジョイスティックを倒している間は替えない）
      if (auto.joy !== g.index && Math.max(Math.abs(a[0] || 0), Math.abs(a[1] || 0)) > JOY_GRAB) {
        const cur = gps.find(x => x.index === auto.joy);
        if (!cur || !stickOut(cur)) auto.joy = g.index;
      }
    }
    // 最初は、ジョイスティック＝最初の機器、スライダー＝軸を4本以上持つ最初の機器
    if (!has(auto.joy)) auto.joy = gps.length ? gps[0].index : null;
    if (!has(auto.slider)) { const f = gps.find(g => g.axes.length >= 4) || gps.find(g => g.axes.length >= 3); auto.slider = f ? f.index : null; }
    const jp = cfg.joy ? pick(gps, cfg.joyDev, auto.joy) : null, sp = cfg.slider ? pick(gps, cfg.sliderDev, auto.slider) : null;
    if (jp && jp.axes.length >= 2) {
      const d = x => (Math.abs(x) < DEAD ? 0 : clamp(x, -1, 1));
      const x = d(jp.axes[0] || 0), y = -d(jp.axes[1] || 0);
      joy = { x, y, active: !!(x || y), id: jp.id, index: jp.index };
    } else joy = null;
    if (sp && sp.axes.length >= 3) {
      const v = i => (sp.axes[2 + i] == null ? null : r2(clamp(5 + sp.axes[2 + i] * 4, 1, 9)));
      sl = { val: [v(0), v(1)], moved: moved[sp.index], id: sp.id, index: sp.index };
    } else sl = null;
    // ボタン0：使っている機器（ジョイスティック・スライダー）のどれかで押した瞬間
    edge0 = false;
    for (const g of gps) {
      const now = !!(g.buttons[0] && g.buttons[0].pressed);
      if (now && !btnPrev[g.index] && ((jp && jp.index === g.index) || (sp && sp.index === g.index))) edge0 = true;
      btnPrev[g.index] = now;
    }
    // 使う機器が変わった：記録オンの方式でなくなったら記録オフにし、画面を描き直す（記録ボタンの出し入れ）
    const s = (joy ? joy.id + '#' + joy.index : '') + '|' + (sl ? sl.id + '#' + sl.index : '');
    if (s !== sig) {
      const was = sig; sig = s;
      if (was && S.data && video.src) addLog('pad_assign', { value: `joystick=${joy ? joy.id : ''}`, detail: `slider=${sl ? sl.id : ''}` });
      if (S.armed && writeMode() !== 'armed') setArmed(false);
      if (_.refresh) _.refresh();
    }
    if (!$('setPanel').hidden && ++renderN % 6 === 0) renderPanel(gps);
  }
  const padPressed = i => (i === 0 ? edge0 : false);   // 押した瞬間だけ true（ボタン0のみ）
  const padJoy = () => joy;          // { x, y（−1〜1、上＝＋、遊びの内は0）, active, id } か null
  const padSliders = () => sl;       // { val: [1本目, 2本目]（1〜9）, moved: [動かしたか, …], id } か null

  // 接続・切断を操作ログに残す。セッションの始めにも、つながっている機器を残す（core/modes-registry.js の newSession）
  const padDesc = g => `index=${g.index} axes=${g.axes.length} buttons=${g.buttons.length}`;
  window.addEventListener('gamepadconnected', e => { if (S.data) addLog('pad_connect', { value: e.gamepad.id, detail: padDesc(e.gamepad) }); });
  window.addEventListener('gamepaddisconnected', e => {
    delete ref[e.gamepad.index]; delete btnPrev[e.gamepad.index];
    if (S.data) addLog('pad_disconnect', { value: e.gamepad.id, detail: 'index=' + e.gamepad.index });
  });
  function padLogAll() { for (const g of list()) addLog('pad_connect', { value: g.id, detail: padDesc(g) + ' at_start' }); }
  // 書き出しのメタ情報：設定・今の機器・つながっている機器・書き込みに使った機器（strokes の pad から）
  function padMeta() {
    const used = [];
    for (const s of (S.data && S.data.strokes) || []) for (const [role, id] of Object.entries(s.pad || {})) if (!used.some(u => u.role === role && u.id === id)) used.push({ role, id });
    return { use: { joystick: cfg.joy, slider: cfg.slider }, device: { joystick: cfg.joyDev || 'auto', slider: cfg.sliderDev || 'auto' },
      joystick: joy ? joy.id : null, slider: sl ? sl.id : null, connected: list().map(g => ({ index: g.index, id: g.id, axes: g.axes.length, buttons: g.buttons.length })), used };
  }

  // ---------- 設定パネルの「コントローラー」の欄 ----------
  let renderN = 0, devSig = null;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function renderPanel(gps = list()) {
    // 機器の選択肢（つながっている機器が変わったときだけ作り直す）
    const ds = gps.map(g => g.id).join('\n');
    if (ds !== devSig) {
      devSig = ds;
      for (const [sel, key] of [['padJoyDev', 'joyDev'], ['padSliderDev', 'sliderDev']]) {
        const ids = [...new Set([...gps.map(g => g.id), ...(cfg[key] ? [cfg[key]] : [])])];
        $(sel).innerHTML = '<option value="">自動</option>' + ids.map(id => `<option value="${esc(id)}">${esc(id.length > 28 ? id.slice(0, 27) + '…' : id)}</option>`).join('');
        $(sel).value = cfg[key];
      }
    }
    const box = $('padList');
    if (!gps.length) { box.innerHTML = '<p class="muted">接続されていません（機器のボタンを押すと認識されます）</p>'; return; }
    box.innerHTML = gps.map(g => {
      const role = [joy && joy.index === g.index ? 'ジョイスティック' : '', sl && sl.index === g.index ? 'スライダー' : ''].filter(Boolean).join('・') || '不使用';
      const axes = g.axes.map((x, i) => {
        const w = Math.min(50, Math.abs(x) * 50), l = x < 0 ? 50 - w : 50;
        return `<span class="padAx" data-axis="${i}" title="軸${i} = ${x.toFixed(2)}"><span class="padAxN">${i}</span><span class="padAxBar"><i style="left:${l}%;width:${w}%"></i></span><span class="padAxV">${x.toFixed(2)}</span></span>`;
      }).join('');
      const btns = g.buttons.slice(0, 16).map((b, i) => `<span class="padBtn${b.pressed ? ' on' : ''}" title="ボタン${i}">${i}</span>`).join('');
      return `<div class="padDev" data-index="${g.index}"><div class="padName" title="${esc(g.id)}"><b>${g.index}</b> <span class="padRole">${role}</span> ${esc(g.id)}</div><div class="padAxes">${axes}</div><div class="padBtns">${btns}</div></div>`;
    }).join('');
  }
  for (const [cb, key, name] of [['padJoyUse', 'joy', 'ahann_pad_joy'], ['padSliderUse', 'slider', 'ahann_pad_slider']]) {
    $(cb).checked = cfg[key];
    $(cb).addEventListener('change', e => {
      cfg[key] = e.target.checked; lsSet(name, cfg[key] ? '1' : '0');
      addLog('pad_setting', { value: `${key === 'joy' ? 'joystick' : 'slider'}=${cfg[key] ? 'on' : 'off'}` }); e.target.blur();
    });
  }
  for (const [sel, key, name] of [['padJoyDev', 'joyDev', 'ahann_pad_joydev'], ['padSliderDev', 'sliderDev', 'ahann_pad_sliderdev']]) {
    $(sel).addEventListener('change', e => {
      cfg[key] = e.target.value; lsSet(name, cfg[key]);
      addLog('pad_setting', { value: `${key === 'joyDev' ? 'joystick' : 'slider'}_device=${cfg[key] || 'auto'}` }); e.target.blur();
    });
  }
  $('setBtn').addEventListener('click', () => { devSig = null; renderPanel(); });

  Object.assign(_, { gamepad, padPressed, padPoll: poll, padJoy, padSliders, padLogAll, padMeta, padRoleId: r => (r === 'joy' ? (joy && joy.id) : (sl && sl.id)) || '' });
})();
