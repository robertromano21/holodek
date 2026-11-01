(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.UrbanDesigns=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  // Heights are world units; low-rise cultures keep their own scale, not a reskinned skyscraper.
  const PROFILES={
    fantasy:[6,13,3,'turreted ward'], 'dark-fantasy':[7,16,5,'ossuary citadel'], mythic:[6,14,6,'terraced acropolis'],
    'sci-fi':[22,48,4,'ribbed habitat stack'], cyberpunk:[26,58,7,'layered neon arcology'],
    'post-apocalyptic':[6,13,3,'patched salvage block'], steampunk:[12,26,5,'foundry terrace'], western:[4,7,2,'boardwalk frontage'],
    modern:[18,40,4,'setback urban tower'], noir:[14,32,6,'deco crown block'], nautical:[6,14,3,'timbered harbor terrace'],
    'cosmic-horror':[7,18,5,'crooked tidal quarter'], 'gothic-horror':[9,24,7,'pinnacled cathedral ward'],
    solarpunk:[16,34,5,'planted canopy stack'], dieselpunk:[16,36,4,'armored industrial terrace'],
    underwater:[16,32,6,'pressure-shell reef stack'], prehistoric:[3,5,2,'lashed hearth cluster'],
    'desert-fantasy':[7,17,5,'windcatcher courtyard block']
  };
  const SHAPES={};
  for(const [genre,[low,high,rhythm,style]] of Object.entries(PROFILES))for(const [i,role] of ['midrise','skyline','terrace'].entries())
    SHAPES[`a_${genre}_urban_${role}`]={genre,role,urban:true,architecturalDesign:true,cotg:['fantasy','dark-fantasy','mythic'].includes(genre),
      footprint:role==='terrace'?[5,4]:[3,3],height:role==='skyline'?high:role==='terrace'?low*.7:low,rhythm,style,label:style+' '+role};
  const has=id=>Object.hasOwn(SHAPES,id);
  function scale(city={},genre='fantasy'){
    if(['outpost','village','town','city','metropolis'].includes(city.scale))return city.scale;
    if(/outpost|village|hamlet/i.test(city.role||''))return 'village';
    const n=Number(city.population)||0;
    return n>=100000||n>=10000&&['sci-fi','cyberpunk','modern','solarpunk','dieselpunk','underwater'].includes(genre)?'metropolis':n>=6000?'city':'town';
  }
  function build(id,n=24){
    if(!has(id)||!Number.isInteger(n)||n<8||n>64)return null;
    const d=SHAPES[id],index=Object.keys(PROFILES).indexOf(d.genre),v=new Uint8Array(n**3);
    const tech=['sci-fi','cyberpunk','modern','dieselpunk','underwater'].includes(d.genre),timber=['western','nautical','prehistoric'].includes(d.genre);
    for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++){
      const u=(x+.5)/n,w=(y+.5)/n,h=(z+.5)/n,stage=Math.floor(h*(d.role==='terrace'?3:5));
      const setback=d.role==='terrace'?stage*.065:d.role==='skyline'?Math.max(0,stage-1)*.035:0;
      const half=.43-setback,offset=d.genre==='cosmic-horror'?(h-.5)*.12:0;
      let on=Math.abs(u-.5-offset)<half&&Math.abs(w-.5)<half&&h<.90;
      const ax=Math.abs(u-.5),ay=Math.abs(w-.5),ring=Math.hypot(u-.5,w-.5),tower=d.role==='skyline',terraced=d.role==='terrace';
      switch(d.genre){
        case 'fantasy': {
          const turret=[[.17,.17],[.83,.17],[.17,.83],[.83,.83]].some(([a,b])=>Math.hypot(u-a,w-b)<.14);
          on=h<.66&&ax<half&&ay<half||turret&&h<.92||h>.66&&h<.76&&(ax>.30||ay>.30)&&ax<.44&&ay<.44&&Math.floor((u+w)*n)%5<3;
          break;
        }
        case 'dark-fantasy':on=ax<half*.9&&ay<half&&h<.72||ax<.14&&ay<.30&&h<.98||ax>.28&&ax<.41&&ay<.14&&h<.85;break;
        case 'mythic':on=ax<half&&ay<half&&h>.22&&h<.68||h<.22&&ax<.46&&ay<.40&&(Math.floor(u*n)%4===0||ay>.28)||h>=.68&&h<.96-ay*.55&&ax<.46;break;
        case 'sci-fi':on=ax<half&&ay<half&&ax+ay<half*1.55&&h<.90;break;
        case 'cyberpunk':on=h<.22&&ax<.46&&ay<.46||u>.08&&u<(terraced?.36:.42)&&w>.14&&w<.88&&h<.96||u>.56&&u<.90&&w>.08&&w<.75&&h<.80||h>.48&&h<.59&&u>.30&&u<.73&&ay<.15;break;
        case 'post-apocalyptic':on=ax<half&&ay<half&&h<.65+.18*Math.sin(u*19+w*7)||h>.65&&h<.95&&u>.15&&u<.22&&ay<.10;break;
        case 'steampunk':on=ax<half&&ay<half&&h<.70||u>.18&&u<.31&&ay<.13&&h<.98||u>.68&&u<.79&&w>.27&&w<.43&&h<.91;break;
        case 'western':on=ax<half&&w>.24&&w<.88&&h<.80-ay*.25||ax<.46&&w>.15&&w<.25&&h<.89||h<.45&&w>.05&&w<.15&&ax<.43&&Math.floor(u*n)%5===0;break;
        case 'modern':on=u>.12&&u<.47&&w>.11&&w<.86&&h<.94||u>.47&&u<.88&&w>.20&&w<.74&&h<.70||h>.52&&h<.64&&ax<.47&&ay<.46;break;
        case 'noir':on=ax<.46-Math.floor(h*(terraced?4:6))*.055&&ay<.43-Math.floor(h*(terraced?4:6))*.035&&h<.96;break;
        case 'nautical':on=h>.22&&ax<half&&ay<half&&h<.78||h<.24&&ax<.42&&ay<.42&&(Math.floor(u*n)%6===0||Math.floor(w*n)%6===0);break;
        case 'cosmic-horror':on=Math.hypot((u-.5-offset)*1.1,w-.5)<half&&h<.91||ax<.045&&ay<.045&&h>.8;break;
        case 'gothic-horror':on=ax<half*.82&&ay<half&&h<.72||ax<.35&&ay<.31&&h>.65&&h<.99-ax*.7||ax>.29&&ax<.40&&ay<.14&&h<.95;break;
        case 'solarpunk':on=ring<half&&h<.85||courseBand(h,n,d.rhythm)&&ring<half+.075&&h<.90;break;
        case 'dieselpunk':on=ax<half&&ay<half&&h<.76||Math.hypot(u-.20,w-.30)<.105&&h<.98||u>.61&&u<.79&&w>.51&&w<.77&&h<.94;break;
        case 'underwater':on=ring<half&&h<.73||ring<half&&h>=.73&&h<.73+Math.sqrt(Math.max(0,half*half-ring*ring))*.6;break;
        case 'prehistoric': {
          const sites=terraced?[[.28,.30],[.70,.65],[.25,.76]]:tower?[[.32,.50],[.72,.40]]:[[.5,.5]];
          on=sites.some(([a,b])=>{const r=Math.hypot(u-a,w-b),size=sites.length===1?.42:.24;return h<.48&&r<size&&r>size-.065||h>=.48&&h<.97-r*(.48/size)&&r<size;});break;
        }
        case 'desert-fantasy':on=ax<half&&ay<half&&!(ax<.17&&ay<.17)&&h<.68||u>.13&&u<.31&&w>.13&&w<.31&&h<.97||u>.69&&u<.86&&w>.66&&w<.86&&h<.88;break;
      }
      // Recessed windows, floor bands and actual roof furniture survive voxel quantization.
      const front=Math.abs(w-.5)>half-.065,side=Math.abs(u-.5-offset)>half-.065;
      const course=Math.floor(h*n)%Math.max(3,d.rhythm),window=Math.floor(u*n+index)%4<2;
      if(d.genre!=='prehistoric'&&on&&h>.15&&h<.83&&course===1&&(front&&window||side&&Math.floor(w*n+index)%4<2))on=false;
      if(h<.16&&Math.abs(u-.5)<.14&&w<.35)on=false;
      if(h>=.90&&['sci-fi','modern','noir'].includes(d.genre)){
        if(timber)on=Math.abs(w-.5)<(1-h)*3.8&&Math.abs(u-.5)<.47;
        else if(tech)on=h<.96&&Math.abs(u-.5)<.12+index*.002&&Math.abs(w-.5)<.26||d.role==='skyline'&&Math.abs(u-.68)<.025&&Math.abs(w-.60)<.025;
        else on=Math.abs(u-.5)<.33&&Math.abs(w-.5)<.33&&h<.94||Math.abs(u-.5)<.06&&Math.abs(w-.5)<.06;
      }
      if(['western','nautical'].includes(d.genre)&&h>.67&&w>.22&&w<.90&&ax<half)on=h<.98-Math.abs(w-.56)*.75;
      if(d.genre==='solarpunk'&&h>.2&&h<.87&&course===0&&Math.abs(u-.5)<half+.05&&Math.abs(w-.5)<half+.05)on=true;
      if(d.genre==='underwater'&&on&&(u<.1||u>.9)&&(w<.1||w>.9))on=false;
      if(d.genre==='post-apocalyptic'&&on&&h>.4&&Math.floor(u*n+w*n+h*n)%13===0)on=false;
      if(d.genre==='desert-fantasy'&&h>.72&&Math.abs(u-.5)<.075&&Math.abs(w-.5)<.28)on=false;
      // Genre-specific rib positions make equal-purpose silhouettes physically distinct.
      if(tech&&h<.82&&Math.floor(u*n)===2+index%n&&Math.abs(w-.5)<.47&&h>.1)on=true;
      if(on)v[x+y*n+z*n*n]=1;
    }
    return v;
  }
  function courseBand(h,n,rhythm){return Math.floor(h*n)%Math.max(3,rhythm)===0;}
  function color(id,x,y,z,normal,palette){
    const d=SHAPES[id];if(!d)return null;
    const p=palette||['#58646e','#27343c','#91cddd','#172028'];
    const band=Math.floor(z*24)%Math.max(3,d.rhythm)===0;
    const hex=p[z>.88||band?2:z<.15?1:0];return[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
  }
  return{PROFILES,SHAPES,has,scale,build,color};
});
