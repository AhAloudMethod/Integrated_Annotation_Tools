// ゲームパッド
(() => {
  const _ = AH._;
  // ---------- ゲームパッド ----------
  const padPrev = {};
  function gamepad() {
    const gps = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    return gps[0] || null;
  }
  function padPressed(i) {   // 押した瞬間だけ true
    const g = gamepad(); if (!g || !g.buttons[i]) return false;
    const now = g.buttons[i].pressed, was = padPrev[i]; padPrev[i] = now;
    return now && !was;
  }

  Object.assign(_, { gamepad, padPressed });
})();
