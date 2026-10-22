'use strict';
const path = require('node:path');
const Website = require('../../retort/websiteAi');
(async () => {
  const service = Website.service(), mode = process.argv[2] || 'status';
  if (mode === 'key') return console.log(JSON.stringify({ publicKey: await service.publicKey() }));
  if (mode === 'deploy' || mode === 'connect' || mode === 'activate') {
    const settings = mode === 'activate' ? { ...service.view(), enabled: true, background: true, useForGameModels: true } : service.view();
    return console.log(JSON.stringify(await service.connect(settings, { deploy: mode !== 'connect' })));
  }
  if (mode === 'status') return console.log(JSON.stringify(await service.status()));
  if (mode === 'inspect') {
    // Operator diagnostics only; no arbitrary commands and no environment dumps.
    const fs = require('node:fs'), os = require('node:os');
    const dir = process.env.HOLODEK_WEBSITE_AI_DIR || path.resolve(__dirname, '../../.retort-data/website-ai');
    const c = JSON.parse(fs.readFileSync(path.join(dir, 'connection.json'), 'utf8'));
    const args = ['-T', '-i', c.identityFile || path.join(dir, 'identity_ed25519'), '-p', String(c.sshPort || 22),
      '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
      '-o', 'UserKnownHostsFile=' + path.join(os.homedir(), '.ssh/known_hosts'), '-o', 'ConnectTimeout=10',
      c.username + '@' + c.host, 'sh -s'];
    const exe = process.platform === 'win32' ? path.join(process.env.WINDIR, 'System32/OpenSSH/ssh.exe') : 'ssh';
    console.log(await Website.launch(exe, args, { input: 'id\ncommand -v node\ncommand -v npm\ncommand -v pm2\n', timeout: 20000 })); return;
  }
  throw Error('Use status, key, inspect, connect, deploy or activate.');
})().catch(e => { console.error(e.message); process.exitCode = 1; });
