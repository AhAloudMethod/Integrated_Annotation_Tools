// 見返し：評価し終えた記録を、止まらずに再生しながら追う。見返しの間は値を変えない（書き込み・区間の値・変化の入力・グラフの編集・声の入力を止め、
// 入力面は操作できなくする）。聴いてから入力の自動停止もしない。画面は記録済みの値を映す。ヘッダーの「見返し」か V キーで切り替え、操作ログに review を残す
(() => {
  const _ = AH._;
  const { $, addLog } = _;
  let on = false;
  const reviewing = () => on;
  function setReview(v) {
    if (on === v) return;
    on = v;
    if (on) { _.setArmed(false); _.endStroke('review'); _.pen.down = false; if (_.setVoice) _.setVoice(false); }
    if (on && $('under').contains(document.activeElement)) document.activeElement.blur();   // Excel のセルに入れている途中なら外す
    document.body.classList.toggle('review', on);
    $('reviewBtn').classList.toggle('on', on);
    $('reviewBtn').textContent = on ? '見返し中' : '見返し';
    addLog('review', { value: on ? 'on' : 'off' }); _.refresh();
  }
  $('reviewBtn').addEventListener('click', e => { setReview(!on); e.currentTarget.blur(); });
  Object.assign(_, { reviewing, setReview });
})();
