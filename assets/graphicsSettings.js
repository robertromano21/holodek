(function(root){
  'use strict';
  let panel,button;
  const originalRelief=Number.isFinite(root.STONEWORK_SURFACE_CLOSURE)?root.STONEWORK_SURFACE_CLOSURE:3;
  const presets={classic:{sharpness:1,relief:originalRelief,contrast:100,saturation:100,tone:''},
    engraved:{sharpness:3,relief:5,contrast:115,saturation:75,tone:''},
    moonlit:{sharpness:3,relief:3,contrast:110,saturation:65,tone:'sepia(.12) hue-rotate(155deg)'},
    lantern:{sharpness:2,relief:4,contrast:108,saturation:115,tone:'sepia(.18)'}};
  let look='classic',modern={...presets.classic};
  const nativeSizes=new WeakMap();
  function renderSize(renderer){
    const retro=root.RetroGraphics?.status?.();
    if(retro?.mode!=='modern'&&root.RetroGraphics?.sizes?.[retro?.resolution])return root.RetroGraphics.sizes[retro.resolution];
    const native=nativeSizes.get(renderer)||[160,120];
    return native.map(size=>size*modern.sharpness);
  }
  function applyToRenderer(renderer){
    if(!renderer?.canvas)return;
    // Preserve the renderer's own Modern resolution before any Retro override.
    if(!nativeSizes.has(renderer))nativeSizes.set(renderer,[renderer.canvas.width,renderer.canvas.height]);
    const [width,height]=renderSize(renderer);if(renderer.canvas.width!==width||renderer.canvas.height!==height){renderer.canvas.width=width;renderer.canvas.height=height;}
    renderer.canvas.style.filter=root.RetroGraphics?.fullbright?.()?'':
      (look==='classic'?'':`contrast(${modern.contrast}%) saturate(${modern.saturation}%) ${modern.tone}`.trim());
  }
  function setModern(name,changes){
    if(name&&!Object.hasOwn(presets,name))throw new RangeError('Unknown modern look');
    if(name){const sharpness=modern.sharpness;look=name;modern={...presets[name],sharpness};}
    if(changes){if(Object.keys(changes).some(key=>key!=='sharpness'))look='custom';for(const key of ['sharpness','relief','contrast','saturation'])if(changes[key]!==undefined){const n=Number(changes[key]);if(!Number.isFinite(n))continue;const limits={sharpness:[1,4],relief:[1,5],contrast:[50,150],saturation:[0,150]}[key];modern[key]=Math.max(limits[0],Math.min(limits[1],key==='sharpness'?Math.round(n):n));}}
    root.RetroGraphics.setMode('modern');root.GameMenuUi?.setStoneworkClosure?.(modern.relief,{persist:false});
    const renderer=root.webglDungeonRenderer?.legacyRenderer||root.webglDungeonRenderer;applyToRenderer(renderer);
    root.renderDungeonView?.();sync();
  }
  function sync(){
    if(!panel)return;
    const status=root.RetroGraphics.status();
    panel.querySelector('#graphics-retro-enabled').checked=status.mode!=='modern';
    panel.querySelector('#graphics-retro-colors').value=String(status.colors);
    panel.querySelector('#graphics-retro-size').value=status.resolution;
    panel.querySelector('#graphics-modern-look').value=look;
    panel.querySelector('#graphics-modern-resolution').value=String(modern.sharpness);
    for(const key of ['relief','contrast','saturation']){panel.querySelector('#graphics-'+key).value=String(modern[key]);panel.querySelector('#graphics-'+key+'-value').textContent=key==='sharpness'?modern[key]+'×':key==='relief'?Math.round(modern[key]*100)+'%':modern[key]+'%';}
  }
  function attach(host){
    if(button)return;
    const d=root.document;
    button=d.createElement('button');button.id='graphics-settings-toggle';button.type='button';
    button.title='Graphics settings';button.setAttribute('aria-label','Graphics settings');button.setAttribute('aria-haspopup','dialog');
    button.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true" shape-rendering="crispEdges"><path fill="currentColor" d="M2 3H18V14H11V16H15V18H5V16H9V14H2Z"/><path fill="#141210" d="M4 5H16V12H4Z"/><path fill="currentColor" d="M5 6H7V7H5ZM5 7H6V9H5Z"/></svg>';
    panel=d.createElement('dialog');panel.id='graphics-settings';panel.setAttribute('aria-labelledby','graphics-settings-title');
    panel.innerHTML='<form method="dialog"><button class="graphics-close" aria-label="Close graphics settings">×</button><h2 id="graphics-settings-title">Graphics settings</h2><label class="graphics-option"><span>Retro mode</span><input id="graphics-retro-enabled" type="checkbox"></label><label class="graphics-option" for="graphics-retro-colors"><span>Colors</span><select id="graphics-retro-colors"><option value="16">Classic · 16 colors</option><option value="32">Enhanced · 32 colors</option><option value="64">Expanded · 64 colors</option></select></label><label class="graphics-option" for="graphics-retro-size"><span>Resolution</span><select id="graphics-retro-size"><option value="cc65">320 × 200 · Original</option><option value="cc110">640 × 400 · Fine</option><option value="cc220">1280 × 800 · Ultra Fine</option></select></label><p>Choose colors and resolution independently. C64-inspired pixels, fixed palettes and stepped lighting.</p></form>';
    const section=d.createElement('section');section.innerHTML='<h3>Modern additions</h3><label class="graphics-option" for="graphics-modern-look"><span>Look</span><select id="graphics-modern-look"><option value="classic">Classic Modern (original)</option><option value="engraved">Engraved stone</option><option value="moonlit">Moonlit silver</option><option value="lantern">Amber lantern</option><option value="custom" disabled>Custom</option></select></label>'+
      [['relief','Architectural relief',1,5,.5],['contrast','Light / shadow contrast',50,150,5],['saturation','Color richness',0,150,5]].map(([key,label,min,max,step])=>'<label class="graphics-option" for="graphics-'+key+'"><span>'+label+' <output id="graphics-'+key+'-value"></output></span><input type="range" id="graphics-'+key+'" min="'+min+'" max="'+max+'" step="'+step+'"></label>').join('')+'<p>Modern resolution adds pixels independently of the look and Retro settings; relief adds depth to existing carvings. Contrast and color grade the current lighting. Higher sharpness uses more graphics power.</p>';
    const resolutionLabel=d.createElement('label');resolutionLabel.className='graphics-option';resolutionLabel.innerHTML='<span>Modern resolution</span><select id="graphics-modern-resolution"><option value="1">Original · native resolution</option><option value="2">Fine · 2× detail</option><option value="3">Extra fine · 3× detail</option><option value="4">Maximum · 4× detail</option></select>';section.querySelector('h3').after(resolutionLabel);const reset=d.createElement('button');reset.type='button';reset.id='graphics-modern-reset';reset.textContent='Reset to Classic';reset.onclick=()=>setModern('classic',{sharpness:1});section.appendChild(reset);panel.querySelector('form').appendChild(section);
    d.body.appendChild(panel);host.appendChild(button);
    button.onclick=()=>{sync();root.clearDungeonMoveKeys?.();root.setDungeonControlInput?.({forward:0,strafe:0,turn:0,run:false});panel.showModal();};
    panel.querySelector('#graphics-retro-enabled').onchange=e=>root.RetroGraphics.setMode(e.target.checked?'c64_glazed':'modern');
    panel.querySelector('#graphics-retro-colors').onchange=e=>root.RetroGraphics.setDisplay({colors:Number(e.target.value)});
    panel.querySelector('#graphics-retro-size').onchange=e=>root.RetroGraphics.setDisplay({resolution:e.target.value});
    panel.querySelector('#graphics-modern-resolution').onchange=e=>setModern(null,{sharpness:Number(e.target.value)});
    panel.querySelector('#graphics-modern-look').onchange=e=>setModern(e.target.value);
    for(const key of ['relief','contrast','saturation'])panel.querySelector('#graphics-'+key).onchange=e=>setModern(null,{[key]:Number(e.target.value)});
    panel.addEventListener('close',()=>button.focus());
    d.addEventListener('retro-display-change',sync);sync();
  }
  root.GraphicsSettings={attach,renderSize,applyToRenderer,setModern,status:()=>({look,...modern})};
})(window);
