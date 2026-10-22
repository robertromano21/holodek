(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.PlayerControls = api; document.addEventListener('DOMContentLoaded', api.init); }
})(typeof window === 'undefined' ? globalThis : window, function(root) {
  'use strict';
  const defaults = { forward:'KeyW', backward:'KeyS', left:'KeyA', right:'KeyD', strafeLeft:'KeyQ', strafeRight:'KeyE', run:'ShiftLeft', interact:'KeyF', help:'F1', autoTake:'KeyG' };
  const labels = { forward:'Forward', backward:'Backward', left:'Turn left', right:'Turn right', strafeLeft:'Strafe left', strafeRight:'Strafe right', run:'Run', interact:'Take nearest visible item', help:'Help', autoTake:'Toggle auto-pickup' };
  let saved = {}; try { saved = JSON.parse(root.localStorage?.getItem('holodek-player-controls') || '{}') || {}; } catch {}
  let bindings = { ...defaults }, autoTake = saved.autoTake !== false, controller = saved.controller === true;
  for (const action of Object.keys(defaults)) if (/^(Key[A-Z]|Digit[0-9]|F[1-9]|F1[0-2]|ShiftLeft|ShiftRight|Space|ControlLeft)$/.test(saved.bindings?.[action] || '') &&
      !Object.keys(defaults).some(other => other !== action && (saved.bindings?.[other] || defaults[other]) === saved.bindings[action])) bindings[action] = saved.bindings[action];
  let panel, pickupButton, helpButton, capture = null, previousButtons = [], activePad = null, held = new Map();
  const movement = new Set(['forward','backward','left','right','strafeLeft','strafeRight','run']);
  function save() { try { root.localStorage?.setItem('holodek-player-controls', JSON.stringify({ bindings, autoTake, controller })); } catch {} }
  function blocked(forMovement = false) {
    const d = root.document;
    return !d || d.hidden || root.gamePaused || root._gameOver || root._characterStartupPending || root._combatCommandPending || root.actionDiceState?.active ||
      root._combatRoundActiveUntil > Date.now() || (root.GameCommandGate?.busy() && !(forMovement && (root.ItemInteractionUi?.isTaking?.() || root.RoomEntry?.walkingAllowed?.()))) || /^(INPUT|TEXTAREA|SELECT)$/.test(d.activeElement?.tagName) ||
      d.activeElement?.isContentEditable || [...d.querySelectorAll('.popup-container:not([data-dungeon-proximity]):not([data-dungeon-item-proximity]), dialog[open], #game-menu:not([hidden]), #player-help:not([hidden])')].some(node => node.getClientRects().length > 0);
  }
  function reset() { held.clear(); root.setDungeonControlInput?.({ forward:0, strafe:0, turn:0, run:false }); root.clearDungeonMoveKeys?.(); }
  function actionFor(event) {
    const arrows = { ArrowUp:'forward', ArrowDown:'backward', ArrowLeft:'left', ArrowRight:'right' };
    if (capture || panel && !panel.hidden || event.ctrlKey || event.altKey || event.metaKey) return null;
    return arrows[event.code || event.key] || Object.keys(bindings).find(action => bindings[action] === event.code) || null;
  }
  function bindKey(action, code) {
    if (['KeyP','KeyI','KeyM','KeyJ','KeyB'].includes(code)) return 'That key is reserved for an existing game shortcut.';
    if (!Object.hasOwn(defaults, action) || !/^(Key[A-Z]|Digit[0-9]|F[1-9]|F1[0-2]|ShiftLeft|ShiftRight|Space|ControlLeft)$/.test(code)) return 'Choose a letter, number, function key, Shift, Control, or Space.';
    const used = Object.keys(bindings).find(other => other !== action && bindings[other] === code);
    if (used) return 'Already bound to ' + labels[used] + '.';
    bindings[action] = code; reset(); save(); return null;
  }
  function setAutoTake(on) {
    autoTake = !!on; save(); root.ItemInteractionUi?.reset();
    if (pickupButton) { pickupButton.setAttribute('aria-pressed', String(autoTake)); pickupButton.title = 'Auto-pickup: ' + (autoTake ? 'on' : 'off'); pickupButton.setAttribute('aria-label', pickupButton.title); pickupButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true" focusable="false" shape-rendering="crispEdges"><path fill="currentColor" d="' + (autoTake ? 'M5 10V4H7V9H8V2H10V9H11V3H13V10H14V5H16V14H15V16H13V18H7V16H5V14H3V11H2V8H4V10Z' : 'M4 7H6V5H9V4H12V5H15V6H17V13H16V15H14V18H7V16H5V14H3V9H4Z') + '"/><path fill="#141210" d="' + (autoTake ? 'M7 11H8V14H7ZM10 11H11V14H10ZM13 11H14V14H13Z' : 'M6 7H7V10H6ZM9 6H10V10H9ZM12 6H13V10H12ZM5 11H13V12H6V14H5Z') + '"/></svg>'; }
  }
  function takeNearby() {
    const ctx = root.getDungeonLifeContext?.(); if (!ctx || blocked()) return;
    const items = (root.getVisibleSceneObjects?.() || []).filter(item => root.ObjectDiscovery?.isVisible(ctx.dungeon,item.name));
    const item = root.ItemInteractionUi?.nearby(ctx.dungeon, items, ctx.player, 2.5);
    if (item) return root.ItemInteractionUi.take(item.name);
  }
  function toggleHelp(on = panel?.hidden) {
    if (!panel) return; panel.hidden = !on; capture = null; reset();
    helpButton?.setAttribute('aria-expanded', String(!!on));
    if (on) panel.querySelector('button')?.focus(); else helpButton?.focus();
  }
  function perform(action) {
    if (action === 'help') return toggleHelp();
    if (blocked()) return;
    if (action === 'autoTake') setAutoTake(!autoTake);
    if (action === 'interact') takeNearby();
  }
  function padState(pad) {
    const axis = i => { const n = Number(pad?.axes?.[i]) || 0; return Math.abs(n) < .18 ? 0 : Math.max(-1,Math.min(1,n)); };
    return { forward:axis(1) ? -axis(1) : 0, strafe:axis(0), turn:axis(2), run:!!pad?.buttons?.[4]?.pressed };
  }
  function init() {
    const d = root.document;
    panel = d.createElement('section'); panel.id = 'player-help'; panel.hidden = true; panel.className = 'player-controls-dialog';
    panel.setAttribute('role','dialog'); panel.setAttribute('aria-label','Help and controls');
    panel.innerHTML = '<button type="button" class="help-close" aria-label="Close help">×</button><h2>Help & controls</h2><p>Click an item to take it. Enable the open-hand auto-pickup button to pick up visible, reachable items when you walk over them. Pickups use the same inventory rules and notices.</p><h3>Commands</h3><dl><dt>Explore</dt><dd>look · inspect [name] · read [name] · north / n · south / s · east / e · west / w · northeast / ne · northwest / nw · southeast / se · southwest / sw · up / u · down / d</dd><dt>Items</dt><dd>take [name] · take all · inventory / i · drop [name] · equip [name] · unequip [name] · drink [potion]</dd><dt>People & puzzles</dt><dd>Address characters by name. Click nearby characters and mechanisms for available actions. Read diagrams and inscriptions for puzzle instructions.</dd></dl><h3>Keyboard</h3><p>Click a binding, then press a new key. Arrow keys also move and turn. Escape cancels.</p><div class="help-bindings"></div><p class="binding-status" role="status"></p><button type="button" class="reset-bindings">Reset keys</button><h3>Controller / joystick</h3><label><input type="checkbox" class="enable-controller"> Enable controller</label><p class="controller-status" role="status"></p><p>Standard gamepad: left stick moves and strafes; right stick turns; left shoulder runs; A takes a nearby item; X opens the backpack; Y opens the map; Start opens help. Connect your controller and press a button. Other joysticks depend on their browser axis/button mapping.</p>';
    d.body.appendChild(panel);
    const renderBindings = () => {
      const list = panel.querySelector('.help-bindings'); list.replaceChildren();
      for (const action of Object.keys(defaults)) { const row = d.createElement('label'), button = d.createElement('button'); row.textContent = labels[action] + ' '; button.type='button'; button.textContent=bindings[action].replace(/^Key/,''); button.addEventListener('click',()=>{capture=action; panel.querySelector('.binding-status').textContent='Press a key for '+labels[action]+'.';}); row.appendChild(button); list.appendChild(row); }
    };
    renderBindings(); panel.querySelector('.help-close').onclick=()=>toggleHelp(false);
    panel.querySelector('.reset-bindings').onclick=()=>{bindings={...defaults};capture=null;reset();save();renderBindings();panel.querySelector('.binding-status').textContent='Default keys restored.';};
    const enabled = panel.querySelector('.enable-controller'); enabled.checked=controller; enabled.onchange=()=>{controller=enabled.checked;reset();save();};
    for (const type of ['pointerdown','pointerup','click','wheel','keyup']) panel.addEventListener(type,event=>event.stopPropagation());
    d.addEventListener('keydown',event=>{
      if (panel && !panel.hidden) {
        if (event.key==='Escape') { event.preventDefault(); event.stopImmediatePropagation(); if(capture){capture=null;panel.querySelector('.binding-status').textContent='Cancelled.';}else toggleHelp(false); return; }
        if (capture) { event.preventDefault();event.stopImmediatePropagation(); const error=bindKey(capture,event.code); panel.querySelector('.binding-status').textContent=error||'Binding saved.';if(!error){capture=null;renderBindings();}return; }
        if (event.key==='Tab') { const nodes=[...panel.querySelectorAll('button,input')];const i=nodes.indexOf(d.activeElement), next=event.shiftKey?(i<=0?nodes.length-1:i-1):(i+1)%nodes.length;event.preventDefault();nodes[next]?.focus(); }
        event.stopPropagation();return;
      }
      if (blocked()) return;
      const action=actionFor(event); if(!action)return;
      if(movement.has(action))held.set(event.code,action);
      else if(!event.repeat){event.preventDefault();event.stopImmediatePropagation();perform(action);}
    },true);
    d.addEventListener('keyup',event=>{const action=held.get(event.code);if(action){held.delete(event.code);root.releaseDungeonMoveKey?.(action);}},true);
    root.addEventListener('blur',reset);d.addEventListener('visibilitychange',()=>{if(d.hidden)reset();});
    let lastStamp=0,lastMovementBlocked=true;
    function tick(now) {
      const audio=d.getElementById('holodek-audio-panel');
      if(audio&&!pickupButton){pickupButton=d.createElement('button');pickupButton.type='button';pickupButton.id='auto-take-toggle';pickupButton.setAttribute('aria-label','Auto-pickup');pickupButton.onclick=()=>setAutoTake(!autoTake);helpButton=d.createElement('button');helpButton.id='player-help-toggle';helpButton.type='button';helpButton.textContent='?';helpButton.title='Help and controls';helpButton.setAttribute('aria-label','Help and controls');helpButton.setAttribute('aria-expanded','false');helpButton.onclick=()=>toggleHelp();audio.append(pickupButton);root.GraphicsSettings?.attach?.(audio);audio.append(helpButton);setAutoTake(autoTake);}
      if(now-lastStamp>32){lastStamp=now;const pads=controller?[...(root.navigator?.getGamepads?.()||[])].filter(Boolean):[],pad=pads.find(p=>p.index===activePad)||pads[0];
        if(pad?.index!==activePad){previousButtons=[];activePad=pad?.index??null;}
        const buttons=pad?.buttons?.map(b=>b.pressed)||[];
        if(pad&&buttons[9]&&!previousButtons[9])toggleHelp();
        const off=blocked(true);if(!off&&lastMovementBlocked&&held.size)root.resumeDungeonHeldMovement?.();lastMovementBlocked=off;root.setDungeonControlInput?.(!off&&pad?padState(pad):{forward:0,strafe:0,turn:0,run:false});
        if(!off&&pad){if(buttons[0]&&!previousButtons[0])takeNearby();if(buttons[2]&&!previousButtons[2])root.InventoryUi?.toggle();if(buttons[3]&&!previousButtons[3])root.DungeonExplorationMap?.toggle();}
        previousButtons=buttons;const status=panel.querySelector('.controller-status'),text=pad?'Connected: '+pad.id:'No controller detected.';if(status.textContent!==text)status.textContent=text;
      }
      root.requestAnimationFrame(tick);
    }
    root.requestAnimationFrame(tick);
  }
  return { heldMovement:()=>[...held.values()].filter(action=>movement.has(action)), init, actionFor, bindKey, padState, blocked, setAutoTake, autoTake:()=>autoTake, toggleHelp, takeNearby };
});
