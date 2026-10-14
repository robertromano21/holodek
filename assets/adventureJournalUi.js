(function(root) {
  'use strict';
  let serial = 0;
  function section(title, rows) {
    const box = document.createElement('section'), heading = document.createElement('h3');
    heading.textContent = title; box.appendChild(heading);
    for (const value of rows.length ? rows : ['Nothing recorded yet.']) {
      const p = document.createElement('p'); p.textContent = value; box.appendChild(p);
    }
    return box;
  }
  function render(data) {
    const content = document.getElementById('journal-content'); content.replaceChildren();
    const objective = data.objective;
    content.append(section('Current Adventure', [data.quest, ...(objective ? [objective.title, objective.description, objective.requirements] :
      [data.step>1?'The next quest step will be prepared on your next game command.':'Explore beyond the entrance to discover the first obligation.'])]));
    content.append(section('Planned Route', data.route.map(r => `${r.status}: ${r.room} (${r.roomKey})${r.actor ? ' - ' + r.actor : ''}`)));
    content.append(section('Confirmed Facts', data.facts.map(f => `${f.title}${f.room ? ' - ' + f.room : ''}\n${f.text}`)));
    content.append(section('Rumors', data.rumors.map(r => `${r.source}: ${r.text}\n${r.status}`)));
    content.append(section('Faction Standing', data.factions.factions.map(f => `${f.name}: ${f.standing} (${f.score > 0 ? '+' : ''}${f.score})`)));
    content.append(section('Remembered Decisions', data.factions.decisions.map(d => d.summary)));
    content.append(section('Local Contracts', data.contracts.map(c => `${c.status}: ${c.description}`)));
    content.append(section('Completed Obligations', data.history.map(h => `${h.title}: ${h.description}${h.outcome?'\n'+h.outcome:''}`)));
  }
  function position(popup) {
    if(!Number.isFinite(root.innerWidth)||!Number.isFinite(root.innerHeight))return;
    const zoom=popup.offsetWidth?popup.getBoundingClientRect().width/popup.offsetWidth:1;
    popup.style.width=Math.max(120,Math.min(620,root.innerWidth/zoom-24))+'px';
    popup.style.maxHeight=Math.max(80,root.innerHeight/zoom-24)+'px';
    popup.style.left=root.innerWidth/zoom/2+'px';popup.style.top=root.innerHeight/zoom/2+'px';
  }
  async function toggle(force) {
    const popup = document.getElementById('journal-popup'); if (!popup) return false;
    const show = typeof force === 'boolean' ? force : popup.hidden;
    popup.hidden = !show; const token = ++serial;
    for (const id of ['dungeon-journal-shortcut', 'open-journal-button']) document.getElementById(id)?.setAttribute('aria-expanded', String(show));
    if (!show) { popup.setAttribute('aria-busy', 'false'); return false; }
    position(popup);
    const runId = root.dungeonRunId, content = document.getElementById('journal-content');
    content.textContent = 'Opening the adventurers\' journal...'; popup.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch('/journal/view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId }) });
      const data = await response.json();
      if (token !== serial || runId !== root.dungeonRunId || popup.hidden) return false;
      if (!response.ok) throw Error(data.error || 'The journal is unavailable.');
      if (data.runId !== runId) throw Error('That journal belongs to another game.');
      render(data); return true;
    } catch (error) { if (token === serial) content.textContent = error.message; return false; }
    finally { if (token === serial) popup.setAttribute('aria-busy', 'false'); }
  }
  root.AdventureJournalUi = { toggle };
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('journal-close')?.addEventListener('click', () => toggle(false));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') toggle(false); });
    root.addEventListener?.('resize',()=>{const p=document.getElementById('journal-popup');if(p&&!p.hidden)position(p);});
  });
})(window);
