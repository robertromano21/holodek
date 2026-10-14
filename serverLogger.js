const fs = require('node:fs');
const path = require('node:path');
const { formatWithOptions } = require('node:util');
const MAX_MESSAGE_LENGTH = 16384;
const ROUTINE_TRACE = /^(?:Processing part:|Modifiers result \(raw\):|Assistant response:|Extracted JSON:|Successfully saved to the log!|Task \d+ still processing)/;

function compactLogMessage(message, verbose = false) {
  if (verbose) return message;
  const clean = message.replace(/data:(?:image|audio)\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, '[media payload omitted]');
  if (clean.length <= MAX_MESSAGE_LENGTH) return clean;
  const note = `\n[Log truncated: ${clean.length} characters; HOLODEK_VERBOSE_LOGS=1 enables full traces]\n`;
  return clean.slice(0, MAX_MESSAGE_LENGTH - 2048 - note.length) + note + clean.slice(-2048);
}

function installServerLogger(directory = path.join(__dirname, 'logs')) {
  const logPath = path.join(directory, 'server.log');
  const methods = ['log', 'info', 'warn', 'error', 'debug'];
  const originals = Object.fromEntries(methods.map(method => [method, console[method]]));
  const verbose = process.env.HOLODEK_VERBOSE_LOGS === '1';
  let stream;
  try {
    fs.mkdirSync(directory, { recursive: true });
    stream = fs.createWriteStream(logPath, { flags: 'a' });
  } catch (error) {
    originals.error.call(console, '[ServerLog] Cannot open log file:', error.message);
    return null;
  }

  let enabled = true;
  const write = (level, message) => {
    if (!enabled) return;
    stream.write(`[${new Date().toISOString()}] [${level}] ${message}\n`);
  };
  stream.on('error', error => {
    enabled = false;
    originals.error.call(console, '[ServerLog] File logging stopped:', error.message);
  });
  for (const method of methods) {
    console[method] = (...args) => {
      if (!verbose && ['log', 'debug'].includes(method) && typeof args[0] === 'string' && ROUTINE_TRACE.test(args[0])) return;
      const raw = formatWithOptions({ colors: false }, ...args), message = compactLogMessage(raw, verbose);
      originals[method].apply(console, raw === message ? args : [message]);
      write(method, message);
    };
  }
  // Observe fatal errors without changing Node's normal exit behavior.
  const onUncaughtException = error => write('uncaughtException', compactLogMessage(formatWithOptions({ colors: false }, error), verbose));
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

module.exports = { installServerLogger, compactLogMessage, MAX_MESSAGE_LENGTH };
