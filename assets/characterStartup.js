(function(root) {
  'use strict';
  async function start(payload, options = {}) {
    const request = options.request || fetch;
    const pause = options.pause || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    const onResult = options.onResult || (() => {});
    const timeout = options.timeout || 10 * 60 * 1000;
    const now = options.now || Date.now;
    // world1: with the real API the first room can take minutes; one slow request (30 s abort) used to end the start with
    // "signal timed out". Each request now gets a longer window, and a timed-out/dropped POLL is retried with backoff
    // until the overall deadline (the server task keeps running). The POST is sent once and given the longest window.
    const requestTimeout = options.requestTimeout || 60000, postTimeout = options.postTimeout || 180000, maxRetries = options.maxRetries ?? 8;
    const transient = e => /timed? ?out|TimeoutError|AbortError|Failed to fetch|NetworkError|ECONNRESET|socket hang up/i.test(`${e?.name || ''} ${e?.message || e}`);
    const read = async (url, init, ms = requestTimeout) => {
      const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
      const response = await request(url, { ...init, ...(signal ? { signal } : {}) });
      const data = await response.json();
      if (!response.ok) throw Object.assign(new Error(data.error || `Startup request failed (HTTP ${response.status}).`), { status: response.status });
      return data;
    };
    if (options.signal?.aborted) throw Object.assign(new Error('Stopped before submitting startup.'), { code: 'STARTUP_WAIT_STOPPED' });
    const accepted = await read('/startGameWithCharacter', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    }, postTimeout);
    if (!accepted.taskId) throw new Error('The server did not return a startup task.');
    let noticeAt = now() + timeout, lastProgress = '';
    let retries = 0;
    while (true) {
      if (options.signal?.aborted) throw Object.assign(new Error('Stopped waiting. The server startup task may still be running; reconnect to the same task.'), { code: 'STARTUP_WAIT_STOPPED', taskId: accepted.taskId });
      let task;
      try { task = await read(`/poll-task2/${encodeURIComponent(accepted.taskId)}`); retries = 0; }
      catch (e) {
        if (e.status === 404) throw Object.assign(new Error('The server no longer has this startup task. Begin a new character review to start again; this wait did not submit another game.'),
          { code: 'STARTUP_TASK_LOST', taskId: accepted.taskId });
        if (!transient(e) || ++retries > maxRetries) throw e;
        if (typeof options.onRetry === 'function') { try { options.onRetry(retries, e); } catch {} }
        await pause(Math.min(15000, 1500 * 2 ** (retries - 1)));
        continue;
      }
      if (task.status === 'error') throw new Error(String(task.result || 'The first room could not be built.'));
      if (task.status === 'complete') {
        if (!task.result || typeof task.result.updatedGameConsole !== 'string') throw new Error('Startup completed without a game console.');
        await onResult(task.result);
        return task.result;
      }
      if (task.status !== 'processing') throw new Error('Unknown startup task status.');
      const progress = JSON.stringify([task.phase, task.progress]);
      if (progress !== lastProgress) { options.onProgress?.(task); lastProgress = progress; }
      if (now() >= noticeAt) {
        options.onWait?.({ taskId: accepted.taskId, phase: task.phase, progress: task.progress });
        noticeAt = now() + timeout;
      }
      await pause(1500);
    }
  }
  const api = { start };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CharacterStartup = api;
})(typeof window === 'undefined' ? globalThis : window);
