/* Amog Space Program — boot & main loop.
 * Logic runs off wall-clock time from BOTH requestAnimationFrame and a
 * setInterval fallback, so the game keeps running in throttled/background
 * tabs (it's an incremental — time must pass). rAF only adds smoothness.
 */
(function () {
  'use strict';
  var G = window.ASP.game, R = window.ASP.render, UI = window.ASP.ui;

  function boot() {
    G.load();
    R.init(document.getElementById('view'));
    UI.init();
    G.addLog('Welcome to Amog Space Program. Rockets go up. Eventually, sideways.', 'info');
    if (G.offlineSummary) UI.toast(G.offlineSummary, 'good');
    if (G.state.won && !G.state.wonShown) UI.showWin(); // won while away
    UI.announce('aqua-1',
      '<h2>💧 A DIVINE MESSAGE</h2>' +
      '<p style="font-size:16px;line-height:1.6"><em>“Salutations, great Amog. Rejoice, for the great Aqua has heard your prayers.”</em></p>' +
      '<button id="modal-close">🙏 Rejoice</button>');

    var lastLogic = performance.now();
    var uiTimer = 0, saveTimer = 0;

    function logicTick() {
      var now = performance.now();
      var dt = Math.max((now - lastLogic) / 1000, 0);
      lastLogic = now;
      if (dt <= 0) return;

      var f = G.flight;
      if (f && f.status === 'flying') {
        // nothing left to burn -> nothing left to decide: bump the warp ONCE
        // at burnout (and again for high vacuum coasts). It's a suggestion,
        // not a floor — and the moment the player touches a warp button this
        // flight, the autopilot keeps its hands off the throttle entirely.
        var spent = f.stageIndex >= f.cfg.stages.length;
        if (spent && !G.warpTouched) {
          if (!f._warpBump1) { f._warpBump1 = true; if (G.warp < 16) G.warp = 16; }
          if (!f._warpBump2 && f.alt() > 150e3) { f._warpBump2 = true; if (G.warp < 64) G.warp = 64; }
        }
        f.advance(dt * G.warp);
        if (f.status !== 'flying') G.endFlight();
      }
      G.tick(dt);

      uiTimer += dt;
      if (uiTimer >= 1) {
        uiTimer = 0;
        // don't rebuild the panels out from under an open dropdown
        var ae = document.activeElement;
        var interacting = ae && (ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA' ||
          (ae.tagName === 'INPUT' && ae.type === 'range'));
        if (!document.hidden && !interacting) UI.refresh();
      }
      saveTimer += dt;
      if (saveTimer >= 10) { saveTimer = 0; G.save(); }
    }

    function frame(now) {
      logicTick();
      R.draw(now);
      UI.updateHud();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    setInterval(function () {
      logicTick();
      // keep the view moving even where rAF is throttled
      R.draw(performance.now());
      UI.updateHud();
    }, 250);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) G.save();
      else { logicTick(); UI.refresh(); }
    });
    window.addEventListener('beforeunload', function () { G.save(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else boot();
})();
