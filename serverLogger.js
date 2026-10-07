const fs = require('node:fs');
const path = require('node:path');
const { formatWithOptions } = require('node:util');

function installServerLogger(directory = path.join(__dirname, 'logs')) {
  const logPath = path.join(directory, 'server.log');
  const methods = ['log', 'info', 'warn', 'error', 'debug'];
  const originals = Object.fromEntries(methods.map(method => [method, console[method]]));
  let stream;
  try {
    fs.mkdirSync(directory, { recursive: true });
    stream = fs.createWriteStream(logPath, { flags: 'a' });
  } catch (error) {
    originals.error.call(console, '[ServerLog] Cannot open log file:', error.message);
    return null;
  }

  let enabled = true;
  const write = (level, args) => {
    if (!enabled) return;
    const message = formatWithOptions({ colors: false }, ...args);
    stream.write(`[${new Date().toISOString()}] [${level}] ${message}\n`);
  };
  stream.on('error', error => {
    enabled = false;
    originals.error.call(console, '[ServerLog] File logging stopped:', error.message);
  });
  for (const method of methods) {
    console[method] = (...args) => {
      originals[method].apply(console, args);
      write(method, args);
    };
  }
  // Observe fatal errors without changing Node's normal exit behavior.
  const onUncaughtException = error => write('uncaughtException', [error]);
  process.on('uncaughtExceptionMonitor', onUncaughtException);
  console.info(`[ServerLog] Session started (pid ${process.pid}); live log: ${logPath}`);

  return {
    logPath,
    close() {
      for (const method of methods) console[method] = originals[method];
      process.removeListener('uncaughtExceptionMonitor', onUncaughtException);
      enabled = false;
      return new Promise(resolve => stream.end(resolve));
    }
  };
}

module.exports = { installServerLogger };
