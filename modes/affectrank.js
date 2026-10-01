// ---- AffectRank（変化を感じたときだけ8方向から選ぶ） ----
(() => {
  const { rankPad } = AH.ui;
  let pad = null;
  AH.register({
    vaOnly: true,   // 絵・感情語が VA 前提なので、評価の軸の組にかかわらず VA（core/axes.js）
    id: 'affectrank', group: '相対（変化の方向）', label: 'AffectRank（変化時に8方向）', model: 'events', side: 'wide', init: { v: 5, a: 5 },
    help: '<p>快度・覚醒度が「変わった」と感じたときだけ、変化の方向を8つから選んでクリックします（テンキーでも可：8＝活発、9＝活発・快、6＝快 …）。変化がなければ何もしません。<kbd>Backspace</kbd> で今の時刻より前の直近の入力を削除します。</p>',
    mount({ panel }) { pad = rankPad(panel); },
    onKey: e => pad.onKey(e),
    update() { if (pad) pad.update(); },
  });
})();
