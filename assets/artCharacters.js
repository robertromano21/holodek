(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./shrineIconography'):root.ShrineIconography,
    typeof module==='object'&&module.exports?require('./renderCharacterProcedural'):root.ProceduralCharacters);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ArtCharacters=api;
})(typeof window==='undefined'?globalThis:window,function(Icons,Characters){
  'use strict';
  // The core choices mirror the starting-character tables, without altering gameplay rules.
  const races=['Human','Dwarf','High Elf','Unseelie Elf','Half-Elf','Halfling','Fey','Raakshasa','Gnome'];
  const creatures=['Dragon','Dragonborn','Skeleton','Wraith','Angel','Demon','Orc','Goblin','Minotaur','Giant','Naga','Gargoyle','Dryad',
    'Kobold','Troll','Lich','Vampire','Harpy','Phoenix'];
  const classes={
    'Knight of Atinus':{attribute:'sword',patron:'Atinus'},'Knight of Atricles':{attribute:'sword',patron:'Atricles'},
    Wizard:{attribute:'book',patron:'Eredine'},Witch:{attribute:'staff',patron:'Dyanetzia'},Necromancer:{attribute:'scroll',patron:'Mortacia'},
    Warlock:{attribute:'orb'},Sorcerer:{attribute:'staff',patron:'Eredine'},Thief:{attribute:'dagger'},Assassin:{attribute:'dagger'},
    Barbarian:{attribute:'club'},'Assassin-Fighter-Necromancer-Goddess':{attribute:'scythe',patron:'Mortacia'}
  };
  const occupations={Druid:{attribute:'staff',patron:'Dyanetzia'},Ranger:{attribute:'bow',patron:'Leona'},Bard:{attribute:'lyre',patron:'Musydius'},
    Paladin:{attribute:'halberd',patron:'Urthur'},Priest:{attribute:'bowl'},Scholar:{attribute:'book',patron:'Turthus'},
    Mason:{attribute:'pick',patron:'Mordicar'},Alchemist:{attribute:'bowl',patron:'Rama'},
    Scribe:{attribute:'scroll',patron:'Turthus',style:'robe'},Healer:{attribute:'bowl',style:'robe'},Pilgrim:{attribute:'staff',style:'mantle'},
    Messenger:{attribute:'scroll',style:'leather'},Boatman:{attribute:'staff',patron:'Neptar',style:'leather'},
    Mourner:{attribute:'bowl',patron:'Mortacia',style:'robe'},Smith:{attribute:'pick',patron:'Llellwyth',style:'leather'},
    StandardBearer:{attribute:'spear',style:'mail'}};
  const attributes=['none','staff','sword','shield','scroll','book','bowl','torch','orb','scales','hourglass',
    'scythe','dagger','catapult','gauntlet','club','net','spear','pick','sling','harpoon','bow','lance','whip','sickle','mace','halberd','chain','lyre'];
  const scale=raw=>({Dwarf:.8,Halfling:.65,Gnome:.68,Fey:.62,Goblin:.7,Giant:1.1}[raw.race]||1);
  const votaries={Mortacia:['Necromancer','Human'],Atinus:['Knight of Atinus','Human'],Atricles:['Knight of Atricles','Human'],
    Arithus:['Assassin','Demon'],Dantuea:['Necromancer','Raakshasa'],Dyanetzia:['Witch','Druid','High Elf'],Eredine:['Wizard','Sorcerer','High Elf'],
    Leona:['Ranger','Dryad'],Mordicar:['Dwarf','Mason'],Musydius:['Bard','Human'],Rama:['Alchemist','Gnome'],Urthur:['Paladin','Dragonborn'],
    Turthus:['Scholar','Gnome'],Uceracea:['Ranger','High Elf'],Poena:['Human','Bard'],Llellwyth:['Mason','Human']};
  function lookup(value,rows){return rows.find(n=>n.toLowerCase()===String(value||'').trim().toLowerCase())||null;}
  function race(value){return lookup(value,[...races,...creatures]);}
  function role(value){return lookup(value,Object.keys({...classes,...occupations}));}
  function hero(value){return lookup(value,['Suzerain']);}
  function validate(raw={}){
    if(raw.race!==undefined&&!race(raw.race)||raw.className!==undefined&&!role(raw.className)||
      raw.patron!==undefined&&!Icons.name(raw.patron)||raw.sex!==undefined&&!['Male','Female','Neutral'].includes(raw.sex))throw Error('Invalid depicted race, class, patron or sex.');
    return{...(raw.race!==undefined?{race:race(raw.race)}:{}),...(raw.className!==undefined?{className:role(raw.className)}:{}),
      ...(raw.patron!==undefined?{patron:Icons.name(raw.patron)}:{}),...(raw.sex!==undefined?{sex:raw.sex}:{})};
  }
  function defaults(raw={}){
    const def=classes[raw.className]||occupations[raw.className]||{};
    return{attribute:def.attribute||'none',patron:raw.patron||def.patron||null};
  }
  function characterSpec(raw={},palette={}){
    if(hero(raw.subject)){
      const preset=Characters.getPresetProceduralSpec('Suzerain'),traits=JSON.parse(JSON.stringify(preset.traits));
      traits.items=[];traits.handGlow=false;traits.aura.strength=0;
      return Characters.buildProceduralSpriteSpec({name:'Suzerain',race:'Human',class:'Knight of Atinus',sex:'Male',level:20},traits,
        {signature:false,source:'depicted-character',salt:preset.seed});
    }
    const sheet={name:raw.label||[raw.race||'Human',raw.className||'ancestor'].join(' '),race:raw.race||'Human',class:raw.className||'Scholar',sex:raw.sex||'Neutral',level:1};
    const t=Characters.deriveFallbackTraits(sheet),patron=defaults(raw).patron;
    const costume=occupations[sheet.class]?.style;
    if(costume)t.outfit.style=costume==='mantle'?'cloak':costume;
    // These two core names lack a physical definition in the character word interpreter.
    // Fey uses its existing fae geometry; Raakshasa keeps the campaign's humanoid fallback.
    if(sheet.race==='Fey')Object.assign(t,{ears:'pointed',wings:'insect',size:'tiny'});
    t.items=[];t.handGlow=false;t.aura.strength=0;
    t.palette={...t.palette,outfit:palette.primary||t.palette.outfit,outfit2:palette.shadow||t.palette.outfit2,
      trim:patron?Icons.pantheon[patron].color:palette.highlight||t.palette.trim};
    const identity={...raw};delete identity.proportions;
    return Characters.buildProceduralSpriteSpec(sheet,t,{signature:false,source:'depicted-character',salt:Characters.hashString(JSON.stringify(identity))});
  }
  function form(raw){
    if(!raw.race)return'human';
    return{draconic:'dragon',skeletal:'skeleton',spectral:'wraith'}[characterSpec(raw).traits.bodyPlan]||
      (raw.race==='Angel'?'angel':raw.race==='Demon'?'demon':'human');
  }
  function motifs(text){
    const source=String(text||'').toLowerCase();
    return['Suzerain',...Object.keys(classes),...Object.keys(occupations),...races,...creatures]
      .filter(n=>n.length<=28&&new RegExp('\\b'+n.toLowerCase()+'(?:s)?\\b').test(source)).slice(0,4);
  }
  return{races,creatures,classes,occupations,attributes,scale,votaries,motifs,race,role,hero,validate,defaults,characterSpec,form,
    toolbox:()=>({races,creatures,heroes:['Suzerain'],classes:Object.keys(classes),occupations:Object.keys(occupations),
      fields:'For mortal/creature figures: race, className, patron (optional canonical deity), sex (Male/Female/Neutral). Classes choose costume and default painted tools; patrons choose emblems, not alignment or allegiance.'})};
});
