(function(root) {
  'use strict';
  async function start(payload, options = {}) {
    const request = options.request || fetch;
    const pause = options.pause || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    const onResult = options.onResult || (() => {});
    const timeout = options.timeout || 10 * 60 * 1000;
    const now = options.now || Date.now;
    const read = async (url, init) => {
      const response = await request(url, { ...init, signal: AbortSignal.timeout(30000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Startup request failed (HTTP ${response.status}).`);
      return data;
    };
    const accepted = await read('/startGameWithCharacter', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    if (!accepted.taskId) throw new Error('The server did not return a startup task.');
    const deadline = now() + timeout;
    while (now() < deadline) {
      const task = await read(`/poll-task2/${encodeURIComponent(accepted.taskId)}`);
      if (task.status === 'error') throw new Error(String(task.result || 'The first room could not be built.'));
      if (task.status === 'complete') {
        if (!task.result || typeof task.result.updatedGameConsole !== 'string') throw new Error('Startup completed without a game console.');
        await onResult(task.result);
        return task.result;
      }
      if (task.status !== 'processing') throw new Error('Unknown startup task status.');
      await pause(1500);
    }
    throw new Error('The first room is taking too long to build. Check the server log before starting again.');
  }
  const api = { start };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CharacterStartup = api;
})(typeof window === 'undefined' ? globalThis : window);
