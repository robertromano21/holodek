(function(root) {
  'use strict';
  let panel, title, subtitle, portrait, room = null, roomAnnounced = false, until = 0, active = false, lastPreview = '', previewAt = 0;
  const queue = [], noticed = new Set();
  function enqueue(event) {
    queue.push(event);
    if (queue.length > 32) {
      const optional = queue.findIndex(row => !row.icon);
      queue.splice(optional < 0 ? 0 : optional, 1);
    }
  }
  let pausedAt = null;
  const fallbackIcon = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 64"><path fill="#d8bc7a" d="M16 4h16v8h6v16h-6v8h8v8h4v16H4V44h4v-8h8v-8h-6V12h6z"/><path fill="#30251c" d="M18 16h12v8H18zM20 38h8v22h-8z"/></svg>');
  function iconFor(actor) {
    return actor?.sprite?.dataUrl || root.resolveKnownCharacterSprite?.(actor?.name)?.dataUrl || fallbackIcon;
  }
  function show(name, kind = 'Landmark', duration = 5000, icon = '') {
    if (!panel || !name) return;
    title.textContent = String(name).slice(0, 100); subtitle.textContent = kind;
    portrait.hidden = !icon; portrait.src = icon || '';
    panel.hidden = false; active = true; until = Date.now() + duration;
    panel.classList.remove('area-title-enter'); void panel.offsetWidth; panel.classList.add('area-title-enter');
  }
  function notice(event) {
    if (!event?.id || noticed.has(event.id)) return;
    noticed.add(event.id); if (noticed.size > 80) noticed.delete(noticed.values().next().value);
    enqueue({ name: event.text, kind: 'Nearby', duration: 6500 });
  }
  function preview(marker) {
    if (!marker || root.gamePaused || marker.id === lastPreview && Date.now() - previewAt < 5000) return;
    const actor = root.getDungeonLifeContext?.()?.actors?.find(a => a.name === marker.name);
    lastPreview = marker.id; previewAt = Date.now();
    show(marker.label, marker.kind === 'encounter' ? `${marker.allegiance} Encounter - Last Seen` : 'Known Landmark', 3500,
      marker.kind === 'encounter' ? iconFor(actor) : '');
  }
  function encounter(actor) {
    enqueue({ name: actor.name, kind: `Encounter Discovered - ${actor.allegiance || actor.state || 'Neutral'}`,
      duration: 5000, icon: iconFor(actor) });
  }
  function update(ctx) {
    if (!ctx?.dungeon || !ctx.player || !panel) return;
    const key = `${root.dungeonRunId}:${ctx.dungeon.geoKey}`;
    if (room !== key) {
      room = key; roomAnnounced = false; queue.length = 0; noticed.clear(); active = false;
      panel.hidden = true; lastPreview = '';
    }
    if (!roomAnnounced) {
      const name = ctx.roomName || ctx.dungeon.sceneSpec?.source?.roomName || ctx.dungeon.spec?.source?.roomName;
      if (typeof name === 'string' && name.trim()) {
        show(name.trim(), 'Entering', 5500); roomAnnounced = true;
      }
    }
    if (root.gamePaused) { pausedAt ??= Date.now(); return; }
    if (pausedAt !== null) { until += Date.now() - pausedAt; pausedAt = null; }
    if (active && Date.now() >= until) { active = false; panel.hidden = true; }
    if (root.DungeonExplorationMap?.ready?.(ctx.dungeon.geoKey)) for (const m of root.LandmarkCatalog?.catalog(ctx.dungeon) || []) {
      if (root.DungeonExplorationMap.wasAnnounced(m.id) || Math.hypot(m.x - ctx.player.x, m.y - ctx.player.y) > 10 ||
          !root.DungeonCartography.visible(ctx.dungeon, ctx.player, Math.floor(m.x), Math.floor(m.y))) continue;
      root.DungeonExplorationMap.markLandmark(m.id, true);
      enqueue({ name: m.label, kind: 'Landmark Discovered', duration: 5000 });
    }
    if (!active && queue.length) { const next = queue.shift(); show(next.name, next.kind, next.duration, next.icon); }
  }
  function reset() {
    room = null; roomAnnounced = false; queue.length = 0; noticed.clear(); active = false; lastPreview = '';
    pausedAt = null;
    if (panel) panel.hidden = true;
  }
  function init() {
    const style = document.createElement('style');
    style.textContent = '#dungeon-area-title{position:fixed;z-index:2050;top:19%;left:50%;transform:translateX(-50%);width:min(620px,80vw);text-align:center;pointer-events:none;color:#f2dfb4;text-shadow:0 2px 5px #000,0 0 18px #000;background:radial-gradient(ellipse,rgba(0,0,0,.45),transparent 70%);padding:20px 12px;font-family:Georgia,serif}#dungeon-area-title[hidden],#dungeon-area-title img[hidden]{display:none}#dungeon-area-title img{width:54px;height:72px;object-fit:contain;image-rendering:pixelated;margin-top:10px}#dungeon-area-title small{display:block;font-size:12px;letter-spacing:.25em;text-transform:uppercase;margin-bottom:10px}#dungeon-area-title strong{display:block;font-size:clamp(22px,3vw,38px);font-weight:normal;letter-spacing:.045em;line-height:1.25}.area-title-enter{animation:area-title-reveal 1.2s ease-out}@keyframes area-title-reveal{from{opacity:0;filter:blur(3px)}to{opacity:1;filter:blur(0)}}@media(prefers-reduced-motion:reduce){.area-title-enter{animation:none}}';
    document.head.appendChild(style);
    panel = document.createElement('div'); panel.id = 'dungeon-area-title'; panel.hidden = true;
    panel.setAttribute('role', 'status'); panel.setAttribute('aria-live', 'polite');
    subtitle = document.createElement('small'); title = document.createElement('strong');
    portrait = document.createElement('img'); portrait.alt = ''; portrait.hidden = true;
    panel.append(subtitle, title, portrait); document.body.appendChild(panel);
  }
  root.DungeonAreaTitles = { update, preview, notice, encounter, reset };
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);
})(typeof window === 'undefined' ? globalThis : window);
