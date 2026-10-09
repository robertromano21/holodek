(function() {
  const panel = document.createElement('section');
  panel.style.cssText = 'display:none;position:fixed;left:50%;transform:translateX(-50%);top:82px;max-width:360px;padding:12px;background:#17150fee;color:#f4e1b6;border:1px solid #ab8650;z-index:10019;font:15px Georgia,serif';
  const title = document.createElement('strong'), clue = document.createElement('p'), buttons = document.createElement('div'), status = document.createElement('p');
  status.setAttribute('role', 'status');
  panel.append(title, clue, buttons, status); document.body.appendChild(panel);
  let lastKey = '', busy = false;
  setInterval(() => {
    const d = window.currentDungeon, e = d?.livingEncounter;
    if (!e || document.hidden) { panel.style.display = 'none'; return; }
    const actor = { x: window.playerPosX, y: window.playerPosY };
    const nearby = e.fixtures.filter(f => window.LivingEnvironments.inReach(d, actor, f));
    panel.style.display = nearby.length ? '' : 'none';
    const key = `${e.id}:${e.revision}:${nearby.map(f => f.id)}:${busy}`;
    if (key === lastKey) return;
    lastKey = key;
    title.textContent = `${e.name} | ${e.status === 'complete' ? 'Complete' : `${e.progress.length}/3`}`;
    clue.textContent = e.clue;
    buttons.replaceChildren();
    for (const fixture of nearby) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = `Touch ${fixture.label}`;
      b.style.cssText = 'margin:3px;padding:8px;background:#403b2f;color:#fff0cd;border:1px solid #b99759';
      b.disabled = busy || e.status === 'complete' || !!window.actionDiceState?.active;
      b.onclick = async () => {
        if (busy) return;
        busy = true; b.disabled = true;
        try {
          const response = await fetch('/living-environment/interact', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ geoKey: d.geoKey, fixtureId: fixture.id, expectedRevision: e.revision,
              actor: { x: window.playerPosX, y: window.playerPosY } }) });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Interaction failed');
          status.textContent = result.message;
          // Replay-safe with the SSE path; also handles a missed event on this connection.
          window.applyLivingEnvironmentDelta?.(result.delta);
        } catch (err) { status.textContent = err.message; }
        finally { busy = false; lastKey = ''; }
      };
      buttons.appendChild(b);
    }
  }, 250);
})();
