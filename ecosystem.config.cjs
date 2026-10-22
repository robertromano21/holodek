'use strict';
module.exports = { apps: [{
  name: 'gameServer', script: './server.js', cwd: __dirname,
  instances: 1, exec_mode: 'fork', autorestart: true,
  // Quit is deliberate, not a crash. Port conflicts must not restart-loop.
  stop_exit_codes: [0, 73], shutdown_with_message: true,
  kill_timeout: 7000, wait_ready: true, listen_timeout: 30000,
  restart_delay: 1000, max_restarts: 5,
  // Explicit opt-in: pm2 start ecosystem.config.cjs --env city_expansion.
  env_city_expansion: {
    HOLODEK_CITY_SITES: '1', HOLODEK_CITY_COMPLETE: '1',
    HOLODEK_GENRE_EXPANSION: '1', HOLODEK_ARCHITECTURE_EXPANSION: '1',
    HOLODEK_TRADE_ROUTES: '1'
  }
}] };
