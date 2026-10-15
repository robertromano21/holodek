(function (root) {
  'use strict';
  if (root.HolodekGameSession || typeof root.EventSource !== 'function') return;
  let presence;
  function connect() {
    if (!presence || presence.readyState === root.EventSource.CLOSED) {
      presence = new root.EventSource('/game/lifecycle/presence');
    }
  }
  root.HolodekGameSession = { connect };
  // Reconnect before large game scripts load so refreshing promptly cancels
  // the last-window shutdown timer.
  connect();
  root.addEventListener('pagehide', () => presence?.close());
  root.addEventListener('pageshow', connect);
})(window);
