(function(root) {
  'use strict';
  let menu, toggle, startedRun = null;
  const stoneworkKey='holodek.architecturalCarvings';
  const stoneworkClosureKey='holodek.stoneworkSurfaceClosure';
  const stoneworkPresetKey='holodek.stoneworkSurfacePreset',stoneworkPreset='bounded-300-v1';
  try{root.ARCHITECTURAL_CARVINGS=root.localStorage.getItem(stoneworkKey)!=='off';}catch{root.ARCHITECTURAL_CARVINGS=true;}
  root.STONEWORK_SURFACE_CLOSURE=3;
  try{
    const stored=root.localStorage.getItem(stoneworkClosureKey),value=Number(stored);
    if(root.localStorage.getItem(stoneworkPresetKey)!==stoneworkPreset){
      // Adopt the requested default once; retain subsequent explicit experiments.
      root.localStorage.setItem(stoneworkClosureKey,'3');root.localStorage.setItem(stoneworkPresetKey,stoneworkPreset);
    }else if(stored!=null&&stored!==''&&Number.isFinite(value))root.STONEWORK_SURFACE_CLOSURE=Math.max(0,Math.min(5,value));
  }catch{}
  function updateStoneworkButton(){
    const button=document.getElementById('carved-stonework-toggle');if(!button)return;
    button.textContent='Carved Stonework: '+(root.ARCHITECTURAL_CARVINGS?'ON':'OFF');
    button.setAttribute('aria-pressed',String(root.ARCHITECTURAL_CARVINGS));
  }
  function setStonework(enabled){
    root.ARCHITECTURAL_CARVINGS=!!enabled;
    try{root.localStorage.setItem(stoneworkKey,enabled?'on':'off');}catch{}
    // The renderer's per-piece cache key changes with this flag; plain pieces stay cached.
    updateStoneworkButton();
    refreshStonework();
  }
  function updateStoneworkClosureButton(){
    const button=document.getElementById('stonework-fill-toggle');if(!button)return;
    button.textContent='Stonework Relief: '+Math.round(root.STONEWORK_SURFACE_CLOSURE*100)+'%';
  }
  function setStoneworkClosure(value){
    root.STONEWORK_SURFACE_CLOSURE=Number.isFinite(value)?Math.max(0,Math.min(5,value)):3;
    try{root.localStorage.setItem(stoneworkClosureKey,String(root.STONEWORK_SURFACE_CLOSURE));}catch{}
    updateStoneworkClosureButton();
    refreshStonework();
    return root.STONEWORK_SURFACE_CLOSURE;
  }
  function getStoneworkStatus(){
    const dungeon=root.currentDungeon,C=root.StoneCarvings,used=new Map(),excludedByMaterial={};
    for(const cell of Object.values(dungeon?.cells||{}))if(cell?.tile)used.set(cell.tile,(used.get(cell.tile)||0)+1);
    for(const part of dungeon?.sceneStructures||[])if(part?.tile)used.set(part.tile,(used.get(part.tile)||0)+1);
    let compatibleInstances=0;const carvingRegions={};
    for(const[tile,count]of used){
      const spec=dungeon.tiles?.[tile]?.spriteSpec;
      const carving=C?.resolveVoxelDescriptor(spec,tile);
      if(carving){compatibleInstances+=count;carvingRegions[carving.region]=(carvingRegions[carving.region]||0)+count;}
      else if(C?.voxelShapes?.includes(spec?.voxelShape)){
        const material=spec.material||'unspecified';excludedByMaterial[material]=(excludedByMaterial[material]||0)+count;
      }
    }
    const renderer=root.webglDungeonRenderer?.legacyRenderer||root.webglDungeonRenderer;
    const cachedPercentages=[...new Set(Object.values(renderer?.voxelMeshes||{}).map(mesh=>
      mesh._debugKey?.match(/\|closure:([\d.]+)\|/)?.[1]).filter(Boolean).map(value=>Number(value)*100))];
    return{enabled:root.ARCHITECTURAL_CARVINGS!==false,percent:root.STONEWORK_SURFACE_CLOSURE*100,
      baseSurfacePercent:Math.min(1,root.STONEWORK_SURFACE_CLOSURE)*100,reliefScope:'carving-fields',carvingRegions,
      ridgeCodeReady:typeof C?.ridgeMesh==='function',compatibleInstances,excludedByMaterial,cachedPercentages};
  }
  function refreshStonework(){
    // A still or paused room may not schedule another frame on its own.
    if(root.currentDungeon){
      if(typeof root.renderDungeonView==='function')root.renderDungeonView();
      else if(root.webglDungeonRenderer?.gl)root.webglDungeonRenderer.renderScene?.();
    }
    root.console?.info?.('[StoneworkSettings]',getStoneworkStatus());
  }
  function setOpen(open, focus = false) {
    if (!menu || !toggle) return;
    menu.hidden = !open;
    if(open)fit();
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close game menu' : 'Open game menu');
    if (focus) toggle.focus();
  }
  function fit() {
    if (!menu || !toggle) return;
    const bounds = toggle.getBoundingClientRect(), zoom = toggle.offsetWidth ? bounds.width / toggle.offsetWidth : 1;
    menu.style.width = Math.max(130, Math.min(195, root.innerWidth / zoom - 20)) + 'px';
    menu.style.top = bounds.bottom / zoom + 4 + 'px';
    menu.style.maxHeight = Math.max(80, root.innerHeight / zoom - parseFloat(menu.style.top) - 8) + 'px';
  }
  function init() {
    menu = document.getElementById('game-menu'); toggle = document.getElementById('game-menu-toggle');
    if (!menu || !toggle) return;
    document.getElementById('carved-stonework-toggle')?.addEventListener('click',()=>setStonework(!root.ARCHITECTURAL_CARVINGS));
    document.getElementById('stonework-fill-toggle')?.addEventListener('click',()=>setStoneworkClosure(
      [0,.5,1,3,5].find(value=>value>root.STONEWORK_SURFACE_CLOSURE)??0));
    updateStoneworkButton();
    updateStoneworkClosureButton();
    for (const id of ['combat-mode-toggle', 'open-combat-button', 'open-dungeon-button', 'dungeon-test-button', 'play-music-btn']) {
      const control = document.getElementById(id);
      if (!control) continue;
      control.style.position = 'static';
      control.style.top = control.style.left = control.style.right = control.style.bottom = 'auto';
      menu.appendChild(control);
    }
    toggle.addEventListener('click', () => setOpen(menu.hidden));
    menu.addEventListener('click', event => { if (event.target.closest('button')) setOpen(false); });
    document.addEventListener('pointerdown', event => { if (!menu.contains(event.target) && !toggle.contains(event.target)) setOpen(false); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) setOpen(false, true); });
    root.addEventListener('resize', fit);
    setOpen(false); fit();
  }
  function onDungeonReady(dungeon) {
    const runId = root.dungeonRunId;
    if (!runId || startedRun === runId || !dungeon?.cells || !dungeon.layout ||
        dungeon._meta?.runId && dungeon._meta.runId !== runId) return;
    const startCell = dungeon.cells[`${dungeon.start?.x},${dungeon.start?.y}`];
    if (!startCell || startCell.tile === 'wall' || startCell.tile === 'torch') return;
    const controls = [['phaser-popup', 'togglePopup'], ['game-log-popup', 'toggleGameLogPopup']];
    if (document.getElementById('combat-mode-select')?.value !== 'No Combat Map') controls.push(['combat-popup', 'toggleCombatPopup']);
    if (controls.some(([id, action]) => !document.getElementById(id) || typeof root[action] !== 'function')) return;
    startedRun = runId;
    for (const [id, action] of controls) if (document.getElementById(id).style.display !== 'block') root[action]();
  }
  root.GameMenuUi = { onDungeonReady, setOpen, setStonework, setStoneworkClosure, getStoneworkStatus };
  document.addEventListener('DOMContentLoaded', init);
})(window);
